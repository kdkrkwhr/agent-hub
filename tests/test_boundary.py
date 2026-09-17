import json
import unittest
from unittest.mock import patch
import test_collaboration as fixtures
from agent_hub.boundary import drain,output,prepare

class BoundaryTests(unittest.TestCase):
 setUp=fixtures.CollaborationTests.setUp
 tearDown=fixtures.CollaborationTests.tearDown
 request=fixtures.CollaborationTests.request
 task=fixtures.CollaborationTests.task

 def running(self):
  rid=self.request()
  for _ in range(3):fixtures.CollaborationTests.reply(self,self.task())
  task=self.task('claude');ctx=self.c.task_context(task)
  self.hub.db.execute("UPDATE collab_tasks SET status='running',input=? WHERE id=?",(json.dumps(ctx),task['id']))
  self.hub.db.execute('UPDATE collab_inbox SET consumed_by=? WHERE round_id=? AND agent=?',(task['id'],rid,'claude'));self.hub.db.commit()
  return rid,task

 def test_independent_phase_never_receives_peer_boundary_messages(self):
  rid=self.request();task=self.task('claude')
  self.hub.db.execute("UPDATE collab_tasks SET status='running' WHERE id=?",(task['id'],))
  self.c.event(rid,'codex','question','Secret peer opinion',['claude']);self.hub.db.commit()
  self.assertEqual(drain(self.hub.root/'queue.sqlite3',task['id']),[])
  self.assertNotIn('Secret peer opinion',json.dumps(self.c.task_context(task)))

 def late(self,rid,text='Check 21'):
  seq=self.c.event(rid,'codex','question',text,['claude']);self.c.consult(rid,'claude',seq)
  self.hub.db.execute('UPDATE collab_rounds SET guidance=guidance+1 WHERE id=?',(rid,));self.hub.db.commit();return seq

 def test_hook_offers_once_and_never_calls_model_or_consumes(self):
  rid,task=self.running();seq=self.late(rid)
  with patch('agent_hub.adapters.execute') as model:
   batch=drain(self.hub.root/'queue.sqlite3',task['id']);self.assertEqual([e['id'] for e in batch],[seq])
   self.assertEqual(drain(self.hub.root/'queue.sqlite3',task['id']),[]);model.assert_not_called()
  row=self.hub.db.execute('SELECT consumed_by FROM collab_inbox WHERE event=?',(seq,)).fetchone();self.assertIsNone(row[0])
  payload=output(batch);self.assertIn('additionalContext',payload['hookSpecificOutput']);self.assertNotIn('decision',payload)

 def test_confirmed_receipt_cancels_only_redundant_consult(self):
  rid,task=self.running();seq=self.late(rid);drain(self.hub.root/'queue.sqlite3',task['id'])
  self.c.finish(task,{'round':rid,'task':task['id'],'version':1,'reply':'Checked','received_event_ids':[seq],'messages':[]})
  self.assertEqual(self.hub.db.execute('SELECT consumed_by FROM collab_inbox WHERE event=?',(seq,)).fetchone()[0],task['id'])
  self.assertEqual(self.hub.db.execute("SELECT status FROM collab_tasks WHERE stage='consult'").fetchone()[0],'cancelled')
  self.assertIsNotNone(self.hub.db.execute('SELECT acknowledged FROM collab_boundary_deliveries').fetchone()[0])
  self.assertEqual(self.c.get(rid)['guidance'],2)

 def test_missing_or_forged_receipt_preserves_fallback(self):
  rid,task=self.running();seq=self.late(rid)
  self.c.finish(task,{'round':rid,'task':task['id'],'version':1,'reply':'Checked','received_event_ids':[seq],'messages':[]})
  self.assertIsNone(self.hub.db.execute('SELECT consumed_by FROM collab_inbox WHERE event=?',(seq,)).fetchone()[0])
  self.assertEqual(self.hub.db.execute("SELECT status FROM collab_tasks WHERE stage='consult'").fetchone()[0],'pending')

 def test_offered_but_unacknowledged_is_delivered_next_call(self):
  rid,task=self.running();seq=self.late(rid);drain(self.hub.root/'queue.sqlite3',task['id'])
  self.c.finish(task,{'round':rid,'task':task['id'],'version':1,'reply':'Checked','messages':[]})
  ctx=self.c.task_context(self.task('claude'));self.assertIn(seq,ctx['unread_event_ids'])
  self.assertTrue(any(e['id']==seq for e in ctx['inbox']))

 def test_cancelled_task_and_other_agent_do_not_drain(self):
  rid,task=self.running();seq=self.c.event(rid,'claude','question','Other recipient',['codex']);self.hub.db.commit()
  self.assertEqual(drain(self.hub.root/'queue.sqlite3',task['id']),[])
  self.late(rid);self.c.end(rid,'cancelled','test');self.hub.db.commit()
  self.assertEqual(drain(self.hub.root/'queue.sqlite3',task['id']),[])

 def test_batch_limit_preserves_overflow_and_oversized_messages(self):
  rid,task=self.running();self.c.event(rid,'ops','guidance','x'*7000,['claude'])
  for n in range(10):self.c.event(rid,'codex','notice',str(n),['claude'])
  self.hub.db.commit();self.assertEqual(len(drain(self.hub.root/'queue.sqlite3',task['id'])),8)
  self.assertEqual(len(drain(self.hub.root/'queue.sqlite3',task['id'])),2)
  self.assertEqual(self.hub.db.execute('SELECT COUNT(*) FROM collab_inbox WHERE agent=? AND consumed_by IS NULL',('claude',)).fetchone()[0],11)

 def test_config_is_opt_in_and_preserved(self):
  self.assertEqual(self.cfg['zero_turn_agents'],[])
  self.hub.config.value={**self.cfg,'zero_turn_agents':['claude']}
  self.assertEqual(self.hub.config.prepare(self.cfg|{'zero_turn_agents':['claude']})['zero_turn_agents'],['claude'])
  body=dict(self.cfg);body.pop('zero_turn_agents');self.assertEqual(self.hub.config.prepare(body)['zero_turn_agents'],['claude'])
  with self.assertRaises(ValueError):self.hub.config.prepare(self.cfg|{'zero_turn_agents':['cursor']})

 def test_hook_settings_are_local_and_opt_in(self):
  self.assertEqual(prepare({}, {'collaboration':{}},self.hub.root),[])
  args=prepare({'zero_turn_agents':['claude']},{'collaboration':{}},self.hub.root)
  self.assertEqual(args[0],'--settings');settings=json.loads((self.hub.root/'boundary-settings.json').read_text())
  self.assertEqual(list(settings['hooks']),['PostToolUse']);self.assertNotIn('Stop',settings['hooks'])

 def test_parallel_tool_boundaries_offer_each_message_once(self):
  import concurrent.futures
  rid,task=self.running();seq=self.late(rid)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   batches=list(pool.map(lambda _:drain(self.hub.root/'queue.sqlite3',task['id']),range(2)))
  self.assertEqual([e['id'] for batch in batches for e in batch],[seq])

 def test_explicit_urgent_consult_is_not_cancelled_by_receipt(self):
  rid,task=self.running();seq=self.late(rid);self.c.consult(rid,'claude',seq,urgent=True);self.hub.db.commit()
  drain(self.hub.root/'queue.sqlite3',task['id'])
  self.c.finish(task,{'round':rid,'task':task['id'],'version':1,'reply':'Checked','received_event_ids':[seq]})
  self.assertEqual(self.hub.db.execute("SELECT status FROM collab_tasks WHERE stage='consult'").fetchone()[0],'pending')

 def test_late_evidence_does_not_silently_refresh_proposal_approval(self):
  rid,task=self.running();seq=self.late(rid);drain(self.hub.root/'queue.sqlite3',task['id'])
  self.c.finish(task,{'round':rid,'task':task['id'],'version':1,'reply':'Checked','candidate':'Updated answer','received_event_ids':[seq]})
  r=self.c.get(rid);self.assertNotEqual(r['guidance'],r['proposal_guidance'])
  self.assertEqual(r['status'],'active')
