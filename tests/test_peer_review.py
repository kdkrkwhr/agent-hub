import json
import unittest
import test_collaboration as fixtures

class PeerReviewTests(unittest.TestCase):
 setUp=fixtures.CollaborationTests.setUp
 tearDown=fixtures.CollaborationTests.tearDown
 task=fixtures.CollaborationTests.task
 reply=fixtures.CollaborationTests.reply
 to_review=fixtures.CollaborationTests.to_review
 def request(self,mentions=None):
  rid=fixtures.CollaborationTests.request(self,mentions=mentions)
  self.c.event(rid,'hub','peer_review_policy','Author excluded',[])
  return rid
 def approve_peers(self):
  self.reply(self.task('codex'),reply='찬성')
  self.reply(self.task('cursor'),reply='찬성')
 def test_author_excluded_and_seven_calls(self):
  rid=self.request();self.to_review(rid)
  self.assertIsNone(self.task('claude'))
  self.assertEqual(self.c.reviewers(self.c.get(rid)),['codex','cursor'])
  self.reply(self.task('codex'),reply='찬성')
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.reply(self.task('cursor'),reply='찬성')
  r=self.c.get(rid)
  self.assertEqual(r['status'],'agreed')
  self.assertIn('작성: CLAUDE',r['final'])
  self.assertIn('검토 승인: CODEX, CURSOR',r['final'])
  self.assertEqual(self.hub.db.execute("SELECT count(*) FROM collab_tasks WHERE status='done'").fetchone()[0],7)
 def test_solo_is_unreviewed_and_still_static_checked(self):
  rid=self.request(mentions=['cursor'])
  for _ in range(3):self.reply(self.task())
  r=self.c.get(rid)
  self.assertEqual(r['status'],'agreed')
  self.assertIn('상호 검증 없음',r['final'])
  self.assertNotIn('검토 승인:',r['final'])
  self.assertEqual(self.hub.db.execute("SELECT count(*) FROM collab_tasks WHERE stage='review'").fetchone()[0],0)
  rid=self.c.start(self.hub.scope(self.cfg),{'threadId':'solo2'},{'messageText':'Check arithmetic','mentionAgentNames':['cursor']},self.cfg)
  self.reply(self.task());self.reply(self.task());self.reply(self.task(),reply='2 + 2 = 5')
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.assertEqual(self.c.get(rid)['stage'],'resolve')
 def test_objection_revises_then_only_peers_reapprove(self):
  rid=self.request();self.to_review(rid)
  self.reply(self.task('codex'),'OBJECT',issues=[{'owner':'claude','question':'Correct the missing constraint'}])
  self.reply(self.task('cursor'))
  self.assertEqual(self.task('claude')['stage'],'resolve')
  self.reply(self.task('claude'),reply='Correction evidence')
  self.reply(self.task('claude'),reply='Revised candidate')
  self.assertIsNone(self.task('claude'))
  self.assertEqual(self.c.get(rid)['version'],2)
  self.approve_peers()
  self.assertEqual(self.c.get(rid)['status'],'agreed')
 def test_actual_author_can_differ_from_lead(self):
  rid=self.request()
  for _ in range(4):self.reply(self.task())
  self.hub.db.execute("UPDATE collab_tasks SET agent='codex' WHERE round_id=? AND stage='synthesize'",(rid,))
  self.reply(self.task('codex'),reply='Codex authored final')
  self.assertIsNone(self.task('codex'))
  self.assertEqual(self.c.reviewers(self.c.get(rid)),['claude','cursor'])
  self.reply(self.task('claude'));self.reply(self.task('cursor'))
  self.assertIn('작성: CODEX',self.c.get(rid)['final'])
 def test_author_correction_via_consult_invalidates_candidate(self):
  rid=self.request();self.to_review(rid)
  event=self.c.event(rid,'codex','question','Check your conclusion',['claude'])
  self.c.consult(rid,'claude',event)
  self.approve_peers()
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.reply(self.task('claude'),reply='An error needs correction')
  self.assertEqual(self.c.get(rid)['stage'],'synthesize')
  self.reply(self.task('claude'),reply='Corrected conclusion')
  self.assertEqual(self.c.get(rid)['version'],2)
  self.approve_peers()
  self.assertEqual(self.c.get(rid)['status'],'agreed')

if __name__=='__main__':unittest.main()
