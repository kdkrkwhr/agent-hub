import json
import io
import time
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error

from agent_hub.config import Config, valid_url
from agent_hub.coral import Peer, TransportError
from agent_hub.engine import Hub
from agent_hub.server import make_server
from agent_hub.adapters import parse_reply


class HubTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.hub=Hub(Path(self.temp.name))

    def tearDown(self):
        self.hub.close()
        self.temp.cleanup()

    def coral_config(self):
        return self.hub.config.prepare({'mode':'coral','agents':['codex'],
            'endpoints':{'ops':'http://localhost:5555/secret-ops','codex':'http://localhost:5555/secret-codex'}})

    def thread(self,messages):
        return {'threadId':'t1','state':'open','messages':messages}

    def msg(self,text='hello',sender='ops'):
        return {'sendingAgentName':sender,'messageText':text,'mentionAgentNames':['codex'],'messageTimestamp':1}

    def test_demo_never_enables_automatic(self):
        self.hub.save({'mode':'demo','agents':['codex'],'automatic':True})
        self.assertFalse(self.hub.config.value['automatic'])
        tid=self.hub.new_thread('Unicode \ud55c\uae00')
        self.hub.message(tid,'hello',['codex'])
        self.assertEqual(len(self.hub.threads[-1]['messages']),2)
        self.assertFalse(self.hub.active)

    def test_close_demo_persists_and_is_read_only(self):
        self.hub.save({'mode':'demo','agents':['codex']})
        tid=self.hub.new_thread('Close test')
        self.hub.message(tid,'keep this',['codex'])
        self.hub.close_thread(tid,'Finished')
        with self.assertRaises(ValueError):self.hub.message(tid,'late',[])
        self.hub.close();self.hub=Hub(Path(self.temp.name))
        restored=self.hub.archived_threads([],self.hub.config.value)
        self.assertEqual(restored[0]['state'],'closed')
        self.assertEqual(restored[0]['messages'][0]['messageText'],'keep this')
        self.assertEqual(restored[0]['summary'],'Finished')

    def test_close_coral_archives_before_remote_erases_messages(self):
        cfg=self.coral_config();self.hub.config.value=cfg
        threads=[self.thread([self.msg()])]
        self.hub.threads=threads;self.hub.ingest([],cfg);self.hub.ingest(threads,cfg)
        def remote_close(*args,**kwargs):
            self.assertEqual(args,('coral_close_thread',))
            self.assertEqual(kwargs,{'threadId':'t1','summary':'Done'})
            row=self.hub.db.execute('SELECT snapshot FROM archives').fetchone()
            self.assertEqual(json.loads(row[0])['messages'][0]['messageText'],'hello')
            threads[0]['messages']=[];threads[0]['state']='closed'
        with patch.object(self.hub,'peer') as peer:
            peer.return_value.threads.return_value=threads
            peer.return_value.tool.side_effect=remote_close
            self.hub.close_thread('t1','Done')
        self.assertEqual(self.hub.threads[0]['messages'][0]['messageText'],'hello')
        row=self.hub.db.execute('SELECT * FROM jobs').fetchone()
        self.assertEqual(row['status'],'cancelled')
        with self.assertRaises(ValueError):self.hub.retry(row['id'])
        different=dict(cfg,agents=['cursor'])
        self.assertEqual(self.hub.archived_threads([],different),[])

    def test_close_backup_failure_never_calls_remote(self):
        cfg=self.coral_config();self.hub.config.value=cfg
        self.hub.db.execute("CREATE TRIGGER reject_archive BEFORE INSERT ON archives BEGIN SELECT RAISE(FAIL, 'disk unavailable'); END")
        with patch.object(self.hub,'peer') as peer:
            peer.return_value.threads.return_value=[self.thread([self.msg()])]
            with self.assertRaises(Exception):self.hub.close_thread('t1','Done')
            peer.return_value.tool.assert_not_called()

    def test_close_remote_failure_keeps_channel_open_and_snapshot(self):
        cfg=self.coral_config();self.hub.config.value=cfg
        threads=[self.thread([self.msg()])];self.hub.threads=threads
        with patch.object(self.hub,'peer') as peer:
            peer.return_value.threads.return_value=threads
            peer.return_value.tool.side_effect=TransportError('offline')
            with self.assertRaises(TransportError):self.hub.close_thread('t1','Done')
        self.assertEqual(self.hub.archived_threads(threads,cfg)[0]['state'],'open')
        # A lost response after a successful remote close still recovers the backup.
        closed=self.hub.archived_threads([dict(threads[0],state='closed',messages=[])],cfg)
        self.assertEqual(closed[0]['messages'][0]['messageText'],'hello')

    def test_close_blocks_active_worker(self):
        self.hub.config.value=self.coral_config()
        self.hub.active['codex']={'job':{'tid':'t1'},'cancel':threading.Event()}
        with patch.object(self.hub,'peer') as peer:
            with self.assertRaises(ValueError):self.hub.close_thread('t1','Done')
            peer.assert_not_called()
        self.hub.active.clear()

    def test_closed_channel_does_not_send_ready_result(self):
        cfg=self.coral_config();self.hub.ingest([],cfg)
        self.hub.ingest([self.thread([self.msg()])],cfg)
        self.hub.db.execute("UPDATE jobs SET status='ready',result=?",(json.dumps({'reply':'late','mentions':[]}),))
        with patch.object(self.hub,'peer') as peer:
            self.hub.work(cfg,[{'threadId':'t1','state':'closed','messages':[]}])
            peer.assert_not_called()
        self.assertEqual(self.hub.db.execute('SELECT status FROM jobs').fetchone()[0],'cancelled')

    def test_secret_redaction_and_rotation(self):
        cfg=self.coral_config()
        self.hub.config.save(cfg)
        self.assertNotIn('secret-ops',json.dumps(self.hub.snapshot()))
        path=Path(self.temp.name)/'urls.txt'
        cfg['url_file']=str(path)
        path.write_text('codex|http://localhost:5555/first',encoding='utf-8')
        self.assertTrue(self.hub.config.endpoints(cfg)['codex'].endswith('first'))
        path.write_text('codex|http://localhost:5555/second',encoding='utf-8')
        self.assertTrue(self.hub.config.endpoints(cfg)['codex'].endswith('second'))

    def test_config_validation(self):
        for url in ['http://example.com/token','file:///secret','https://user:pass@example.com']:
            with self.assertRaises(ValueError):valid_url(url)
        for body in [{'agents':[]},{'agents':['unknown']},{'agents':['codex'],'executables':[]},
                     {'agents':['codex'],'workspace':42}]:
            with self.assertRaises(ValueError):self.hub.config.prepare(body)

    def test_baseline_and_dedup(self):
        cfg=self.coral_config()
        old=self.msg('old')
        self.hub.ingest([self.thread([old])],cfg)
        messages=[old,self.msg('new'),self.msg('self','codex'),self.msg('untrusted','stranger')]
        self.hub.ingest([self.thread(messages)],cfg)
        self.hub.ingest([self.thread(messages)],cfg)
        statuses=[r[0] for r in self.hub.db.execute('SELECT status FROM jobs ORDER BY rowid')]
        self.assertEqual(statuses,['baseline','pending'])

    def test_cancel_retry_durable_limit(self):
        cfg=self.coral_config();cfg['automatic']=True;self.hub.config.value=cfg
        self.hub.ingest([],cfg)
        threads=[self.thread([self.msg()])];self.hub.ingest(threads,cfg)
        row=self.hub.db.execute('SELECT * FROM jobs').fetchone()
        self.hub.cancel(row['id']);self.hub.retry(row['id'])
        for n in range(6):
            self.hub.db.execute('INSERT INTO executions VALUES (?,?,?,?,?)',('old',n,row['scope'],'t1','codex'))
        with patch('agent_hub.adapters.execute') as execute:
            self.hub.work(cfg,threads)
            execute.assert_not_called()
        self.assertEqual(self.hub.db.execute('SELECT status FROM jobs').fetchone()[0],'failed')
        self.hub.retry(row['id']);self.hub.work(cfg,threads)
        self.assertEqual(self.hub.db.execute('SELECT status FROM jobs').fetchone()[0],'failed')

    def test_outbox_receipt_prevents_duplicate(self):
        cfg=self.coral_config();self.hub.ingest([],cfg)
        threads=[self.thread([self.msg()])];self.hub.ingest(threads,cfg)
        row=self.hub.db.execute('SELECT * FROM jobs').fetchone()
        self.hub.db.execute("UPDATE jobs SET status='ready',result=?",(json.dumps({'reply':'answer','mentions':[]}),))
        threads[0]['messages'].append({'sendingAgentName':'codex','messageText':f"answer [HUB:{row['id']}:1]"})
        with patch.object(self.hub,'peer') as peer:
            self.hub.work(cfg,threads);peer.assert_not_called()
        self.assertEqual(self.hub.db.execute('SELECT status FROM jobs').fetchone()[0],'done')

    def test_nested_code_fences(self):
        threads=[self.thread([self.msg('```mermaid\ngraph LR\n A-->B\n```')])]
        peer=object.__new__(Peer)
        with patch.object(peer,'call',return_value={'contents':[{'text':'# State\n```json\n'+json.dumps(threads)+'\n```'}]}):
            self.assertEqual(peer.threads(),threads)

    def test_reply_parser(self):
        self.assertEqual(parse_reply('Answer:\n```json\n{"reply":"hello","mentions":["cursor"]}\n```')['mentions'],['cursor'])
        with self.assertRaises(RuntimeError):parse_reply(' ')

    def test_mcp_sse_and_secret_safe_error(self):
        peer=object.__new__(Peer);peer.url='http://localhost:5555/private-token';peer.serial=0;peer.headers={}
        response=io.BytesIO(b'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n')
        response.headers={'Content-Type':'text/event-stream','Mcp-Session-Id':'session-test'}
        with patch('urllib.request.urlopen',return_value=response):
            self.assertEqual(peer.call('tools/list',{}),{'ok':True})
            self.assertEqual(peer.headers['Mcp-Session-Id'],'session-test')
        with patch('urllib.request.urlopen',side_effect=OSError('private-token')):
            with self.assertRaises(TransportError) as raised:peer.call('tools/list',{})
            self.assertNotIn('private-token',str(raised.exception))

    def test_worker_result_delivery(self):
        cfg=self.coral_config();cfg['automatic']=True
        self.hub.ingest([],cfg)
        threads=[self.thread([self.msg()])];self.hub.ingest(threads,cfg)
        with patch('agent_hub.adapters.execute',return_value={'reply':'answer','mentions':['ops','unknown','codex']}),patch.object(self.hub,'peer') as peer:
            self.hub.work(cfg,threads)
            self.hub.active['codex']['future'].result(timeout=3)
            self.hub.work(cfg,threads)
            sent=peer.return_value.tool.call_args.kwargs
            self.assertEqual(sent['mentions'],['ops'])
            self.assertIn('answer',sent['content'])
        self.assertEqual(self.hub.db.execute('SELECT status FROM jobs').fetchone()[0],'done')

    def test_restart_does_not_reexecute_running_job(self):
        cfg=self.coral_config();self.hub.ingest([],cfg)
        self.hub.ingest([self.thread([self.msg()])],cfg)
        self.hub.db.execute("UPDATE jobs SET status='running'");self.hub.db.commit()
        self.hub.close();self.hub=Hub(Path(self.temp.name))
        self.assertEqual(self.hub.db.execute('SELECT status FROM jobs').fetchone()[0],'failed')

    def test_http_setup_csrf_and_demo(self):
        server=make_server(self.hub,0)
        worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with urllib.request.urlopen(base+'/api/bootstrap') as r:bootstrap=json.load(r)
            payload=json.dumps({'mode':'demo','agents':['claude','codex']}).encode()
            request=urllib.request.Request(base+'/api/config',payload,{'Content-Type':'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as raised:urllib.request.urlopen(request)
            self.assertEqual(raised.exception.code,403)
            request.add_header('X-Hub-CSRF',bootstrap['csrf'])
            with urllib.request.urlopen(request) as r:self.assertEqual(r.status,200)
            tid=self.hub.new_thread('HTTP close')
            self.hub.message(tid,'preserved through API',[])
            close_request=urllib.request.Request(base+'/api/thread/close',
                json.dumps({'threadId':tid,'summary':'Finished via HTTP'}).encode(),
                {'Content-Type':'application/json','X-Hub-CSRF':bootstrap['csrf']})
            with urllib.request.urlopen(close_request) as r:self.assertTrue(json.load(r)['ok'])
            with urllib.request.urlopen(base+'/api/state') as r:
                closed=next(t for t in json.load(r)['threads'] if t['threadId']==tid)
                self.assertEqual(closed['state'],'closed')
                self.assertEqual(closed['messages'][0]['messageText'],'preserved through API')
            request.add_header('Origin','https://evil.example')
            with self.assertRaises(urllib.error.HTTPError) as raised:urllib.request.urlopen(request)
            self.assertEqual(raised.exception.code,403)
            with urllib.request.urlopen(base+'/') as r:
                self.assertIn(b'AGENT HUB RADIO',r.read())
                self.assertIn("frame-ancestors 'none'",r.headers['Content-Security-Policy'])
        finally:server.shutdown();worker.join();server.server_close()


if __name__=='__main__':unittest.main()
