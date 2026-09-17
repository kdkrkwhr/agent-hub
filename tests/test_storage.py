import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from agent_hub.engine import Hub
from agent_hub.config import Config
from agent_hub.storage import initialize,path,root_for_run
from agent_hub.setup_official import migrate,install,scope
class StorageTests(unittest.TestCase):
 def test_new_layout_restart_and_legacy_migration(self):
  with tempfile.TemporaryDirectory() as d:
   source=Path(d)/'legacy';target=Path(d)/'new';h=Hub(source)
   h.save({'mode':'demo','agents':['codex']});tid=h.new_thread('Keep');h.message(tid,'history',[]);h.close_thread(tid,'Done');h.channels.save_notes(tid,{'goal':'goal','decisions':'decision','remaining':'next'});h.close()
   (source/'runs'/'example').mkdir(parents=True);(source/'runs'/'example'/'stdout.log').write_text('keep')
   counts=migrate(source,target)
   self.assertEqual(counts['archives'],1);self.assertTrue((source/'queue.sqlite3').exists());self.assertTrue((target/'database/queue.sqlite3').exists());self.assertFalse((target/'queue.sqlite3').exists())
   self.assertEqual((target/'logs/runs/example/stdout.log').read_text(),'keep')
   h=Hub(target)
   try:self.assertEqual(h.snapshot()['threads'][0]['messages'][0]['messageText'],'history');self.assertEqual(h.channels.notes()[tid]['goal'],'goal')
   finally:h.close()
   self.assertEqual(root_for_run(target/'logs/runs/example'),target)
   with self.assertRaises(ValueError):migrate(source,target)
 def test_official_install_rekeys_current_scope(self):
  import hashlib
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)/'data';initialize(root);h=Hub(root);h.save({'mode':'demo','agents':['codex']});tid=h.new_thread('Keep');h.close_thread(tid,'Done');h.close()
   jar=Path(d)/'official.jar';jar.write_bytes(b'test');java=Path(d)/'java.exe';java.write_bytes(b'test')
   with patch('agent_hub.setup_official.JAR_SHA256',hashlib.sha256(b'test').hexdigest()):install(root,jar,java)
   h=Hub(root)
   try:self.assertEqual(h.threads[0]['threadId'],tid);self.assertIn('coral',Config(root).value['url_file'])
   finally:h.close()
