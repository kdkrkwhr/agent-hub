import tempfile
import unittest
from pathlib import Path
from agent_hub.engine import Hub
class NotificationTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.h=Hub(self.root);self.h.save({'mode':'demo','agents':['codex']});self.scope=self.h.scope(self.h.config.value)
 def tearDown(self):self.h.close();self.tmp.cleanup()
 def job(self,status='failed',attempt=1):
  self.h.db.execute("INSERT OR REPLACE INTO jobs(id,scope,tid,agent,status,attempt,ended,error) VALUES ('j',?,'demo-welcome','codex',?,?,123,'test')",(self.scope,status,attempt));self.h.db.commit()
 def test_dedup_read_restart_retry(self):
  self.job();items=self.h.notifications.snapshot();self.assertEqual(len(items),1);self.assertEqual(items[0]['kind'],'failed')
  self.h.notifications.read([items[0]['id']]);self.assertEqual(self.h.notifications.snapshot()[0]['seen'],1)
  self.h.close();self.h=Hub(self.root);self.assertEqual(self.h.notifications.snapshot()[0]['seen'],1)
  self.job('done',2);self.assertEqual(len(self.h.notifications.snapshot()),2)
  self.h.config.value=dict(self.h.config.value,agents=['cursor']);self.assertEqual(self.h.notifications.snapshot(),[])
 def test_attention_and_deleted_channels(self):
  self.h.db.execute("INSERT INTO pipelines(id,scope,tid,status,request,created,ended) VALUES ('p',?,'demo-welcome','blocked','Check result',100,200)",(self.scope,));self.h.db.commit()
  self.assertEqual(self.h.notifications.snapshot()[0]['kind'],'attention')
  self.h.db.execute("INSERT INTO deleted_channels VALUES (?,'demo-welcome',201)",(self.scope,));self.h.db.commit();self.assertEqual(self.h.notifications.snapshot(),[])
 def test_cancelled_not_notified_and_invalid_read_rejected(self):
  self.job('cancelled');self.assertEqual(self.h.notifications.snapshot(),[])
  for value in [None,'all',[3],['x']*101]:
   with self.assertRaises(ValueError):self.h.notifications.read(value)
