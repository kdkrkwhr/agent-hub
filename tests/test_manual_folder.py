import io
import json
import os
from pathlib import Path
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

from agent_hub import manual_context as context, manual_workspace as ws, manual_runner
from agent_hub.cli import main as cli_main
from agent_hub.engine import Hub


class FolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'plain project'
        self.source.mkdir()
        (self.source / 'app.py').write_text('value = 1\n', encoding='utf-8')
        (self.source / 'delete.txt').write_text('remove me\n', encoding='utf-8')
        (self.source / '.env').write_text('PRIVATE=fixture', encoding='utf-8')
        (self.source / 'node_modules').mkdir()
        (self.source / 'node_modules' / 'dependency.txt').write_text('ignored', encoding='utf-8')
        (self.source / 'empty-dir').mkdir()
        (self.source / '.agent-hub-ignore').write_text('ignored/\n*.cache\n', encoding='utf-8')
        (self.source / 'ignored').mkdir()
        (self.source / 'ignored' / 'data').write_text('ignored', encoding='utf-8')
        self.git = patch('agent_hub.pipeline_workspace.git', side_effect=AssertionError('Git must never be called'))
        self.git.start()
        original_which = shutil.which
        self.which = patch('shutil.which', side_effect=lambda name: None if name == 'git' else original_which(name))
        self.which.start()
        self.native = patch('agent_hub.adapters.discover', return_value=['mock-native'])
        self.native.start()
        self.hub = Hub(self.root / 'hub')
        self.m = self.hub.manual
        self.session = self.m.create({'source': str(self.source), 'authorizeWrites': True})
        self.sid = self.session['id']
        self.workspace = Path(self.session['workspace'])

    def tearDown(self):
        self.hub.close()
        self.native.stop()
        self.which.stop()
        self.git.stop()
        self.temp.cleanup()

    def submit(self, text, **extra):
        return self.m.submit({'sessionId': self.sid, 'text': text, **extra})['id']

    def finish(self, key, fake):
        deadline = time.monotonic() + 20
        with patch('agent_hub.manual_runner.execute', side_effect=fake):
            while time.monotonic() < deadline:
                with self.hub.lock:
                    self.m.tick()
                    turn = self.m.turn(key)
                if turn['status'] not in ('pending', 'running'):
                    return turn
                time.sleep(.01)
        self.fail('Folder turn did not terminate')

    def test_no_git_initialization_ignore_rules_and_path_boundaries(self):
        self.assertEqual(self.session['workspace_kind'], 'folder')
        self.assertTrue(self.session['base'].startswith('folder:'))
        self.assertFalse((self.source / '.git').exists())
        self.assertFalse((self.workspace / '.git').exists())
        self.assertEqual((self.workspace / 'app.py').read_bytes(), (self.source / 'app.py').read_bytes())
        self.assertTrue((self.workspace / 'empty-dir').is_dir())
        for name in ('.env', 'node_modules', 'ignored', '../app.py', str(self.source / 'app.py')):
            with self.assertRaises(ValueError):
                self.m.manage({'sessionId': self.sid, 'action': 'include', 'text': name})
        self.assertTrue((self.source / '.env').exists())
        packet, _ = context.build(self.session, [], 'inspect')
        snapshot = packet['context_bucket']['workspace_snapshot']
        self.assertIsNone(snapshot['base_commit'])
        self.assertEqual(snapshot['base_snapshot'], self.session['base'])
        self.assertEqual(snapshot['changed_files'], [])
        self.assertEqual(snapshot['workspace_kind'], 'folder')
        for agent in ('claude', 'codex', 'cursor'):
            args = manual_runner.command(agent, {}, self.root / 'logs', packet, True)
            if agent == 'codex':
                self.assertIn('--skip-git-repo-check', args)

    def test_handoff_discussion_and_host_check_without_git(self):
        def write(agent, cfg, packet, writable, *args):
            self.assertTrue(writable)
            (self.workspace / 'app.py').write_text('value = 2\n')
            return {'reply': 'changed value to 2', 'exit_code': 0}
        self.assertEqual(self.finish(self.submit('@claude edit'), write)['status'], 'completed')
        barrier = threading.Barrier(2, timeout=10)
        rounds = []
        def discuss(agent, cfg, packet, writable, *args):
            self.assertFalse(writable)
            snap = packet['context_bucket']['workspace_snapshot']
            self.assertIn('value = 2', snap['file_diff'])
            self.assertIn('changed value to 2', context.pack(packet))
            rounds.append(packet['discussion']['round'])
            barrier.wait()
            return {'reply': agent + ' agrees with value = 2', 'exit_code': 0}
        result = self.finish(self.submit('@codex @cursor review'), discuss)
        self.assertEqual(result['status'], 'completed', result['error'])
        self.assertEqual(sorted(rounds), [1, 1, 2, 2])
        key = self.submit('"' + sys.executable + '" -c "print(42)"', kind='check')
        result = self.finish(key, discuss)
        self.assertEqual(result['outcome']['check']['exit_code'], 0)
        self.assertIn('42', result['reply'])
        self.assertEqual((self.source / 'app.py').read_text(), 'value = 1\n')

    def test_export_covers_new_deleted_binary_empty_and_no_final_newline(self):
        (self.workspace / 'app.py').write_text('value = 3', encoding='utf-8')
        (self.workspace / 'delete.txt').unlink()
        (self.workspace / 'binary.dat').write_bytes(b'\x00\xff\x81')
        (self.workspace / 'empty.txt').write_bytes(b'')
        self.m.manage({'sessionId': self.sid, 'action': 'sync'})
        packet, _ = context.build(self.m.get(self.sid), [], 'inspect')
        snap = packet['context_bucket']['workspace_snapshot']
        self.assertEqual(snap['deleted_files'], ['delete.txt'])
        self.assertEqual(snap['binary_files'][0]['path'], 'binary.dat')
        self.assertIn('No newline at end of file', snap['file_diff'])
        result = self.m.manage({'sessionId': self.sid, 'action': 'export'})
        directory = Path(result['directory'])
        manifest = json.loads((directory / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual({e['path']: e['status'] for e in manifest['changes']},
                         {'app.py': 'modified', 'delete.txt': 'deleted', 'binary.dat': 'added', 'empty.txt': 'added'})
        with zipfile.ZipFile(directory / 'changed-files.zip') as archive:
            self.assertEqual(archive.read('files/binary.dat'), b'\x00\xff\x81')
            self.assertEqual(archive.read('files/empty.txt'), b'')
            self.assertEqual(archive.read('files/app.py'), b'value = 3')
            self.assertNotIn('files/delete.txt', archive.namelist())
        self.assertTrue((self.source / 'delete.txt').exists())
        self.assertEqual(result['fingerprint'], ws.fingerprint(self.workspace, self.session['base']))

    def test_restart_external_edits_and_frozen_ignore_rules(self):
        original = self.session['fingerprint']
        self.hub.close()
        self.hub = Hub(self.root / 'hub')
        self.m = self.hub.manual
        self.assertEqual(self.m.get(self.sid)['fingerprint'], original)
        (self.workspace / '.agent-hub-ignore').write_text('app.py\n')
        (self.workspace / 'app.py').write_text('value = 7\n')
        with self.assertRaisesRegex(ValueError, '/sync'):
            self.submit('inspect')
        self.m.manage({'sessionId': self.sid, 'action': 'sync'})
        packet, _ = context.build(self.m.get(self.sid), [], 'inspect')
        self.assertIn('app.py', packet['context_bucket']['workspace_snapshot']['changed_files'])

    def test_missing_git_executable_and_explicit_folder_mode_accept_git_metadata(self):
        (self.source / '.git').mkdir()
        (self.source / '.git' / 'HEAD').write_text('not used by folder mode')
        (self.source / 'app.py').write_text('uncommitted = True\n')
        for mode in ('auto', 'folder'):
            source, project, base = ws.source_info(str(self.source), mode)
            self.assertIsNone(base)
            self.assertEqual(project, os.path.normcase(str((self.source / '.git').resolve())))
            session = self.m.create({'source': source, 'workspaceMode': mode})
            self.assertEqual((Path(session['workspace']) / 'app.py').read_text(), 'uncommitted = True\n')
            self.assertFalse((Path(session['workspace']) / '.git').exists())

    def test_empty_folder_and_data_directory_overlap(self):
        empty = self.root / 'empty'
        empty.mkdir()
        session = self.m.create({'source': str(empty)})
        self.assertEqual(list(Path(session['workspace']).iterdir()), [])
        self.assertEqual(ws.changes(session['workspace'], session['base']), [])
        with self.assertRaisesRegex(ValueError, '데이터 폴더'):
            self.m.create({'source': str(self.root)})

    def test_size_and_baseline_integrity_checks(self):
        with patch.object(ws, 'MAX_FILE_BYTES', 1):
            with self.assertRaisesRegex(ValueError, '한도'):
                self.m.create({'source': str(self.source)})
        manifest = self.workspace.parent / 'baseline.json'
        data = json.loads(manifest.read_text(encoding='utf-8'))
        data['files'].pop('app.py')
        manifest.write_text(json.dumps(data), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, '시작 스냅샷'):
            ws.fingerprint(self.workspace, self.session['base'])

    def test_source_change_during_copy_does_not_create_ready_session(self):
        write = zipfile.ZipFile.writestr
        def mutate(archive, name, data):
            write(archive, name, data)
            (self.source / 'app.py').write_text('changed during copy\n')
        with patch.object(zipfile.ZipFile, 'writestr', side_effect=mutate, autospec=True):
            with self.assertRaisesRegex(ValueError, '복사 중'):
                self.m.create({'source': str(self.source)})
        self.assertEqual(self.m.list()[0]['status'], 'interrupted')
        self.assertEqual((self.source / 'app.py').read_text(), 'changed during copy\n')

    def test_cli_prompt_creates_plain_folder_session_without_git(self):
        self.hub.close()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        try:
            with patch('builtins.input', side_effect=[str(self.source), '/context', '/exit']), \
                 patch('sys.stdout', new_callable=io.StringIO) as output, patch('agent_hub.manual_runner.execute') as native:
                result = cli_main(['--interactive-source', '--data-dir', str(self.root / 'hub'), '--port', str(port)])
                self.assertEqual(result, 0, output.getvalue())
                self.assertIn('Git은 사용하지 않습니다', output.getvalue())
                native.assert_not_called()
        finally:
            self.hub = Hub(self.root / 'hub')
            self.m = self.hub.manual


if __name__ == '__main__':
    unittest.main()
