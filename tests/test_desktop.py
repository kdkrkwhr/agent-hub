import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch
import urllib.request

from agent_hub.desktop_app import DesktopDialogs, prepare_environment, running_hub, main
from agent_hub.__main__ import InstanceLock


class DesktopTests(unittest.TestCase):
    def test_missing_remembered_folder_shows_error_instead_of_silent_exit(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch('agent_hub.desktop_app.default_data_directory',return_value=Path(folder)), patch('agent_hub.desktop_app.data_directory',side_effect=RuntimeError('Missing stored folder')), patch('agent_hub.desktop_app.show_error') as alert:
                self.assertEqual(main([]),1)
                self.assertIn('Missing stored folder',alert.call_args.args[0])
                self.assertTrue((Path(folder)/'logs/desktop-error.log').is_file())

    def test_finder_path_keeps_user_paths_and_adds_cli_locations_without_shell(self):
        with patch('sys.platform', 'darwin'), patch.dict(os.environ, {'PATH':'/custom/bin'}):
            with patch('subprocess.run') as execute:
                prepare_environment()
                self.assertEqual(os.environ['PATH'].split(os.pathsep)[0], '/custom/bin')
                self.assertIn(str(Path('/opt/homebrew/bin')), os.environ['PATH'].split(os.pathsep))
                self.assertIn(str(Path.home()/'.local/bin'), os.environ['PATH'].split(os.pathsep))
                execute.assert_not_called()

    def test_dialog_cannot_be_called_from_external_page_or_legacy_page(self):
        dialog=DesktopDialogs('http://127.0.0.1:1234')
        dialog._window=Mock()
        for url in ('https://evil.invalid/desktop.html','http://127.0.0.1:1234/index.html'):
            dialog._window.get_current_url.return_value=url
            with self.assertRaises(RuntimeError):dialog.choose_folder()
        dialog._window.create_file_dialog.assert_not_called()

    def test_dialog_cancel_is_not_a_folder(self):
        dialog=DesktopDialogs('http://127.0.0.1:1234')
        dialog._window=Mock()
        dialog._window.get_current_url.return_value='http://127.0.0.1:1234/desktop.html'
        dialog._window.create_file_dialog.return_value=None
        with patch.dict('sys.modules', {'webview':Mock()}):
            self.assertIsNone(dialog.choose_folder())

    def test_native_owner_serves_ui_preserves_data_and_releases_lock(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'data 한글'
            source=Path(folder)/'project space';source.mkdir()
            (source/'note.txt').write_text('unchanged',encoding='utf-8')
            with running_hub(root) as (hub,origin):
                self.assertFalse(hub.thread.is_alive(), 'Legacy automatic work must not start')
                with urllib.request.urlopen(origin+'/desktop.html') as response:
                    self.assertIn(b'Choose a project folder',response.read())
                    self.assertIn("'unsafe-eval'",response.headers['Content-Security-Policy'])
                    self.assertNotIn("'unsafe-inline'",response.headers['Content-Security-Policy'])
                with urllib.request.urlopen(origin+'/') as response:
                    self.assertNotIn("'unsafe-eval'",response.headers['Content-Security-Policy'])
                with urllib.request.urlopen(origin+'/api/bootstrap') as response:
                    data=json.load(response)
                body=json.dumps({'source':str(source),'workspaceMode':'folder'}).encode()
                request=urllib.request.Request(origin+'/api/manual/session',data=body,
                    headers={'Content-Type':'application/json','X-Hub-CSRF':data['csrf']})
                with urllib.request.urlopen(request) as response:session=json.load(response)
                self.assertFalse(session['writable'])
                with self.assertRaises(RuntimeError):
                    with InstanceLock(root/'instance.lock'):pass
            with InstanceLock(root/'instance.lock'):pass
            with running_hub(root) as (hub,origin):
                self.assertEqual(hub.manual.get(session['id'])['source'],str(source.resolve()))
                self.assertEqual((source/'note.txt').read_text(),'unchanged')

    def test_close_cancels_only_owned_work_before_database_closes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)/'hub';source=Path(folder)/'project';source.mkdir()
            began=threading.Event();cancelled=threading.Event()
            def execute(agent,cfg,packet,writable,run_folder,cancel,live,emit):
                began.set()
                if not cancel.wait(10):raise RuntimeError('Cancellation was not delivered')
                cancelled.set()
                raise RuntimeError('Cancelled by desktop close')
            with patch('agent_hub.adapters.discover',return_value=['mock']), patch('agent_hub.manual_runner.execute',side_effect=execute):
                with running_hub(root) as (hub,origin):
                    session=hub.manual.create({'source':str(source),'workspaceMode':'folder'})
                    hub.manual.submit({'sessionId':session['id'],'text':'read this project'})
                    self.assertTrue(began.wait(5))
                self.assertTrue(cancelled.is_set())
            with running_hub(root) as (hub,origin):
                self.assertNotEqual(hub.manual.status(session['id'])['status'],'running')


if __name__=='__main__':unittest.main()
