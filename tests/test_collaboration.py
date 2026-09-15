import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from agent_hub.engine import Hub

class CollaborationTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.hub=Hub(self.temp.name);self.c=self.hub.collaboration
  self.cfg=self.hub.config.prepare({'mode':'coral','automatic':True,'agents':['claude','codex','cursor'],'endpoints':{a:'http://localhost:5555/'+a for a in ['ops','claude','codex','cursor']}})
  self.hub.config.value=self.cfg;self.c.ingest([],self.cfg)
 def tearDown(self):self.hub.close();self.temp.cleanup()
 def request(self,text='Investigate',timestamp=1):
  t={'threadId':'t','state':'open','messages':[{'sendingAgentName':'ops','messageText':text,'messageTimestamp':timestamp,'mentionAgentNames':['claude']}]}
  self.c.ingest([t],self.cfg);return self.hub.db.execute('SELECT id FROM collab_rounds ORDER BY created DESC LIMIT 1').fetchone()[0]
 def task(self,agent=None):
  query="SELECT * FROM collab_tasks WHERE status='pending'";args=()
  if agent:query+=' AND agent=?';args=(agent,)
  return self.hub.db.execute(query+' ORDER BY created LIMIT 1',args).fetchone()
 def reply(self,task,decision='APPROVE',**extra):
  ctx=self.c.task_context(task)
  self.hub.db.execute("UPDATE collab_tasks SET status='running',input=?,started=? WHERE id=?",(json.dumps(ctx),time.time(),task['id']))
  result={'reply':'Concrete evidence and solution','round':task['round_id'],'task':task['id'],'version':task['version'],'decision':decision,'proposal_hash':self.c.get(task['round_id'])['digest'],'assignments':{a:a+' independent task' for a in self.cfg['agents']},**extra}
  self.c.finish(task,result);self.hub.db.commit()
 def to_review(self,rid):
  for _ in range(20):
   if self.c.get(rid)['stage']=='review':return
   self.reply(self.task())
  self.fail('review not reached')
 def test_exploration_barrier_roles_and_inboxes(self):
  rid=self.request();self.reply(self.task('claude'),messages=[{'to':'codex','text':'Check source A'}])
  self.assertEqual(self.c.get(rid)['stage'],'explore')
  ctx=self.c.task_context(self.task('codex'));self.assertTrue(any(e['content']=='Check source A' for e in ctx['inbox']))
  self.reply(self.task('codex'));self.reply(self.task('cursor'));self.assertEqual(self.c.get(rid)['stage'],'explore')
  self.assertEqual(self.task()['stage'],'consult');self.reply(self.task());self.assertEqual(self.c.get(rid)['stage'],'plan')
  self.reply(self.task());self.assertEqual(self.c.get(rid)['stage'],'execute')
  self.assertEqual(len(json.loads(self.c.get(rid)['assignments'])),3)
 def test_single_final_only_after_all_exact_votes(self):
  rid=self.request();self.to_review(rid)
  self.reply(self.task('claude'));self.reply(self.task('codex'));self.assertEqual(self.c.get(rid)['status'],'active')
  self.reply(self.task('cursor'));self.assertEqual(self.c.get(rid)['status'],'agreed')
  with patch.object(self.hub,'peer') as peer:
   self.c.deliver(self.cfg,[{'threadId':'t','state':'open','messages':[]}]);self.c.deliver(self.cfg,[{'threadId':'t','state':'open','messages':[]}])
   self.assertEqual(peer.return_value.tool.call_count,1);self.assertEqual(peer.return_value.tool.call_args.kwargs['mentions'],[])
 def test_objection_creates_owned_investigation_then_reapproval(self):
  rid=self.request();self.to_review(rid)
  self.reply(self.task('codex'),'OBJECT',issues=[{'owner':'cursor','question':'Verify source A'}]);self.reply(self.task('claude'));self.reply(self.task('cursor'))
  self.assertEqual(self.c.get(rid)['stage'],'resolve');self.assertEqual(self.task()['agent'],'cursor')
  self.reply(self.task(),reply='Source A verified; missing constraint found')
  self.assertEqual(self.c.get(rid)['stage'],'synthesize');self.assertEqual(self.hub.db.execute('SELECT status FROM collab_issues').fetchone()[0],'investigated')
  self.reply(self.task(),reply='Updated solution with constraint');self.assertEqual(self.c.get(rid)['version'],2)
  for _ in range(3):self.reply(self.task())
  self.assertEqual(self.c.get(rid)['status'],'agreed');self.assertEqual(self.hub.db.execute('SELECT status FROM collab_issues').fetchone()[0],'resolved')
 def test_plan_format_correction_preserves_result_and_reaches_consensus(self):
  rid=self.request()
  for _ in range(3):self.reply(self.task())
  task=self.task();self.reply(task,assignments=None,reply='Roles were only written in prose')
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.assertEqual(self.task()['id'],task['id'])
  self.assertIn('TOP-LEVEL',self.c.task_context(self.task())['format_correction']['feedback'])
  self.reply(self.task())
  self.to_review(rid)
  for _ in range(3):self.reply(self.task())
  self.assertEqual(self.c.get(rid)['status'],'agreed')
 def test_plan_format_correction_is_bounded_and_auditable(self):
  rid=self.request()
  for _ in range(3):self.reply(self.task())
  self.reply(self.task(),assignments={})
  task=self.task();self.reply(task,assignments={})
  self.assertEqual(self.c.get(rid)['status'],'blocked')
  saved=self.hub.db.execute('SELECT status,result,error FROM collab_tasks WHERE id=?',(task['id'],)).fetchone()
  self.assertEqual(saved['status'],'failed');self.assertEqual(json.loads(saved['result'])['assignments'],{})
  self.assertIn('TOP-LEVEL',saved['error'])
 def test_ready_candidate_opens_review_without_team_barrier(self):
  rid=self.request();self.reply(self.task('codex'),candidate='Sum 21, product 180')
  self.assertEqual(self.c.get(rid)['stage'],'review')
  # Codex can review while the other agents have not finished exploration.
  self.assertEqual(self.task('codex')['stage'],'review');self.reply(self.task('codex'))
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.reply(self.task('claude'),candidate='A competing answer')
  self.reply(self.task('cursor'),candidate='Another competing answer')
  self.assertEqual(self.c.get(rid)['proposal'],'Sum 21, product 180')
  self.reply(self.task('claude'));self.reply(self.task('cursor'))
  self.assertEqual(self.c.get(rid)['status'],'agreed')
  stages=[r[0] for r in self.hub.db.execute('SELECT stage FROM collab_tasks')]
  self.assertEqual(len(stages),6);self.assertNotIn('plan',stages);self.assertNotIn('execute',stages)
 def test_addressed_inbox_work_runs_before_slow_peer_finishes(self):
  rid=self.request();self.reply(self.task('claude'),messages=[{'to':'codex','text':'Verify the operand count'}])
  self.reply(self.task('codex'))
  self.assertEqual(self.task('codex')['stage'],'consult')
  self.reply(self.task('codex'),reply='Three operands verified',candidate='Verified answer')
  self.assertEqual(self.c.get(rid)['stage'],'review')
  self.assertEqual(self.task('cursor')['stage'],'explore')
  self.assertEqual(self.c.get(rid)['guidance'],self.c.get(rid)['proposal_guidance'])
 def test_questions_after_candidate_prevent_stale_final_approval(self):
  rid=self.request();self.reply(self.task('claude'),candidate='Initial answer')
  self.reply(self.task('codex'),messages=[{'to':'cursor','text':'Check a missing constraint'}])
  self.reply(self.task('cursor'))
  # Finish review tasks first deliberately; final must still wait for consultation.
  for agent in self.cfg['agents']:
   task=self.hub.db.execute("SELECT * FROM collab_tasks WHERE agent=? AND stage='review'",(agent,)).fetchone();self.reply(task)
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.assertEqual(self.task()['stage'],'consult');self.reply(self.task(),reply='Constraint verified')
  self.assertEqual(self.c.get(rid)['stage'],'synthesize');self.assertEqual(self.c.get(rid)['version'],2)
 def test_fast_path_scheduler_six_calls_and_one_delivery(self):
  rid=self.request()
  def execute(name,cfg,context,incoming,folder,cancel,live):
   c=context['collaboration']
   return dict(round=c['round'],task=c['task'],version=c['version'],reply='Verified',candidate='Sum 21, product 180' if c['phase']=='explore' else '',decision='APPROVE',proposal_hash=c['proposal_hash'])
  with patch('agent_hub.adapters.execute',side_effect=execute) as model,patch.object(self.hub,'peer') as peer:
   for _ in range(20):
    self.c.tick(self.cfg,[{'threadId':'t','state':'open','messages':[]}])
    for a in list(self.hub.active.values()):a['future'].result(timeout=3)
    if self.c.get(rid)['status']=='agreed':break
   self.assertEqual(self.c.get(rid)['status'],'agreed');self.assertEqual(model.call_count,6);self.assertEqual(peer.return_value.tool.call_count,1)
 def test_stale_vote_blocks(self):
  rid=self.request();self.to_review(rid);self.reply(self.task(),proposal_hash='wrong')
  self.assertEqual(self.c.get(rid)['status'],'blocked')
 def test_guidance_during_review_requires_new_candidate(self):
  rid=self.request();self.to_review(rid);self.request('Additional constraint',2)
  for _ in range(3):self.reply(self.task())
  self.assertEqual(self.c.get(rid)['status'],'active');self.assertEqual(self.c.get(rid)['version'],2)
 def test_guidance_arriving_during_synthesis_invalidates_candidate(self):
  rid=self.request()
  while self.c.get(rid)['stage']!='synthesize':self.reply(self.task())
  task=self.task();ctx=self.c.task_context(task)
  self.hub.db.execute("UPDATE collab_tasks SET status='running',input=? WHERE id=?",(json.dumps(ctx),task['id']))
  self.request('New constraint while model is running',2)
  self.c.finish(task,dict(round=rid,task=task['id'],version=1,reply='Old candidate'))
  for _ in range(3):self.reply(self.task())
  self.assertEqual(self.c.get(rid)['status'],'active');self.assertEqual(self.c.get(rid)['version'],2)
 def test_restart_blocks_running_without_reexecution(self):
  rid=self.request();self.hub.db.execute("UPDATE collab_tasks SET status='running' WHERE agent='claude'");self.hub.db.commit()
  self.hub.close();self.hub=Hub(self.temp.name);self.c=self.hub.collaboration
  self.assertEqual(self.c.get(rid)['status'],'blocked');self.assertEqual(self.hub.db.execute("SELECT count(*) FROM collab_tasks WHERE status='pending'").fetchone()[0],0)
 def test_restart_preserves_pending_inbox(self):
  rid=self.request();self.hub.db.commit();self.hub.close();self.hub=Hub(self.temp.name);self.c=self.hub.collaboration
  self.assertEqual(len(self.c.task_context(self.task())['inbox']),1);self.assertEqual(self.c.get(rid)['status'],'active')
 def test_peer_messages_do_not_spawn_and_observe_does_not_replay(self):
  cfg=dict(self.cfg,automatic=False);t={'threadId':'t','messages':[{'sendingAgentName':'ops','messageText':'old','mentionAgentNames':['claude']}]}
  self.c.ingest([t],cfg);self.c.ingest([t],self.cfg)
  t['messages'].append({'sendingAgentName':'codex','messageText':'loop','mentionAgentNames':['claude']});self.c.ingest([t],self.cfg)
  self.assertEqual(self.hub.db.execute('SELECT count(*) FROM collab_rounds').fetchone()[0],0)
 def test_three_versions_end_with_one_blocked_result(self):
  rid=self.request()
  for _ in range(50):
   if self.c.get(rid)['status']!='active':break
   task=self.task();self.reply(task,'OBJECT' if task['stage']=='review' else 'APPROVE')
  self.assertEqual(self.c.get(rid)['status'],'blocked');self.assertEqual(self.c.get(rid)['version'],3)
  self.assertEqual(self.hub.db.execute("SELECT count(*) FROM collab_events WHERE kind='blocked'").fetchone()[0],1)
 def test_deadline_and_closed_channel(self):
  rid=self.request();self.hub.db.execute('UPDATE collab_rounds SET deadline=0');self.hub.db.commit()
  with patch.object(self.hub,'peer'):self.c.tick(self.cfg,[])
  self.assertEqual(self.c.get(rid)['status'],'blocked')
  rid=self.request('second',2);self.c.close_thread('t',self.hub.scope(self.cfg));self.assertEqual(self.c.get(rid)['status'],'cancelled')
 def test_full_scheduler_with_scripted_workers(self):
  rid=self.request()
  def execute(name,cfg,context,incoming,folder,cancel,live):
   c=context['collaboration']
   return dict(round=c['round'],task=c['task'],version=c['version'],reply='Verified solution',decision='APPROVE',proposal_hash=c['proposal_hash'],assignments={a:'Inspect '+a for a in c['team']})
  with patch('agent_hub.adapters.execute',side_effect=execute) as model,patch.object(self.hub,'peer') as peer:
   for _ in range(30):
    self.c.tick(self.cfg,[{'threadId':'t','state':'open','messages':[]}])
    for a in list(self.hub.active.values()):a['future'].result(timeout=3)
    if self.c.get(rid)['status']=='agreed':break
   self.assertEqual(self.c.get(rid)['status'],'agreed');self.assertEqual(model.call_count,11);self.assertEqual(peer.return_value.tool.call_count,1)

if __name__=='__main__':unittest.main()
