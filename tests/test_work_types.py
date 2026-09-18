import unittest
import test_pipeline as fixtures
from agent_hub import work_types
from agent_hub.pipeline import instructions

class WorkTypeTests(unittest.TestCase):
 setUp=fixtures.PipelineTests.setUp
 tearDown=fixtures.PipelineTests.tearDown
 body=fixtures.PipelineTests.body
 def test_auto_and_override(self):
  for text,mode,expected in [('README 수정','team','documentation'),('응답 성능 개선','team','improvement'),('검색 기능 추가','team','development'),('기능 분석','inspect','research')]:
   self.assertEqual(work_types.resolve('auto',text,mode),expected)
  self.assertEqual(work_types.resolve('development','README 수정','team'),'development')
  with self.assertRaises(ValueError):work_types.resolve('unknown','x','team')
 def test_stored_type_context_and_snapshot(self):
  pid=self.p.start(self.body(workType='improvement'))['id']
  task=self.h.db.execute('SELECT * FROM pipeline_tasks WHERE pipeline_id=?',(pid,)).fetchone()
  ctx=self.p.context(task)
  self.assertEqual(ctx['work_type'],'improvement')
  self.assertIn('before/after evidence',instructions(ctx))
  snap=self.p.snapshot(self.h.scope(self.cfg))[0]
  self.assertEqual(snap['work_type'],'improvement')
  self.assertEqual(snap['work_type_selection'],'improvement')
 def test_research_cannot_enable_writes(self):
  with self.assertRaises(ValueError):self.p.start(self.body(workType='research'))
  pid=self.p.start(self.body(workType='research',mode='inspect',agent='codex',authorizeWrites=False,testCommand=''))['id']
  self.assertEqual(self.p.work_type(pid)['resolved'],'research')
  self.assertEqual(self.h.db.execute('SELECT mode FROM pipeline_links WHERE pipeline_id=?',(pid,)).fetchone()[0],'inspect')
 def test_old_records_are_not_reclassified(self):
  self.assertEqual(self.p.work_type('legacy'),{'selection':'auto','resolved':None})
 def test_unknown_type_creates_no_work(self):
  with self.assertRaises(ValueError):self.p.start(self.body(workType='bad'))
  self.assertEqual(self.h.db.execute('SELECT count(*) FROM pipelines').fetchone()[0],0)

if __name__=='__main__':unittest.main()
