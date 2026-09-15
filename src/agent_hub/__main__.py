"""CLI entry point: python -m agent_hub or agent-hub."""
import argparse
import os
from pathlib import Path
import sys
import webbrowser

from .config import data_directory
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
    p.add_argument('--port',type=int,default=8768)
    p.add_argument('--data-dir',type=Path,default=None)
    p.add_argument('--no-browser',action='store_true')
    p.add_argument('--desktop',action='store_true',help='Open an independent Edge app window on Windows; browser fallback elsewhere.')
    args=p.parse_args();root=(args.data_dir or data_directory()).expanduser().resolve();root.mkdir(parents=True,exist_ok=True)
    try:
        with InstanceLock(root/'instance.lock'):
            hub=Hub(root)
            try:server=make_server(hub,args.port)
            except OSError:hub.db.close();raise RuntimeError('Port unavailable. Choose another --port.') from None
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
