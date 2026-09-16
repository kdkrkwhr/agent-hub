import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from agent_hub import boundary,codex_boundary

class CodexBoundaryTests(unittest.TestCase):
 def test_registration_is_required_and_fingerprint_is_pinned(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)
   self.assertEqual(codex_boundary.prepare(root),[])
   command,setting,fingerprint=codex_boundary.definition()
   manifest={'fingerprint':fingerprint,'native_home':str(Path(os.environ.get('CODEX_HOME',Path.home()/'.codex')).resolve())}
   (root/'codex-boundary-trust.json').write_text(json.dumps(manifest),encoding='utf-8')
   args=codex_boundary.prepare(root)
   self.assertEqual(args,['-c',setting]);self.assertNotIn('bypass',setting)
   manifest['fingerprint']='changed';(root/'codex-boundary-trust.json').write_text(json.dumps(manifest),encoding='utf-8')
   self.assertEqual(codex_boundary.prepare(root),[])
 def test_codex_accepts_only_its_tool_boundary(self):
  for tool,expected in [('Bash',True),('Read',False),('apply_patch',False)]:
   with patch('sys.argv',['boundary.py','--codex']),patch('sys.stdin',io.StringIO(json.dumps({'hook_event_name':'PostToolUse','tool_name':tool}))),patch('sys.stdout',new_callable=io.StringIO) as out,patch.dict(os.environ,{'AGENT_HUB_BOUNDARY_DB':'db','AGENT_HUB_BOUNDARY_TASK':'task'}),patch('agent_hub.boundary.drain',return_value=[{'id':1,'content':'test'}]) as drain:
    boundary.main();self.assertEqual(drain.called,expected)
    self.assertEqual(bool(json.loads(out.getvalue())),expected)
 def test_claude_does_not_accept_codex_shell_hook(self):
  with patch('sys.argv',['boundary.py']),patch('sys.stdin',io.StringIO('{"hook_event_name":"PostToolUse","tool_name":"Bash"}')),patch('sys.stdout',new_callable=io.StringIO),patch('agent_hub.boundary.drain') as drain:
   boundary.main();drain.assert_not_called()
