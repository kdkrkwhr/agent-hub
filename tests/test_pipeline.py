import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from agent_hub.engine import Hub
from agent_hub import pipeline_workspace as ws
from agent_hub.pipeline import Pipeline
from agent_hub.adapters import pipeline_command

class PipelineTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.source=self.root/'source';self.source.mkdir()
  ws.git(self.source,'init');(self.source/'maths.py').write_text('def total(n): return -1\n');(self.source/'tests').mkdir();(self.source/'tests/test_maths.py').write_text('import unittest\nfrom maths import total\nclass Tests(unittest.TestCase):\n def test_sum(self): self.assertEqual(total(4),10)\n')
  ws.git(self.source,'add','.');ws.git(self.source,'-c','user.name=Hub Test','-c','user.email=hub-test@example.invalid','commit','-m','fixture')
  self.h=Hub(self.root/'hub');self.p=self.h.pipeline
  self.cfg=self.h.config.prepare({'mode':'coral','automatic':True,'agents':['claude','codex','cursor'],'endpoints':{a:'http://localhost:5555/'+a for a in ['ops','claude','codex','cursor']}});self.h.config.value=self.cfg;self.h.connected=True;self.h.threads=[{'threadId':'t','state':'open','messages':[]}];self.h.collaboration.ingest([],self.cfg);self.calls=[]
 def tearDown(self):self.h.close();self.tmp.cleanup()
 def body(self,**kw):return dict({'threadId':'t','request':'total(n)을 올바르게 구현하고 테스트하세요.','source':str(self.source),'roles':{'plan':['claude'],'implement':['codex'],'verify':['cursor','claude']},'testCommand':'"'+sys.executable+'" -m unittest discover -s tests -q','maxRepairs':1,'authorizeWrites':True},**kw)
 def start(self,**kw):return self.p.start(self.body(**kw))['id']
 def adapter(self,agent,cfg,context,incoming,folder,cancel,live):
  ctx=context['pipeline'];self.calls.append((agent,ctx['phase'],ctx['iteration']))
  if ctx['phase']=='implement':(Path(ctx['workspace'])/'maths.py').write_text('def total(n): return sum(range(n+1))\n')
  return {'task':ctx['task'],'status':'done','reply':'근거에 따라 단계 완료','messages':[]}
 def run_until_end(self,pid,adapter=None):
  until=time.monotonic()+20
  with patch('agent_hub.pipeline.adapters.execute',side_effect=adapter or self.adapter):
   while time.monotonic()<until:
    with self.h.lock:self.p.tick(self.cfg)
    if self.p.get(pid)['status']!='active' and not self.h.active:return self.p.snapshot(self.h.scope(self.cfg))[0]
    time.sleep(.02)
  self.fail('Pipeline did not terminate')
 def test_roles_sequence_real_tests_artifact_and_original_unchanged(self):
  before=ws.fingerprint(self.source,ws.source_info(str(self.source))[2]);pid=self.start();p=self.run_until_end(pid)
  self.assertEqual(p['status'],'completed',p['reason']);self.assertEqual(self.calls,[('claude','plan',1),('codex','implement',1),('cursor','verify',1),('claude','verify',1)])
  self.assertEqual(p['checks']['exit_code'],0);self.assertEqual(p['artifacts']['files'],['maths.py']);self.assertEqual(ws.fingerprint(self.source,p['base']),before)
  self.assertIn(b'return sum',self.p.artifact(pid,'changes.patch'));self.assertTrue(self.p.artifact(pid,'changed-files.zip').startswith(b'PK'));self.assertEqual(ws.git(p['workspace'],'remote'),b'')
 def test_host_failure_overrides_model_success_then_repairs(self):
  def fake(*args):
   ctx=args[2]['pipeline']
   if ctx['phase']=='implement' and ctx['iteration']==1:return {'task':ctx['task'],'status':'done','reply':'잘못 주장한 성공','messages':[]}
   return self.adapter(*args)
  p=self.run_until_end(self.start(),fake);self.assertEqual(p['status'],'completed',p['reason']);self.assertEqual(p['iteration'],2);self.assertTrue(any(e['kind']=='rework' for e in p['events']))
 def test_read_only_phase_mutation_blocks_completion(self):
  def fake(*args):
   ctx=args[2]['pipeline'];r=self.adapter(*args)
   if ctx['phase']=='verify':(Path(ctx['workspace'])/'maths.py').write_text('changed by reviewer')
   return r
  p=self.run_until_end(self.start(),fake);self.assertEqual(p['status'],'blocked');self.assertIsNone(p['artifacts']);self.assertIn('읽기 전용',p['reason'])
 def test_retry_limit_no_infinite_loop(self):
  def fake(*args):
   ctx=args[2]['pipeline'];return {'task':ctx['task'],'status':'done','reply':'아직 수정되지 않은 후보','messages':[]}
  p=self.run_until_end(self.start(maxRepairs=0),fake);self.assertEqual(p['status'],'blocked');self.assertEqual(p['iteration'],1);self.assertNotEqual(p['checks']['exit_code'],0)
 def test_peer_question_returns_read_only_answer_then_resumes(self):
  asked=[]
  def fake(*args):
   ctx=args[2]['pipeline'];r=self.adapter(*args)
   if ctx['phase']=='implement' and not asked:asked.append(True);r['messages']=[{'to':'claude','text':'계획의 성공 기준을 확인해 주세요.'}]
   if ctx['phase']=='consult':self.assertIn('성공 기준',ctx['question']);self.assertIn('question',[e['kind'] for e in ctx['handoffs']])
   return r
  p=self.run_until_end(self.start(),fake);self.assertEqual(p['status'],'completed',p['reason']);self.assertIn(('claude','consult',1),self.calls);self.assertEqual(sum(c[1]=='implement' for c in self.calls),2)
 def test_duplicate_project_and_channel_modes_are_blocked(self):
  pid=self.start();self.h.threads.append({'threadId':'other','state':'open','messages':[]})
  with self.assertRaises(ValueError):self.p.start(self.body(threadId='other'))
  with self.assertRaises(ValueError):self.h.voting.start({'threadId':'t','passage':'test','options':['A','B'],'mentions':['claude']})
  self.p.cancel(pid);self.assertEqual(self.p.get(pid)['status'],'cancelled')
 def test_invalid_roles_dirty_source_and_permission_are_rejected(self):
  for kw in ({'roles':{'plan':[],'implement':['codex'],'verify':['cursor']}},{'authorizeWrites':False},{'maxRepairs':True},{'testCommand':'missing-hub-command'}):
   with self.assertRaises(ValueError):self.p.start(self.body(**kw))
  (self.source/'dirty.txt').write_text('not committed')
  with self.assertRaises(ValueError):self.start()
 def test_restart_does_not_reexecute_writes(self):
  pid=self.start();self.h.db.execute("UPDATE pipeline_tasks SET status='running' WHERE pipeline_id=?",(pid,));self.h.db.commit();self.h.pipeline=Pipeline(self.h)
  self.assertEqual(self.h.pipeline.get(pid)['status'],'blocked')
 def test_artifact_traversal_and_unfinished_access_rejected(self):
  pid=self.start()
  for name in ('../config.json','changes.patch'):
   with self.assertRaises(ValueError):self.p.artifact(pid,name)
 def test_pipeline_messages_do_not_start_a_discussion(self):
  self.start();m={'sendingAgentName':'ops','mentionAgentNames':['claude'],'messageText':'새 메시지','messageTimestamp':time.time()};self.h.collaboration.ingest([{'threadId':'t','state':'open','messages':[m]}],self.cfg)
  self.assertEqual(self.h.db.execute('SELECT count(*) FROM collab_rounds').fetchone()[0],0)
 def test_cli_permissions_only_implementation_can_write(self):
  cfg={**self.cfg,'executables':{a:a+'.exe' for a in self.cfg['agents']}}
  for phase in ('plan','implement','verify','consult'):
   ctx={'phase':phase,'workspace':'isolated'}
   for agent in cfg['agents']:
    cmd=pipeline_command(agent,cfg,Path('logs'),ctx);self.assertFalse(any('bypass' in x or x=='--force' for x in cmd))
    if agent=='codex':self.assertEqual(cmd[cmd.index('--sandbox')+1],'workspace-write' if phase=='implement' else 'read-only')
    if agent=='claude':self.assertEqual('Write' in cmd[cmd.index('--tools')+1],phase=='implement')
    if agent=='cursor':self.assertEqual('--mode' not in cmd,phase=='implement')
 def test_validation_modifying_sources_is_blocked(self):
  command='"'+sys.executable+'" -c "from pathlib import Path; Path(\'maths.py\').write_text(\'oops\')"'
  p=self.run_until_end(self.start(testCommand=command));self.assertEqual(p['status'],'blocked');self.assertIsNone(p['artifacts'])

 def test_file_change_between_reviewers_invalidates_earlier_review(self):
  from agent_hub.pipeline import execute_task
  def mutate(agent,cfg,ctx,*args):
   if ctx['phase']=='verify' and agent=='claude':(Path(ctx['workspace'])/'maths.py').write_text('def total(n): return 999\n')
   return execute_task(agent,cfg,ctx,*args)
  with patch('agent_hub.pipeline.execute_task',side_effect=mutate):p=self.run_until_end(self.start())
  self.assertEqual(p['status'],'blocked');self.assertIsNone(p['artifacts']);self.assertIn('검증 담당자 사이',p['reason'])

 def test_optional_command_skips_execution_but_reviews_and_exports(self):
  with patch('agent_hub.pipeline.ws.run_check',side_effect=AssertionError('Must not execute')):
   p=self.run_until_end(self.start(testCommand='   '))
  self.assertEqual(p['status'],'completed',p['reason']);self.assertEqual(p['checks']['status'],'skipped');self.assertIsNone(p['checks']['exit_code'])
  self.assertEqual(sum(c[1]=='verify' for c in self.calls),2);self.assertIn('테스트 미실행',p['reason']);self.assertTrue(p['artifacts'])
  self.assertIn('skipped',self.p.artifact(p['id'],'report.md').decode())
 def test_no_tests_still_repairs_reviewer_objection(self):
  def fake(*args):
   ctx=args[2]['pipeline'];result=self.adapter(*args)
   if ctx['phase']=='verify' and ctx['iteration']==1:result['status']='changes_requested'
   return result
  with patch('agent_hub.pipeline.ws.run_check',side_effect=AssertionError('Must not execute')):
   p=self.run_until_end(self.start(testCommand=''),fake)
  self.assertEqual(p['status'],'completed',p['reason']);self.assertEqual(p['iteration'],2)
 def test_no_tests_still_blocks_file_changes_between_reviewers(self):
  from agent_hub.pipeline import execute_task
  def mutate(agent,cfg,ctx,*args):
   if ctx['phase']=='verify' and agent=='claude':(Path(ctx['workspace'])/'maths.py').write_text('changed')
   return execute_task(agent,cfg,ctx,*args)
  with patch('agent_hub.pipeline.execute_task',side_effect=mutate):p=self.run_until_end(self.start(testCommand=''))
  self.assertEqual(p['status'],'blocked');self.assertIsNone(p['artifacts'])

 def test_followup_work_context_is_scoped_frozen_and_not_a_requirement(self):
  pid=self.start(testCommand='');self.p.end(pid,'blocked','read tool failed')
  scope=self.h.scope(self.cfg);c=self.h.collaboration
  rid=c.start(scope,self.h.threads[0],{'messageText':'방금 작업 왜 멈췄어?','mentionAgentNames':['codex']},self.cfg)
  task=self.h.db.execute('SELECT * FROM collab_tasks WHERE round_id=?',(rid,)).fetchone();ctx=c.task_context(task)
  self.assertEqual(ctx['previous_work']['id'],pid);self.assertEqual(ctx['previous_work']['test_status'],'not_run')
  self.assertEqual(ctx['previous_work']['reason'],'read tool failed');self.assertEqual(len(ctx['requirements']),1)
  self.assertNotIn('pipeline_context',[e['kind'] for e in ctx['inbox']])
  self.h.db.execute("UPDATE pipelines SET reason='changed later' WHERE id=?",(pid,))
  self.assertEqual(c.task_context(task)['previous_work']['reason'],'read tool failed')
  self.assertIsNone(self.p.discussion_context(scope,'other','anything'));self.assertIsNone(self.p.discussion_context('other', 't','anything'))
  self.assertIsNone(self.p.discussion_context(scope,'other',pid))
 def test_followup_explicit_old_work_and_active_exclusion(self):
  first=self.start(testCommand='');self.p.end(first,'cancelled','first')
  second=self.start(testCommand='');scope=self.h.scope(self.cfg)
  self.assertEqual(self.p.discussion_context(scope,'t','recent')['id'],first)
  self.p.end(second,'blocked','second')
  self.assertEqual(self.p.discussion_context(scope,'t','recent')['id'],second)
  self.assertEqual(self.p.discussion_context(scope,'t','작업 ID: '+first)['id'],first)
 def test_native_read_path_does_not_enable_write_or_bypass(self):
  from agent_hub.pipeline import instructions
  cmd=pipeline_command('codex',{**self.cfg,'executables':{'codex':'codex.exe'}},Path('logs'),{'phase':'plan','workspace':'copy'})
  self.assertIn('mcp_servers.node_repl.enabled=false',cmd);self.assertEqual(cmd[cmd.index('--sandbox')+1],'read-only')
  self.assertIn('Native read-only',instructions({'task':'t'}));self.assertFalse(any('bypass' in v for v in cmd))

 def test_followup_reuses_workspace_preserves_original_and_prior_artifact(self):
  original=ws.fingerprint(self.source,ws.source_info(str(self.source))[2]);first=self.run_until_end(self.start(testCommand=''))
  old_patch=self.p.artifact(first['id'],'changes.patch');self.calls.clear()
  def docs(*args):
   ctx=args[2]['pipeline'];self.calls.append((args[0],ctx['phase'],ctx['iteration']))
   self.assertEqual(ctx['prior_work']['id'],first['id'])
   if ctx['phase']=='implement':(Path(ctx['workspace'])/'GUIDE.md').write_text('Documentation of total(n)')
   return {'task':ctx['task'],'status':'done','reply':'문서 추가와 자체 검토 완료','messages':[]}
  second=self.run_until_end(self.start(parentId=first['id'],mode='single',agent='codex',testCommand=''),docs)
  self.assertEqual(second['status'],'completed',second['reason']);self.assertEqual(second['workspace'],first['workspace'])
  self.assertEqual([x[1] for x in self.calls],['implement','verify']);self.assertIn('GUIDE.md',second['artifacts']['files']);self.assertIn('maths.py',second['artifacts']['files'])
  self.assertEqual(old_patch,self.p.artifact(first['id'],'changes.patch'));self.assertEqual(ws.fingerprint(self.source,first['base']),original)
  self.assertFalse(next(p for p in self.p.snapshot(self.h.scope(self.cfg)) if p['id']==first['id'])['can_followup'])
  with self.assertRaises(ValueError):self.start(parentId=first['id'],testCommand='')
 def test_individual_read_only_followup_and_further_work(self):
  first=self.run_until_end(self.start(testCommand=''));self.calls.clear()
  second=self.run_until_end(self.start(parentId=first['id'],mode='inspect',agent='cursor',authorizeWrites=False,testCommand=''))
  self.assertEqual(second['status'],'completed',second['reason']);self.assertIsNone(second['artifacts']);self.assertEqual([x[1] for x in self.calls],['inspect'])
  third=self.run_until_end(self.start(parentId=second['id'],mode='single',agent='claude',testCommand=''))
  self.assertEqual(third['status'],'completed',third['reason']);self.assertEqual(third['workspace'],first['workspace'])
 def test_individual_question_cannot_write(self):
  def bad(*args):
   ctx=args[2]['pipeline'];(Path(ctx['workspace'])/'bad.txt').write_text('not allowed');return self.adapter(*args)
  p=self.run_until_end(self.start(mode='inspect',agent='codex',authorizeWrites=False,testCommand=''),bad)
  self.assertEqual(p['status'],'blocked');self.assertIn('읽기 전용',p['reason'])
 def test_followup_rejects_external_changes_cross_channel_and_concurrency(self):
  p=self.run_until_end(self.start(testCommand=''));self.h.threads.append({'threadId':'other','state':'open','messages':[]})
  with self.assertRaises(ValueError):self.start(parentId=p['id'],threadId='other')
  second=self.start(parentId=p['id'],testCommand='')
  with self.assertRaises(ValueError):self.start(parentId=p['id'],testCommand='')
  self.p.cancel(second)
  # A stale parent cannot silently roll back the current workspace.
  with self.assertRaises(ValueError):self.start(parentId=p['id'],testCommand='')
 def test_modified_completed_workspace_is_rejected(self):
  p=self.run_until_end(self.start(testCommand=''));(Path(p['workspace'])/'external.txt').write_text('external edit')
  with self.assertRaises(ValueError):self.start(parentId=p['id'],testCommand='')
 def test_single_mode_validation(self):
  for kw in ({'mode':'unsupported'},{'mode':'single','agent':'unknown'},{'mode':'inspect','agent':'codex','testCommand':'python -m unittest'}):
   with self.assertRaises(ValueError):self.start(**kw)
