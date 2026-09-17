import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from agent_hub.engine import Hub

class ChannelRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.hub=Hub(Path(self.temp.name))
        self.hub.config.save({'mode':'coral','agents':['codex'],'automatic':True,
            'endpoints':{'ops':'http://localhost:5555/ops','codex':'http://localhost:5555/codex'}})
        self.cfg=self.hub.config.value
        self.thread={'threadId':'old','threadName':'History','state':'open','messages':[
            {'sendingAgentName':'ops','messageText':'old request','mentionAgentNames':['codex']}]}

    def tearDown(self):
        self.hub.close()
        self.temp.cleanup()

    def detach(self):
        self.hub.archived_threads([self.thread],self.cfg)
        self.hub.threads=self.hub.archived_threads([],self.cfg)

    def test_restart_restores_without_server_and_live_return_clears_detached(self):
        self.detach()
        self.hub.close();self.hub=Hub(Path(self.temp.name))
        recovered=self.hub.snapshot()['threads'][0]
        self.assertTrue(recovered['detached'])
        self.assertEqual(recovered['messages'],self.thread['messages'])
        self.assertFalse(self.hub.archived_threads([self.thread],self.cfg)[0].get('detached'))
        self.assertEqual(self.hub.archived_threads([],dict(self.cfg,agents=['cursor'])),[])

    def test_detached_read_only_and_no_mention_replay(self):
        self.detach()
        with self.assertRaises(ValueError):self.hub.message('old','new',[])
        self.hub.ingest([],self.cfg)
        self.hub.ingest(self.hub.threads,self.cfg)
        self.assertEqual(self.hub.db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0],0)
        with patch.object(self.hub,'peer') as peer:
            self.hub.stop.wait=lambda seconds:self.hub.stop.set()
            peer.return_value.threads.return_value=[]
            self.hub.loop()
        self.assertEqual(self.hub.db.execute('SELECT COUNT(*) FROM collab_rounds').fetchone()[0],0)

    def test_continue_sends_bounded_context_without_mentions(self):
        self.thread['messages'][0]['messageText']='x'*11000
        self.detach()
        new={'threadId':'new','state':'open','messages':[]}
        with patch.object(self.hub,'peer') as peer:
            peer.return_value.tool.return_value={'structuredContent':{'thread':{'id':'new'}}}
            peer.return_value.threads.return_value=[new]
            self.assertEqual(self.hub.channels.continue_channel('old'),'new')
            sent=[c for c in peer.return_value.tool.call_args_list if c.args==('coral_send_message',)][0]
            self.assertEqual(sent.kwargs['mentions'],[])
            self.assertEqual(sent.kwargs['threadId'],'new')
            self.assertTrue(sent.kwargs['content'].endswith('x'*10000))
            self.assertLess(len(sent.kwargs['content']),10500)
        old=next(t for t in self.hub.threads if t['threadId']=='old')
        self.assertEqual(len(old['messages'][0]['messageText']),11000)

    def test_close_offline_then_delete_stays_deleted_after_restart(self):
        self.detach()
        with self.assertRaises(ValueError):self.hub.channels.delete('old',True)
        with patch.object(self.hub,'peer',side_effect=RuntimeError('offline')):
            self.hub.close_thread('old','Finished locally')
        with self.assertRaises(ValueError):self.hub.channels.delete('old',False)
        self.hub.channels.delete('old',True)
        self.hub.close();self.hub=Hub(Path(self.temp.name))
        self.assertEqual(self.hub.archived_threads([self.thread],self.cfg),[])
        self.assertEqual(self.hub.db.execute('SELECT COUNT(*) FROM archives').fetchone()[0],0)

if __name__=='__main__':unittest.main()
