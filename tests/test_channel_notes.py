import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from agent_hub.engine import Hub

class ChannelNotesTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.h=Hub(self.root)
        self.h.config.save({'mode':'coral','agents':['codex'],'endpoints':{'ops':'http://localhost:5555/ops','codex':'http://localhost:5555/codex'}})
        self.t={'threadId':'old','threadName':'Test','state':'open','messages':[]}
        self.h.threads=self.h.archived_threads([self.t],self.h.config.value)
        self.notes={'goal':'목표','decisions':'합의','remaining':'확인'}
    def tearDown(self):self.h.close();self.tmp.cleanup()
    def test_persistence_scope_reset_and_validation(self):
        self.h.channels.save_notes('old',self.notes)
        with self.assertRaises(ValueError):self.h.channels.save_notes('missing',self.notes)
        with self.assertRaises(ValueError):self.h.channels.save_notes('old',dict(self.notes,goal='x'*4001))
        self.h.close();self.h=Hub(self.root)
        self.assertEqual(self.h.snapshot()['channel_notes']['old']['goal'],'목표')
        original=self.h.config.value;self.h.config.value=dict(original,agents=['cursor'])
        self.assertEqual(self.h.channels.notes(),{})
        self.h.config.value=original;self.h.channels.save_notes('old',{'reset':True})
        self.assertEqual(self.h.channels.notes(),{})
    def test_continuation_copies_notes_and_delete_cleans_up(self):
        self.h.channels.save_notes('old',self.notes)
        self.h.threads=self.h.archived_threads([],self.h.config.value)
        with patch.object(self.h,'peer') as peer:
            peer.return_value.tool.return_value={'structuredContent':{'thread':{'id':'new'}}}
            peer.return_value.threads.return_value=[dict(self.t,threadId='new')]
            self.h.channels.continue_channel('old')
        self.assertEqual(self.h.channels.notes()['new']['remaining'],'확인')
        self.h.close_thread('old','Done')
        self.h.channels.save_notes('old',dict(self.notes,goal='closed edit'))
        self.h.channels.delete('old',True)
        self.assertNotIn('old',self.h.channels.notes())
        self.assertIn('new',self.h.channels.notes())
