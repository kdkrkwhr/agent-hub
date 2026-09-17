"""CLI entry point: python -m agent_hub or agent-hub."""
import argparse
import json
import os
from pathlib import Path
import sys
import webbrowser

from .config import data_directory,atomic_json
from .engine import Hub
from .server import make_server

class InstanceLock:
    def __init__(self,path):self.path=path
    def __enter__(self):
        self.file=self.path.open('a+b');self.file.seek(0);self.file.write(b'0');self.file.flush();self.file.seek(0)
        try:
            if os.name=='nt':
                import msvcrt;msvcrt.locking(self.file.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl;fcntl.flock(self.file,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except OSError:self.file.close();raise RuntimeError('AGENT HUB is already using this data directory.') from None
        return self
    def __exit__(self,*args):self.file.close()

def main():
    p=argparse.ArgumentParser(description='AGENT HUB RADIO — local Coral collaboration')
    p.add_argument('--port',type=int,default=None)
    p.add_argument('--data-dir',type=Path,default=None)
    p.add_argument('--no-browser',action='store_true')
    p.add_argument('--desktop',action='store_true',help='Open an independent Edge app window on Windows; browser fallback elsewhere.')
    p.add_argument('--choose-data-dir',action='store_true',help='Choose and remember a data folder before starting.')
    args=p.parse_args()
    from .storage import choose,remembered,initialize
    try:
        if args.choose_data_dir or (args.desktop and not args.data_dir and not os.environ.get('AGENT_HUB_HOME') and not remembered()):root=choose(data_directory())
        else:root=(args.data_dir or data_directory()).expanduser().resolve()
        root.mkdir(parents=True,exist_ok=True)
        if not (root/'storage.json').exists() and not (root/'config.json').exists() and not (root/'queue.sqlite3').exists():initialize(root)
    except (RuntimeError,ValueError) as exc:print(str(exc),file=sys.stderr);return 1
    try:
        with InstanceLock(root/'instance.lock'):
            from .managed_coral import ensure
            ensure(root)
            launch=root/'config'/'launcher.json'
            saved=json.loads(launch.read_text(encoding='utf-8')) if launch.exists() else {}
            port=args.port or saved.get('port',8768)
            hub=Hub(root)
            try:server=make_server(hub,port)
            except OSError:hub.db.close();raise RuntimeError('Port unavailable. Choose another --port.') from None
            if (root/'storage.json').exists():atomic_json(launch,{'port':port})
            hub.start();url=f'http://127.0.0.1:{server.server_port}'
            print(f'AGENT HUB RADIO: {url}\nData: {root}',flush=True)
            if not args.no_browser:
                if args.desktop:
                    from .desktop import open_window
                    open_window(url,root)
                else:webbrowser.open(url)
            try:server.serve_forever(poll_interval=.3)
            except KeyboardInterrupt:pass
            finally:server.server_close();hub.close()
    except RuntimeError as exc:
        print(str(exc),file=sys.stderr);return 1
    return 0

if __name__=='__main__':raise SystemExit(main())
