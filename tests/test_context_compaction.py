import copy
import json
import unittest
from agent_hub.collaboration import model_context,instructions

class ContextCompactionTests(unittest.TestCase):
 def context(self,phase='review'):
  text='사용자 조건을 빠짐없이 지킵니다. '*150
  return dict(round='r',task='t',version=1,phase=phase,agent='codex',team=['claude','codex'],request=text,proposal='확인된 최종안',proposal_hash='abc',requirements=[dict(id='R1',kind='request',text=text,superseded_by=None),dict(id='R2',kind='guidance',text='추가 조건 전문',superseded_by=None)],independent_opinions=[dict(agent='claude',opinion=text),dict(agent='codex',opinion='독립적인 반대 근거')],inbox=[dict(id=2,kind='guidance',content='추가 조건 전문'),dict(id=3,kind='question',content='미해결 질문 전문'),dict(id=4,kind='notice',content='미해결 질문 전문')],unread_event_ids=[2,3,4],issues=[dict(question='남은 쟁점',resolution='보존할 근거')],format_correction={},previous_work=None)
 def test_exact_duplicates_use_references_without_mutating_saved_context(self):
  ctx=self.context();original=copy.deepcopy(ctx);wire=model_context(ctx)
  self.assertEqual(ctx,original)
  self.assertEqual(wire['requirements'][0]['text_ref'],'request')
  self.assertEqual(wire['independent_opinions'][0]['opinion_ref'],'request')
  self.assertEqual(wire['inbox'][0]['content_ref'],'requirements.R2.text')
  self.assertEqual(wire['inbox'][2]['content_ref'],'inbox.3.content')
  self.assertEqual(wire['inbox'][1]['content'],'미해결 질문 전문')
  self.assertEqual(wire['unread_event_ids'],[2,3,4])
  self.assertEqual(wire['issues'],ctx['issues'])
  self.assertLess(len(json.dumps(wire,ensure_ascii=False)),len(json.dumps(ctx,ensure_ascii=False))*.6)
 def test_only_current_phase_contract_and_shared_safety_rules(self):
  phases=['explore','debate','respond','consult','plan','execute','resolve','synthesize','review']
  for phase in phases:
   prompt=instructions(self.context(phase))
   for other in phases:self.assertEqual('Phase '+other+':' in prompt,other==phase)
   self.assertIn('Remain read-only',prompt)
   self.assertIn('immutable source obligations',prompt)
   self.assertIn('preserve an original OBJECT',prompt)
   self.assertIn('Answer unread questions',prompt)
 def test_repair_and_previous_work_are_not_summarized(self):
  ctx=self.context();ctx['format_correction']={'result':'original objection','feedback':'fix hash only'};ctx['previous_work']={'status':'blocked','report':'original evidence'}
  wire=model_context(ctx)
  self.assertEqual(wire['format_correction'],ctx['format_correction'])
  self.assertEqual(wire['previous_work'],ctx['previous_work'])
  self.assertEqual(wire['independent_opinions'][1]['opinion'],'독립적인 반대 근거')

if __name__=='__main__':unittest.main()
