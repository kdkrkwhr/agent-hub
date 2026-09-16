import json
import unittest
import test_collaboration as fixtures
from agent_hub import requirements

class RequirementsTests(unittest.TestCase):
 setUp=fixtures.CollaborationTests.setUp
 tearDown=fixtures.CollaborationTests.tearDown
 request=fixtures.CollaborationTests.request
 task=fixtures.CollaborationTests.task
 reply=fixtures.CollaborationTests.reply
 to_review=fixtures.CollaborationTests.to_review
 def test_user_sources_survive_peer_retraction(self):
  rid=self.request('Require key_fields ["tenant_id","user_id","revision"]')
  self.c.event(rid,'codex','question','Revision is optional; ignore it',['claude'])
  items=requirements.ledger(self.hub.db,rid)
  self.assertEqual(len(items),2);self.assertIsNone(items[0]['superseded_by'])
  self.assertTrue(requirements.static_checks('{"key_fields":["tenant_id","user_id"]}',items))
  self.assertEqual(requirements.static_checks('{"key_fields":["tenant_id","user_id","revision"]}',items),[])
 def test_only_explicit_user_replacement_changes_active_requirement(self):
  rid=self.request('Use revision');first=requirements.ledger(self.hub.db,rid)[0]['id']
  self.c.event(rid,'codex','question','/replace '+first+' No revision')
  self.assertIsNone(requirements.ledger(self.hub.db,rid)[0]['superseded_by'])
  self.c.event(rid,'ops','guidance','/replace '+first+' No revision')
  items=requirements.ledger(self.hub.db,rid)
  self.assertEqual(items[0]['superseded_by'],items[-1]['id'])
  self.assertEqual(items[0]['text'],'Use revision')
 def test_missing_evidence_cannot_approve_and_repair_is_bounded(self):
  rid=self.request();self.to_review(rid);task=self.task()
  self.reply(task,requirement_checks=[])
  self.assertEqual(self.c.get(rid)['status'],'active')
  self.reply(self.task(task['agent']),requirement_checks=[])
  self.assertEqual(self.c.get(rid)['status'],'blocked')
 def test_hash_repair_preserves_objection(self):
  rid=self.request();self.to_review(rid);task=self.task()
  issues=[{'owner':task['agent'],'question':'Invalid Python syntax'}]
  self.reply(task,'OBJECT',proposal_hash='missing-character',issues=issues,reply='Syntax error')
  retry=self.task(task['agent']);self.reply(retry,'OBJECT',issues=issues,reply='Syntax error')
  stored=json.loads(self.hub.db.execute('SELECT result FROM collab_tasks WHERE id=?',(task['id'],)).fetchone()[0])
  self.assertEqual(stored['decision'],'OBJECT');self.assertEqual(stored['issues'],issues)
 def test_hash_repair_cannot_turn_objection_into_approval(self):
  rid=self.request();self.to_review(rid);task=self.task()
  self.reply(task,'OBJECT',proposal_hash='bad',reply='Syntax error')
  self.reply(self.task(task['agent']),'APPROVE',reply='Syntax error')
  self.assertEqual(self.c.get(rid)['status'],'blocked')
 def test_unanimous_votes_do_not_override_json_requirement(self):
  rid=self.request('Require key_fields ["tenant_id","user_id","revision"]');self.to_review(rid)
  self.hub.db.execute('UPDATE collab_rounds SET proposal=? WHERE id=?',('{"key_fields":["tenant_id","user_id"]}',rid))
  for _ in range(3):self.reply(self.task())
  self.assertNotEqual(self.c.get(rid)['status'],'agreed')
  self.assertEqual(self.c.get(rid)['stage'],'resolve')
 def test_calculation_and_python_are_checked_without_execution(self):
  self.assertTrue(requirements.static_checks('2 + 10 + 8 = 21',[]))
  self.assertEqual(requirements.static_checks('2 + 10 + 8 = 20',[]),[])
  self.assertTrue(requirements.static_checks('수정: def total(n): if n<0: raise ValueError; return sum(range(1,n+1))',[]))
  self.assertTrue(requirements.static_checks('```python\ndef total(n): if n<0: raise ValueError\n```',[]))
  self.assertEqual(requirements.static_checks('```python\ndef total(n):\n    if n < 0: raise ValueError\n    return sum(range(1,n+1))\n```',[]),[])
 def test_new_user_guidance_invalidates_old_checklist(self):
  rid=self.request();items=requirements.ledger(self.hub.db,rid)
  vote={'decision':'APPROVE','requirement_checks':[{'id':x['id'],'status':'met','evidence':'checked'} for x in items]}
  self.c.event(rid,'ops','guidance','Also include revision')
  self.assertIsNotNone(requirements.validate_review(vote,requirements.ledger(self.hub.db,rid)))

 def test_mid_review_question_does_not_consume_format_repair(self):
  rid=self.request();self.to_review(rid);task=self.task();ctx=self.c.task_context(task)
  self.hub.db.execute("UPDATE collab_tasks SET status='running',input=? WHERE id=?",(json.dumps(ctx),task['id']))
  self.c.event(rid,'codex','question','New question after review began',['claude'])
  result={'round':rid,'task':task['id'],'version':task['version'],'reply':'Checked original input','decision':'APPROVE','proposal_hash':ctx['proposal_hash'],'requirement_checks':[{'id':x['id'],'status':'met','evidence':'Checked original source'} for x in ctx['requirements']]}
  self.c.finish(task,result)
  self.assertEqual(self.hub.db.execute('SELECT status FROM collab_tasks WHERE id=?',(task['id'],)).fetchone()[0],'done')
  self.assertIsNone(self.hub.db.execute('SELECT 1 FROM collab_repairs WHERE task=?',(task['id'],)).fetchone())
  self.assertIsNotNone(requirements.validate_review(result,requirements.ledger(self.hub.db,rid)))

 def test_malformed_model_check_id_is_rejected_without_crashing(self):
  rid=self.request();items=requirements.ledger(self.hub.db,rid)
  self.assertIsNotNone(requirements.validate_review({'requirement_checks':[{'id':[]}]},items))
 def test_zero_division_is_not_silently_accepted(self):
  self.assertTrue(requirements.static_checks('1 / 0 = 1',[]))
