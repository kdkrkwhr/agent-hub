import json
import threading
import unittest
import urllib.request
import urllib.error
import test_collaboration as fixtures
from agent_hub.discussion_export import export_channel
from agent_hub.server import make_server

class ExportTests(unittest.TestCase):
 setUp=fixtures.CollaborationTests.setUp
 tearDown=fixtures.CollaborationTests.tearDown
 request=fixtures.CollaborationTests.request
 task=fixtures.CollaborationTests.task
 reply=fixtures.CollaborationTests.reply
 to_review=fixtures.CollaborationTests.to_review
 def channel(self):
  self.hub.threads=[{'threadId':'t','threadName':'한글 / 토론: 기록','state':'closed','detached':True,'messages':[{'sendingAgentName':'ops','messageText':'# 원문 제목\n\n```python\nprint(1)\n```\n\n|항목|값|\n|---|---|\n|A|1|','messageTimestamp':1}]}]
 def test_markdown_preserves_structure_long_content_and_final_once(self):
  self.channel();rid=self.request();self.to_review(rid)
  for _ in range(3):self.reply(self.task())
  final=self.c.get(rid)['final'];self.hub.threads[0]['messages'].append({'sendingAgentName':'claude','messageText':final+'\n[COLLAB-FINAL:'+rid+']'})
  long='긴 근거 '*2000;self.c.event(rid,'codex','notice',long,['cursor'])
  data=export_channel(self.hub,'t');md=data['markdown']
  self.assertIn('> ```python\n> print(1)\n> ```',md);self.assertIn('> |항목|값|',md)
  self.assertIn(long,md);self.assertEqual(md.count('## 최종 합의안'),1)
  self.assertIn('검토: V1 · APPROVE',md);self.assertIn('받는 에이전트: CURSOR',md)
  self.assertNotIn('/',data['filename']);self.assertTrue(data['filename'].endswith('.md'))
 def test_sealed_opinions_are_excluded_until_reveal(self):
  self.channel();rid=self.request();self.reply(self.task('claude'),reply='PRIVATE-OPINION')
  self.assertNotIn('PRIVATE-OPINION',export_channel(self.hub,'t')['markdown'])
  self.reply(self.task('codex'));self.reply(self.task('cursor'))
  self.assertIn('PRIVATE-OPINION',export_channel(self.hub,'t')['markdown'])
 def test_entire_history_scope_and_unknown_channel(self):
  self.channel()
  for n in range(23):
   rid=self.request('request-'+str(n),n+1);self.c.end(rid,'cancelled','test')
  md=export_channel(self.hub,'t')['markdown'];self.assertIn('토론 수: 23',md)
  self.assertIn('request-0',md);self.assertIn('request-22',md)
  original=self.hub.config.value;self.hub.config.value=dict(original,agents=['cursor'])
  self.assertIn('토론 수: 0',export_channel(self.hub,'t')['markdown'])
  with self.assertRaises(ValueError):export_channel(self.hub,'unknown')
 def test_http_download_data_and_cross_origin_rejection(self):
  self.channel();self.request()
  server=make_server(self.hub,0);worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
  url=f'http://127.0.0.1:{server.server_port}/api/thread/export?threadId=t'
  try:
   with urllib.request.urlopen(url) as response:self.assertIn('## 목차',json.load(response)['markdown'])
   request=urllib.request.Request(url,headers={'Origin':'https://evil.example'})
   with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(request)
   self.assertEqual(e.exception.code,403)
   with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(url+'missing')
   self.assertEqual(e.exception.code,404)
  finally:server.shutdown();worker.join();server.server_close()
