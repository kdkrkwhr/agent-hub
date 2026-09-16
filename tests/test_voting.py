import json
import tempfile
import time
import unittest
from concurrent.futures import Future
from unittest.mock import patch
from agent_hub.engine import Hub
from agent_hub.voting import instructions

class VotingTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.h=Hub(self.temp.name);self.v=self.h.voting
  self.cfg=self.h.config.prepare({'mode':'coral','automatic':True,'agents':['claude','codex','cursor'],'endpoints':{a:'http://localhost:5555/'+a for a in ['ops','claude','codex','cursor']}})
  self.h.config.value=self.cfg;self.h.connected=True;self.h.threads=[{'threadId':'t','state':'open','messages':[]}];self.h.collaboration.ingest([],self.cfg)
 def tearDown(self):self.h.close();self.temp.cleanup()
 def start(self,**kw):return self.v.start(dict(threadId='t',passage='동일 지문',options=['대안 하나','대안 둘'],mentions=['claude','codex'],minutes=15,**kw))['id']
 def ballot(self,pid,agent):return self.h.db.execute('SELECT * FROM ballots WHERE poll_id=? AND agent=?',(pid,agent)).fetchone()
 def reply(self,pid,a,choice='A',**kw):
  b=self.ballot(pid,a);self.h.db.execute("UPDATE ballots SET status='running' WHERE id=?",(b['id'],));self.v.finish(b,dict(ballot=b['id'],choice=choice,reply='비공개 주장',reason='개인 판단 근거',concern='개인 불확실성',**kw));self.h.db.commit()
 def snap(self):return self.h.snapshot()['polls'][0]
 def settle(self):
  with patch.object(self.h.pool,'submit',side_effect=AssertionError('unexpected extra call')):self.v.tick(self.cfg)
 def test_only_mentions_and_frozen_independent_context(self):
  p=self.start();self.assertEqual(self.snap()['team'],['claude','codex']);self.assertIsNone(self.ballot(p,'cursor'))
  before=self.v.context(self.ballot(p,'codex'));self.reply(p,'claude');after=self.v.context(self.ballot(p,'codex'))
  self.assertEqual(before,after);self.assertEqual(set(before),{'ballot','passage','options'});self.assertNotIn('비공개 주장',instructions(after))
 def test_all_surfaces_hide_votes_until_everyone_finishes(self):
  p=self.start();self.reply(p,'claude');s=json.dumps(self.h.snapshot(),ensure_ascii=False)
  for secret in ['비공개 주장','개인 판단 근거','개인 불확실성','counts','leaders']:self.assertNotIn(secret,s)
  self.assertNotIn('비공개 주장',json.dumps(self.h.result(self.ballot(p,'claude')['id']),ensure_ascii=False))
  self.reply(p,'codex','B');self.settle();s=self.snap();self.assertEqual(s['status'],'revealed');self.assertEqual(s['leaders'],['A','B']);self.assertEqual(s['counts'],{'A':1,'B':1});self.assertIn('비공개 주장',json.dumps(s,ensure_ascii=False))
 def test_timeout_missing_distinct_from_abstain_and_late_ignored(self):
  p=self.start();self.reply(p,'claude','ABSTAIN');self.h.db.execute('UPDATE polls SET deadline=? WHERE id=?',(time.time()-1,p));self.settle();s=self.snap()
  self.assertEqual(s['leaders'],[]);self.assertEqual(next(b for b in s['ballots'] if b['agent']=='codex')['status'],'missing')
  b=self.ballot(p,'codex');self.v.finish(b,dict(ballot=b['id'],choice='A',reply='late',reason='late',concern='late'));self.assertEqual(self.snap()['counts'],{'A':0,'B':0})
 def test_cancel_never_reveals_submitted_votes(self):
  p=self.start();self.reply(p,'claude');self.v.cancel(p);self.assertEqual(self.snap()['status'],'cancelled');self.assertNotIn('비공개 주장',json.dumps(self.snap(),ensure_ascii=False));self.assertNotIn('비공개 주장',json.dumps(self.h.result(self.ballot(p,'claude')['id']),ensure_ascii=False))
 def test_malformed_vote_is_failure_not_abstention_or_extra_call(self):
  p=self.start();self.reply(p,'claude','Z');self.reply(p,'codex','ABSTAIN');self.settle();s=self.snap();self.assertEqual(s['submitted'],1);self.assertEqual(s['leaders'],[]);self.assertEqual(next(b for b in s['ballots'] if b['agent']=='claude')['status'],'failed')
 def test_existing_discussion_and_invalid_inputs_are_rejected(self):
  body=dict(threadId='t',passage='지문',options=['A','B'],mentions=['claude'],minutes=15)
  for field,value in [('options',['x','X']),('options',['x']),('mentions',[]),('mentions',['unknown']),('minutes',True),('passage','')]:
   with self.assertRaises(ValueError):self.v.start({**body,field:value})
  p=self.start()
  with self.assertRaises(ValueError):self.v.start(body)
  self.v.cancel(p);self.h.collaboration.start(self.h.scope(self.cfg),{'threadId':'t'},{'messageText':'토론','mentionAgentNames':['claude']},self.cfg)
  with self.assertRaises(ValueError):self.v.start(body)
 def test_new_messages_never_change_ballot_or_start_debate(self):
  p=self.start();before=self.v.context(self.ballot(p,'codex'));stamp=time.time();m={'sendingAgentName':'ops','messageTimestamp':stamp,'mentionAgentNames':['claude'],'messageText':'새 지침'}
  self.h.collaboration.ingest([{'threadId':'t','state':'open','messages':[m]}],self.cfg);self.assertEqual(self.h.db.execute('SELECT count(*) FROM collab_rounds').fetchone()[0],0);self.assertEqual(self.v.context(self.ballot(p,'codex')),before)
  self.v.cancel(p);m['messageText']='늦게 수신된 지침';self.h.collaboration.ingest([{'threadId':'t','state':'open','messages':[m]}],self.cfg);self.assertEqual(self.h.db.execute('SELECT count(*) FROM collab_rounds').fetchone()[0],0)
 def test_native_launch_is_once_and_strips_workspace_hooks_history(self):
  p=self.start();f=Future()
  with patch.object(self.h.pool,'submit',return_value=f) as submit:
   self.v.tick(self.cfg);self.v.tick(self.cfg);self.assertEqual(submit.call_count,2)
   for call in submit.call_args_list:
    _,agent,cfg,context,*_=call.args;self.assertEqual(cfg['workspace'],'');self.assertEqual(cfg['zero_turn_agents'],[]);self.assertEqual(set(context),{'voting'});self.assertNotIn('team',context['voting'])
  self.v.cancel(p);f.set_result({});self.v.tick(self.cfg)
 def test_restart_marks_inflight_failed_without_relaunch(self):
  p=self.start();self.h.db.execute("UPDATE ballots SET status='running' WHERE poll_id=?",(p,));self.h.db.commit()
  from agent_hub.voting import Voting
  self.h.voting=Voting(self.h);self.v=self.h.voting;self.settle();self.assertEqual(self.snap()['status'],'revealed');self.assertTrue(all(b['status']=='failed' for b in self.snap()['ballots']))
 def test_coral_posts_only_one_terminal_result_without_mentions(self):
  p=self.start()
  with patch.object(self.h,'peer') as peer:
   self.v.deliver(self.cfg,self.h.threads);peer.assert_not_called();self.reply(p,'claude');self.reply(p,'codex');self.settle();self.v.deliver(self.cfg,self.h.threads);self.v.deliver(self.cfg,self.h.threads);self.assertEqual(peer.return_value.tool.call_count,1);self.assertEqual(peer.return_value.tool.call_args.kwargs['mentions'],[])
 def test_closed_channel_and_observe_mode_cancel(self):
  p=self.start();self.v.suspend(self.h.scope(self.cfg),'닫힘','t');self.assertEqual(self.snap()['status'],'cancelled')
 def test_demo_is_labelled_and_never_calls_cli(self):
  self.h.config.value={**self.cfg,'mode':'demo'};p=self.start()
  with patch.object(self.h.pool,'submit',side_effect=AssertionError('CLI called in demo')):self.v.tick(self.h.config.value)
  s=self.snap();self.assertTrue(s['demo']);self.assertEqual(s['status'],'revealed');self.assertTrue(all('데모' in b['reply'] for b in s['ballots']))
