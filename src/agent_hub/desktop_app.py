"""Native desktop owner of the existing loopback server and manual-session engine."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import sys
import threading
import time
import traceback
from urllib.parse import urlsplit

from . import __version__
from .__main__ import InstanceLock
from .config import atomic_json, data_directory
from .engine import Hub
from .server import make_server
from .storage import initialize, path as storage_path


def prepare_environment():
    # Finder does not inherit interactive shell initialization. Do not execute it.
    if sys.platform == 'darwin':
        extra = [Path.home()/'.local/bin', Path.home()/'.npm-global/bin',
                 Path('/opt/homebrew/bin'), Path('/usr/local/bin'), Path('/usr/bin'), Path('/bin')]
        paths = [p for p in os.environ.get('PATH', '').split(os.pathsep) if p]
        os.environ['PATH'] = os.pathsep.join(dict.fromkeys([*paths, *map(str, extra)]))
    # A frozen app must not pass its private shared-library path to user CLIs.
    if getattr(sys, 'frozen', False):
        if os.name == 'nt':
            import ctypes
            ctypes.windll.kernel32.SetDllDirectoryW(None)
        for key in ('LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH'):
            original = os.environ.pop(key + '_ORIG', None)
            if original is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = original


@contextmanager
def running_hub(root):
    root = Path(root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    with InstanceLock(root/'instance.lock'):
        if not any((root/name).exists() for name in ('storage.json', 'config.json', 'queue.sqlite3')):
            initialize(root)
        hub = Hub(root)
        server = None
        serving = None
        try:
            server = make_server(hub, 0)
            serving = threading.Thread(target=server.serve_forever, daemon=True, name='desktop-http')
            # Opening a window never starts Coral or queued automatic work.
            hub.start(manual_only=True)
            serving.start()
            yield hub, f'http://127.0.0.1:{server.server_port}'
        finally:
            if serving and serving.is_alive():
                server.shutdown()
                serving.join(timeout=5)
            if server:
                server.server_close()
            hub.close()


class DesktopDialogs:
    """Only native folder selection is exposed; no generic shell/file bridge."""
    def __init__(self, origin):
        self._origin = origin
        self._window = None

    def choose_folder(self):
        if not self._window:
            raise RuntimeError('Window is not ready.')
        url = urlsplit(self._window.get_current_url() or '')
        if f'{url.scheme}://{url.netloc}' != self._origin or url.path != '/desktop.html':
            raise RuntimeError('Folder selection is only available inside Agent Hub.')
        import webview
        chosen = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return str(chosen[0]) if chosen else None


def show_error(message):
    # Also works if the native web renderer itself failed to initialize.
    if os.name == 'nt':
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, message, 'Agent Hub Radio', 0x10)
    else:
        import subprocess
        # argv carries the message, never interpolated into AppleScript source.
        script = 'on run argv\ndisplay alert "Agent Hub Radio" message (item 1 of argv) as critical\nend run'
        subprocess.run(['/usr/bin/osascript', '-e', script, message], check=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Agent Hub Radio desktop preview')
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--smoke-report', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.smoke_report and not args.data_dir:
        parser.error('--smoke-report requires an isolated --data-dir')
    prepare_environment()
    root = (args.data_dir or data_directory()).expanduser().resolve()
    result = {'version': __version__, 'ok': False, 'platform': sys.platform}
    try:
        import webview
        with running_hub(root) as (hub, origin):
            dialogs = DesktopDialogs(origin)
            window = webview.create_window('Agent Hub Radio', origin+'/desktop.html', js_api=dialogs,
                                           width=1320, height=900, min_size=(860, 600),
                                           text_select=True, background_color='#101722')
            dialogs._window = window
            webview.settings['ALLOW_FILE_URLS'] = False
            webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True

            def closing():
                with hub.lock:
                    busy = any(s['status'] in ('preparing', 'running') for s in hub.manual.list())
                if busy:
                    return window.create_confirmation_dialog('Exit Agent Hub?',
                        'Running work will be stopped. Saved history and workspace changes will be kept.')
                return True
            window.events.closing += closing

            def smoke():
                try:
                    end = time.monotonic() + 30
                    while time.monotonic() < end:
                        state = window.evaluate_js("({ready:document.body.dataset.ready,title:document.title,version:document.getElementById('version')?.textContent,error:document.getElementById('notice')?.textContent})")
                        if state and state.get('ready') == 'true':
                            result.update(ok=not state.get('error'), ui=state)
                            break
                        time.sleep(.2)
                    else:
                        result['error'] = 'Native UI did not become ready.'
                except Exception as exc:
                    result['error'] = str(exc)
                finally:
                    window.destroy()

            webview.start(smoke if args.smoke_report else None,
                          gui='edgechromium' if os.name == 'nt' else 'cocoa',
                          private_mode=False, storage_path=str(storage_path(root, 'window-profile')))
        if args.smoke_report:
            result['shutdown'] = True
            atomic_json(args.smoke_report, result)
            return 0 if result['ok'] else 1
        return 0
    except Exception as exc:
        if args.smoke_report:
            atomic_json(args.smoke_report, {**result, 'error': str(exc)})
        else:
            log = root/'logs'/'desktop-error.log'
            log.parent.mkdir(parents=True, exist_ok=True)
            log.write_text(traceback.format_exc(), encoding='utf-8')
            show_error(f'Could not start Agent Hub.\n{exc}\n\nDetails: {log}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
