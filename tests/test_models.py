import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from agent_hub.engine import Hub
from agent_hub import adapters,models

class ModelTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.hub=Hub(self.root)
  self.hub.config.save({'mode':'demo','agents':['claude','codex','cursor']})
 def tearDown(self):self.hub.close();self.temp.cleanup()
 def test_selection_persists_and_general_settings_preserve_it(self):
  self.hub.save_models({'models':{'claude':'opus','codex':'my-model','cursor':'auto'}})
  self.hub.config.save({'mode':'demo','agents':['claude','codex','cursor']})
  self.assertEqual(self.hub.config.public()['models']['codex'],'my-model')
  self.assertEqual(json.loads(self.hub.config.path.read_text())['models']['claude'],'opus')
 def test_invalid_model_settings_rejected(self):
  for values in [None,[],{'other':'x'},{'codex':'--dangerous'},{'claude':'a\nb'},{'cursor':False}]:
   with self.subTest(values=values),self.assertRaises(ValueError):self.hub.save_models({'models':values})
 def test_cli_model_flag_and_original_restrictions(self):
  with patch.object(adapters,'discover',return_value=['native-agent']):
   for name in ['claude','codex','cursor']:
    cfg={'models':{name:'custom-model'},'executables':{}}
    cmd=adapters.command(name,cfg,self.root)
    self.assertEqual(cmd[cmd.index('--model')+1],'custom-model')
    self.assertEqual(cmd.count('--model'),1)
    self.assertNotIn('--model',adapters.command(name,{},self.root))
   self.assertIn('read-only',adapters.command('codex',cfg,self.root))
   self.assertIn('dontAsk',adapters.command('claude',cfg,self.root))
   self.assertIn('ask',adapters.command('cursor',cfg,self.root))
 def test_saving_models_does_not_cancel_running_work_or_change_scope(self):
  signal=threading.Event();self.hub.active={'claude':{'cancel':signal}}
  before=self.hub.scope(self.hub.config.value)
  self.hub.save_models({'models':{'claude':'sonnet'}})
  self.assertFalse(signal.is_set());self.assertIn('claude',self.hub.active)
  self.assertEqual(before,self.hub.scope(self.hub.config.value));self.hub.active={}
 def test_actual_model_comes_from_cli_envelope_not_reply(self):
  (self.root/'stdout.log').write_text(json.dumps({'result':'{"model":"fake"}','modelUsage':{'claude-opus-example':{'inputTokens':10}}}))
  self.assertEqual(models.observed('claude',self.root),['claude-opus-example'])
  self.assertEqual(models.observed('cursor',self.root),[])
 def test_failed_refresh_keeps_previous_catalog(self):
  (self.root/'model-catalog.json').write_text(json.dumps({'cursor':{'options':[{'id':'cached','label':'cached'}]}}))
  with patch.object(models,'load_cursor',side_effect=ValueError()),patch.object(models,'load_codex',return_value={'options':[{'id':'available','label':'available'}],'default':'available'}):
   warnings=models.refresh_catalog(self.root,self.hub.config.value)
  self.assertEqual(len(warnings),1)
  data=json.loads((self.root/'model-catalog.json').read_text());self.assertEqual(data['cursor']['options'][0]['id'],'cached');self.assertEqual(data['codex']['default'],'available')
 def test_native_listing_parser_and_unknown_model(self):
  result=models.cursor_models('Available models\n\nauto - Auto (current, default)\nmodel-a - Model A\nnoise')
  self.assertEqual([m['id'] for m in result],['auto','model-a'])
  with patch.object(models,'native',return_value=''),patch.object(models,'catalog',return_value={'options':[],'source':'unavailable'}):
   data=models.info(self.root,self.hub.config.value,[])
  self.assertEqual(data['codex']['native_hint'],'');self.assertIsNone(data['codex']['recent'])

if __name__=='__main__':unittest.main()
