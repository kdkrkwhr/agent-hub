import json
import tempfile
import unittest
from pathlib import Path
from agent_hub.metrics import usage, execute, snapshot
from agent_hub.engine import Hub
from agent_hub.config import atomic_json

class MetricsTests(unittest.TestCase):
 def test_usage_only_native_envelopes(self):
  self.assertEqual(usage('claude',json.dumps({'type':'result','usage':{'input_tokens':10,'output_tokens':3,'cache_read_input_tokens':20}})),{'input_tokens':10,'output_tokens':3,'cache_read_input_tokens':20})
  self.assertEqual(usage('codex','{"type":"item.completed","usage":{"input_tokens":900}}\n{"type":"turn.completed","usage":{"input_tokens":4,"output_tokens":2,"cached_input_tokens":1}}')['input_tokens'],4)
  for text in ['{}','bad','{"type":"result","usage":{"input_tokens":true,"output_tokens":1}}','{"reply":"claimed usage","usage":{"input_tokens":99,"output_tokens":1}}']:
   self.assertIsNone(usage('cursor',text))
 def test_invocations_survive_retries_and_failures(self):
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp)
   def run(name,cfg,ctx,msg,path,cancel,live):
    live(object());(path/'stdout.log').write_text('{"type":"result","usage":{"input_tokens":2,"output_tokens":1}}');live(None)
    raise RuntimeError('failed after launch')
   for _ in range(2):
    with self.assertRaises(RuntimeError):execute(run,'claude',{}, {},'',folder,None,lambda p:None)
   files=list(folder.glob('metrics-*.json'));self.assertEqual(len(files),2)
   self.assertTrue(all(json.loads(p.read_text())['ended'] is not None for p in files))
   def missing(*args):raise RuntimeError('CLI missing')
   with self.assertRaises(RuntimeError):execute(missing,'claude',{}, {},'',folder,None,lambda p:None)
   self.assertEqual(len(list(folder.glob('metrics-*.json'))),2)
 def test_round_delivery_counts_and_frozen_elapsed(self):
  with tempfile.TemporaryDirectory() as tmp:
   hub=Hub(tmp)
   try:
    db=hub.db
    db.execute('INSERT INTO collab_rounds (id,team,created) VALUES (?,?,?)',('r',json.dumps(['claude']),10))
    for tid,stage,status,error in [('t','explore','done',None),('c','consult','cancelled','Question received at tool boundary')]:
     db.execute('INSERT INTO collab_tasks (id,round_id,agent,stage,status,started,ended,error) VALUES (?,?,?,?,?,?,?,?)',(tid,'r','claude',stage,status,11 if tid=='t' else None,15,error))
    for eid in (1,2):
     db.execute("INSERT INTO collab_events (id,round_id,kind,created) VALUES (?,'r','question',12)",(eid,))
     db.execute("INSERT INTO collab_inbox VALUES ('r','claude',?,'t')",(eid,))
    db.execute("INSERT INTO collab_boundary_deliveries VALUES ('t',2,13,14)")
    folder=Path(tmp)/'runs'/'t';folder.mkdir(parents=True)
    atomic_json(folder/'metrics-a.json',{'started':11,'ended':15,'usage':{'input_tokens':7,'output_tokens':2}})
    result=snapshot(db,tmp,{'id':'r','team':['claude'],'created':10},[{'kind':'agreed','created':20}],now=100)
    self.assertEqual(result['elapsed_seconds'],10)
    self.assertEqual(result['calls'],1)
    self.assertEqual(result['bundled_questions'],1)
    self.assertEqual(result['boundary_received'],1)
    self.assertEqual(result['boundary_cancelled_calls'],1)
    self.assertEqual(result['agents'][0]['usage']['input_tokens'],7)
   finally:hub.close()
