import io
import json
import os
from pathlib import Path
import sys
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from agent_hub import manual_context as context, manual_runner, pipeline_workspace as ws
from agent_hub.cli import Client, clean, repl, watch, main as cli_main
from agent_hub.engine import Hub
from agent_hub.manual import ManualSessions
from agent_hub.server import make_server


class ContextTests(unittest.TestCase):
    def test_only_leading_mention_routes_and_empty_mention_switches(self):
        self.assertEqual(context.route('@cursor 방금 @claude가 수정한 파일 확인', 'codex'), (['cursor'], '방금 @claude가 수정한 파일 확인'))
        self.assertEqual(context.route('@Claude\n새 요청', 'codex'), (['claude'], '새 요청'))
        self.assertEqual(context.route('계속 @cursor 참고', 'codex'), (['codex'], '계속 @cursor 참고'))
        self.assertEqual(context.route('@cursor', 'claude'), (['cursor'], ''))
        for text in ('@unknown go', '@cursorX go', ''):
            with self.assertRaises(ValueError):
                context.route(text, 'codex')

    def test_leading_mentions_choose_unique_discussion_participants(self):
        self.assertEqual(context.route('@Claude @codex @CLAUDE @cursor 토론 @codex 참고', 'cursor'),
                         (['claude', 'codex', 'cursor'], '토론 @codex 참고'))
        self.assertEqual(context.route('@claude @codex가 한 말을 검토', 'cursor'), (['claude'], '@codex가 한 말을 검토'))
        self.assertEqual(context.route('@codex @codex', 'cursor'), (['codex'], ''))
        with self.assertRaisesRegex(ValueError, '주제'):
            context.route('@claude @codex', 'cursor')

    @unittest.skipUnless(os.name == 'nt', 'Windows launcher')
    def test_windows_launcher_works_outside_checkout_without_pythonpath(self):
        launcher = Path(__file__).resolve().parents[1] / 'chat.cmd'
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ)
            env.pop('PYTHONPATH', None)
            result = subprocess.run(['cmd.exe', '/d', '/c', str(launcher), '--help'], cwd=tmp,
                                    env=env, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b'agent-hub chat', result.stdout)

    def test_native_commands_use_shared_workspace_fresh_sessions_and_permissions(self):
        packet = {'context_bucket': {'workspace_snapshot': {'current_directory': 'shared'}}}
        with patch('agent_hub.adapters.discover', return_value=['agent']):
            for agent in ('claude', 'codex', 'cursor'):
                for writable in (False, True):
                    args = manual_runner.command(agent, {}, Path('logs'), packet, writable)
                    self.assertNotIn('--resume', args)
                    self.assertNotIn('--continue', args)
                    if agent == 'codex':
                        self.assertEqual(args[args.index('--cd') + 1], 'shared')
                        self.assertEqual(args[args.index('--sandbox') + 1], 'workspace-write' if writable else 'read-only')
                        self.assertIn('--ephemeral', args)
                    elif agent == 'claude':
                        self.assertIn('--no-session-persistence', args)
                        self.assertEqual('Edit' in args[args.index('--tools') + 1], writable)
                    else:
                        self.assertEqual(args[args.index('--workspace') + 1], 'shared')
                        self.assertEqual('--force' in args, writable)

    def test_streams_do_not_duplicate_partial_and_completed_text(self):
        for agent, records in (
            ('claude', [{'type': 'stream_event', 'event': {'delta': {'type': 'text_delta', 'text': 'hello'}}},
                        {'type': 'assistant', 'message': {'content': [{'type': 'text', 'text': 'hello'}]}},
                        {'type': 'result', 'subtype': 'success', 'result': 'hello'}]),
            ('cursor', [{'type': 'assistant', 'timestamp_ms': 1, 'message': {'content': [{'type': 'text', 'text': 'hello'}]}},
                        {'type': 'assistant', 'model_call_id': 'x', 'message': {'content': [{'type': 'text', 'text': 'hello'}]}},
                        {'type': 'result', 'subtype': 'success', 'result': 'hello'}]),
            ('codex', [{'type': 'item.completed', 'item': {'id': 'x', 'type': 'agent_message', 'text': 'hello'}},
                       {'type': 'item.completed', 'item': {'id': 'x', 'type': 'agent_message', 'text': 'hello'}},
                       {'type': 'turn.completed'}])):
            events = []
            stream = manual_runner.Stream(agent, lambda k, d: events.append((k, d)))
            for record in records:
                stream.feed(record)
            self.assertTrue(stream.terminal)
            self.assertFalse(stream.failed)
            self.assertEqual([d['text'] for k, d in events if k == 'text'], ['hello'])

    def test_failed_terminal_and_control_sequences(self):
        stream = manual_runner.Stream('codex', lambda *args: None)
        stream.feed({'type': 'turn.failed'})
        self.assertTrue(stream.failed)
        self.assertEqual(clean('\x1b[2Jhello\x1b]0;title\x07\x00'), 'hello')
        with self.assertRaises(ValueError):
            Client('https://example.com')

    def test_final_answer_is_shown_when_progress_differed(self):
        from unittest.mock import Mock
        client = Mock()
        client.turn.return_value = {'events': [{'seq': 1, 'kind': 'text', 'data': {'text': 'progress'}}],
                                    'status': 'completed', 'more': False, 'reply': 'final answer', 'error': None}
        with patch('sys.stdout', new_callable=io.StringIO) as output:
            watch(client, 'session', 'turn')
        self.assertIn('progress', output.getvalue())
        self.assertIn('final answer', output.getvalue())

    def test_discussion_stream_labels_interleaved_and_final_only_replies(self):
        from unittest.mock import Mock
        client = Mock()
        events = [('round', {'round': 1, 'participants': ['claude', 'codex']}),
                  ('text', {'round': 1, 'agent': 'claude', 'text': 'claude '}),
                  ('text', {'round': 1, 'agent': 'codex', 'text': 'codex\n'}),
                  ('text', {'round': 1, 'agent': 'claude', 'text': 'reply\n'}),
                  ('speaker', {'round': 1, 'agent': 'claude', 'message': 'claude reply', 'status': 'completed'}),
                  ('speaker', {'round': 1, 'agent': 'codex', 'message': 'codex', 'status': 'completed'}),
                  ('speaker', {'round': 2, 'agent': 'claude', 'message': 'final only', 'status': 'completed'})]
        client.turn.return_value = {'events': [{'seq': i + 1, 'kind': k, 'data': d} for i, (k, d) in enumerate(events)],
            'discussion': True, 'status': 'completed', 'more': False, 'reply': 'do not duplicate transcript', 'error': None}
        with patch('sys.stdout', new_callable=io.StringIO) as output:
            watch(client, 'session', 'turn')
        self.assertIn('[1차 · claude] claude reply', output.getvalue())
        self.assertIn('[1차 · codex] codex', output.getvalue())
        self.assertEqual(output.getvalue().count('claude reply'), 1)
        self.assertIn('final only', output.getvalue())
        self.assertNotIn('do not duplicate', output.getvalue())


class ManualTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        ws.git(self.source, 'init')
        (self.source / 'app.py').write_text('value = 1\n', encoding='utf-8')
        (self.source / '.gitignore').write_text('ignored.txt\n', encoding='utf-8')
        ws.git(self.source, 'add', '.')
        ws.git(self.source, '-c', 'user.name=Hub Test', '-c', 'user.email=test@example.invalid',
               '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture')
        self.hub = Hub(self.root / 'hub')
        self.m = self.hub.manual
        self.session = self.m.create({'source': str(self.source), 'authorizeWrites': True})
        self.sid = self.session['id']
        self.workspace = Path(self.session['workspace'])
        self.patcher = patch('agent_hub.adapters.discover', return_value=['mock-native'])
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.hub.close()
        self.temp.cleanup()

    def submit(self, text, **extra):
        return self.m.submit({'sessionId': self.sid, 'text': text, **extra})

    def finish(self, key, fake):
        deadline = time.monotonic() + 20
        with patch('agent_hub.manual_runner.execute', side_effect=fake):
            while time.monotonic() < deadline:
                with self.hub.lock:
                    self.m.tick()
                    turn = self.m.turn(key)
                if turn['status'] not in ('pending', 'running'):
                    return turn
                time.sleep(.02)
        self.fail('Manual turn did not terminate')

    def test_three_agent_handoff_shares_files_history_and_real_check_evidence(self):
        packets = []
        def fake(agent, cfg, packet, writable, folder, cancel, live, emit):
            packets.append(packet)
            if agent == 'claude':
                (self.workspace / 'new.py').write_text('value = 2\n')
            elif agent == 'codex':
                self.assertIn('new.py', packet['context_bucket']['workspace_snapshot']['active_files'])
                self.assertIn('made new.py', json.dumps(packet))
            else:
                self.assertIn('reviewed', json.dumps(packet))
                (self.workspace / 'new.py').write_text('value = 3\n')
            emit('text', {'text': agent})
            return {'reply': 'made new.py' if agent == 'claude' else 'reviewed', 'exit_code': 0}
        for agent in ('claude', 'codex', 'cursor'):
            result = self.finish(self.submit('@' + agent + ' continue')['id'], fake)
            self.assertEqual(result['status'], 'completed', result['error'])
        self.assertEqual([p['revision'] for p in packets], [0, 1, 2])
        self.assertEqual((self.workspace / 'new.py').read_text(), 'value = 3\n')
        self.assertFalse((self.source / 'new.py').exists())
        key = self.submit('"' + sys.executable + '" -c "print(123)"', kind='check')['id']
        result = self.finish(key, fake)
        self.assertEqual(result['outcome']['check']['exit_code'], 0)
        self.assertIn('123', self.m.history(self.sid)[-2]['message'])

    def test_parallel_discussion_shares_both_rounds_and_hands_off_to_one_writer(self):
        barrier = threading.Barrier(3, timeout=10)
        packets = {1: [], 2: []}
        participants = ['claude', 'codex', 'cursor']
        def discuss(agent, cfg, packet, writable, folder, cancel, live, emit):
            self.assertFalse(writable)
            self.assertEqual(set(self.hub.active), set(participants))
            round_number = packet['discussion']['round']
            packets[round_number].append(context.pack(packet))
            self.assertEqual(packet['context_hash'], context.digest(packet))
            if round_number == 1:
                self.assertEqual(packet['context_bucket']['discussion_history'], [])
            else:
                self.assertEqual([s['agent'] for s in packet['context_bucket']['discussion_history']], participants)
                self.assertEqual([s['message'] for s in packet['context_bucket']['discussion_history']],
                                 [a + '-1 @cursor reference' for a in participants])
            barrier.wait()  # A sequential implementation cannot pass this barrier.
            emit('text', {'text': f'{agent}-{round_number} @cursor reference'})
            return {'reply': f'{agent}-{round_number} @cursor reference', 'exit_code': 0}
        key = self.submit('@claude @codex @cursor discuss')['id']
        result = self.finish(key, discuss)
        self.assertEqual(result['status'], 'completed', result['error'])
        self.assertTrue(result['discussion'])
        self.assertEqual([len(set(packets[r])) for r in (1, 2)], [1, 1])
        self.assertFalse(self.hub.active)
        self.assertEqual(self.m.get(self.sid)['revision'], 1)
        self.assertEqual(self.m.get(self.sid)['agent'], 'codex')
        history = [h for h in self.m.history(self.sid) if h.get('round')]
        self.assertEqual(len(history), 6)
        self.assertEqual({h['sender'] for h in history}, set(participants))
        def implement(agent, cfg, packet, writable, *args):
            self.assertEqual(agent, 'cursor')
            self.assertTrue(writable)
            self.assertEqual(len([h for h in packet['context_bucket']['terminal_history'] if h.get('round')]), 6)
            return {'reply': 'implemented', 'exit_code': 0}
        self.assertEqual(self.finish(self.submit('@cursor implement the discussion')['id'], implement)['status'], 'completed')

    def test_discussion_waits_for_all_provider_slots_and_cancels_every_speaker(self):
        from concurrent.futures import Future
        outside = {'job': {}, 'future': Future(), 'cancel': threading.Event()}
        self.hub.active['codex'] = outside
        key = self.submit('@claude @codex discuss')['id']
        with self.hub.lock:
            self.m.tick()
        self.assertEqual(self.m.turn(key)['status'], 'pending')
        self.assertEqual(self.hub.active, {'codex': outside})
        del self.hub.active['codex']
        ready = threading.Barrier(3, timeout=10)
        ended = []
        def running(agent, cfg, packet, writable, folder, cancel, live, emit):
            emit('text', {'text': agent + ' partial'})
            ready.wait()
            cancel.wait(10)
            ended.append(agent)
            raise RuntimeError('cancelled speaker')
        with patch('agent_hub.manual_runner.execute', side_effect=running):
            with self.hub.lock:
                self.m.tick()
            ready.wait()
            self.assertEqual(set(self.hub.active), {'claude', 'codex'})
            with self.assertRaises(ValueError):
                self.submit('@cursor cannot overlap')
            self.m.cancel(self.sid)
            result = self.finish(key, running)
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(set(ended), {'claude', 'codex'})
        self.assertFalse(self.hub.active)
        self.assertIn('claude partial', result['reply'])
        self.assertIn('codex partial', result['reply'])

    def test_failed_speaker_stops_next_round_but_preserves_other_opinions(self):
        calls = []
        def failing(agent, cfg, packet, writable, folder, cancel, live, emit):
            calls.append((agent, packet['discussion']['round']))
            if agent == 'claude':
                emit('text', {'text': 'partial opinion'})
                raise RuntimeError('fixture failure')
            return {'reply': 'complete opinion', 'exit_code': 0}
        result = self.finish(self.submit('@claude @codex discuss')['id'], failing)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(set(calls), {('claude', 1), ('codex', 1)})
        history = self.m.history(self.sid)
        self.assertIn('partial opinion', context.pack(history))
        self.assertIn('complete opinion', context.pack(history))
        self.assertIn('fixture failure', context.pack(history))
        self.assertEqual(self.m.get(self.sid)['status'], 'ready')

    def test_discussion_context_overflow_stops_before_second_round(self):
        calls = []
        def large(agent, cfg, packet, *args):
            calls.append(packet['discussion']['round'])
            return {'reply': agent + 'x' * 100000, 'exit_code': 0}
        result = self.finish(self.submit('@claude @codex discuss')['id'], large)
        self.assertEqual(result['status'], 'failed')
        self.assertIn('192KB', result['error'])
        self.assertEqual(calls, [1, 1])
        self.assertGreater(len(context.pack(self.m.history(self.sid))), 200000)

    def test_discussion_workspace_mutation_blocks_next_round_and_requires_sync(self):
        calls = []
        def mutate(agent, cfg, packet, writable, *args):
            self.assertFalse(writable)
            calls.append(packet['discussion']['round'])
            if agent == 'claude':
                (self.workspace / 'app.py').write_text('unexpected = True\n')
            return {'reply': 'opinion', 'exit_code': 0}
        result = self.finish(self.submit('@claude @codex discuss')['id'], mutate)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(calls, [1, 1])
        self.assertEqual(self.m.get(self.sid)['status'], 'interrupted')
        self.assertIn('/sync', result['error'])

    def test_restart_keeps_attributed_partial_discussion_without_repeating(self):
        key = self.submit('@claude @codex discuss')['id']
        self.m.db.execute("UPDATE manual_turns SET status='running' WHERE id=?", (key,))
        self.m.event(key, 'text', {'agent': 'claude', 'round': 1, 'text': 'unfinished'})
        self.m.event(key, 'speaker', {'agent': 'codex', 'round': 1, 'message': 'finished', 'status': 'completed', 'error': None})
        self.hub.close()
        self.hub = Hub(self.root / 'hub')
        self.m = self.hub.manual
        statements = {h['sender']: h for h in self.m.history(self.sid) if h.get('round')}
        self.assertEqual(statements['claude']['message'], 'unfinished')
        self.assertEqual(statements['claude']['status'], 'interrupted')
        self.assertEqual(statements['codex']['message'], 'finished')
        with patch('agent_hub.manual_runner.execute') as native:
            self.m.tick()
            native.assert_not_called()
        self.assertEqual(self.m.turn(key)['status'], 'interrupted')

    def test_failed_cancelled_and_restarted_turns_keep_actual_changes(self):
        def fail(agent, cfg, packet, writable, folder, cancel, live, emit):
            (self.workspace / 'partial.py').write_text('partial = True\n')
            emit('text', {'text': '진행 중이던 답변'})
            raise RuntimeError('fixture failure')
        result = self.finish(self.submit('@claude change')['id'], fail)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['reply'], '진행 중이던 답변')
        self.assertIn('partial.py', result['outcome']['changed_files'])
        key = self.submit('@cursor continue')['id']
        packet = json.loads(self.m.db.execute('SELECT input FROM manual_turns WHERE id=?', (key,)).fetchone()[0])
        self.assertIn('fixture failure', context.pack(packet))
        self.m.cancel(self.sid)
        self.assertEqual(self.m.turn(key)['status'], 'cancelled')
        key = self.submit('@codex work')['id']
        self.m.db.execute("UPDATE manual_turns SET status='running' WHERE id=?", (key,))
        self.m.db.commit()
        self.hub.close()
        self.hub = Hub(self.root / 'hub')
        self.m = self.hub.manual
        self.assertEqual(self.m.turn(key)['status'], 'interrupted')
        with self.assertRaises(ValueError):
            self.submit('do not automatically repeat')
        self.m.manage({'sessionId': self.sid, 'action': 'sync'})
        self.assertEqual(self.m.get(self.sid)['status'], 'ready')

    def test_running_cancellation_records_partial_files_before_next_turn(self):
        started = threading.Event()
        def running(agent, cfg, packet, writable, folder, cancel, live, emit):
            (self.workspace / 'cancelled.py').write_text('partial = True\n')
            started.set()
            cancel.wait(10)
            raise RuntimeError('중단됨')
        key = self.submit('@claude start')['id']
        with patch('agent_hub.manual_runner.execute', side_effect=running):
            with self.hub.lock:
                self.m.tick()
            self.assertTrue(started.wait(10))
            self.m.cancel(self.sid)
            result = self.finish(key, running)
        self.assertEqual(result['status'], 'cancelled')
        self.assertIn('cancelled.py', result['outcome']['changed_files'])
        self.assertFalse(self.hub.active)
        self.assertEqual(self.m.get(self.sid)['fingerprint'], ws.fingerprint(self.workspace, self.session['base']))

    def test_external_changes_and_context_overflow_require_explicit_action(self):
        (self.workspace / 'app.py').write_text('changed = True\n')
        with self.assertRaisesRegex(ValueError, '/sync'):
            self.submit('inspect')
        self.m.manage({'sessionId': self.sid, 'action': 'sync'})
        with patch.object(context, 'MAX_CONTEXT_BYTES', 10):
            with self.assertRaisesRegex(ValueError, '192KB'):
                self.submit('too large')
        self.assertFalse(self.m.db.execute("SELECT 1 FROM manual_turns WHERE status='pending'").fetchone())
        self.m.manage({'sessionId': self.sid, 'action': 'compact', 'text': 'Keep existing user constraints. External edit accepted.'})
        self.assertTrue(self.m.history(self.sid))
        key = self.submit('continue')['id']
        packet = json.loads(self.m.db.execute('SELECT input FROM manual_turns WHERE id=?', (key,)).fetchone()[0])
        self.assertEqual(packet['context_bucket']['terminal_history'], [])
        self.assertIn('External edit', packet['context_bucket']['summary'])
        self.m.cancel(self.sid)

    def test_context_usage_explains_tool_size_and_compaction_keeps_original(self):
        def tools(agent, cfg, packet, writable, folder, cancel, live, emit):
            emit('tool', {'event': {'output': 'x' * 15000}})
            return {'reply': 'reviewed without changes', 'exit_code': 0}
        self.finish(self.submit('@claude inspect')['id'], tools)
        before = self.m.context_usage(self.sid)
        self.assertGreater(before['tool_bytes'], 15000)
        self.assertGreater(before['context_bytes'], before['tool_bytes'])
        original = self.m.history(self.sid)
        self.m.manage({'sessionId': self.sid, 'action': 'compact', 'text': 'Reviewed; no changes; tests not run.'})
        after = self.m.context_usage(self.sid)
        self.assertLess(after['context_bytes'], before['context_bytes'])
        self.assertLess(after['tool_bytes'], 10)
        self.assertEqual(original, self.m.history(self.sid))

    def test_idempotency_busy_project_and_no_autonomous_collaboration(self):
        key = '12345678-1234-1234-1234-123456789abc'
        self.submit('@cursor use @claude history', requestId=key)
        self.assertEqual(self.submit('@cursor use @claude history', requestId=key)['id'], key)
        with self.assertRaises(ValueError):
            self.submit('different', requestId=key)
        with self.assertRaises(ValueError):
            self.submit('concurrent turn')
        with self.assertRaises(ValueError):
            self.m.project_free(self.session['project'])
        cfg = {'mode': 'coral', 'automatic': True, 'agents': ['claude', 'codex', 'cursor'], 'observer': 'ops'}
        self.hub.config.value = cfg
        self.hub.connected = True
        self.hub.threads = [{'threadId': 'another', 'state': 'open', 'messages': []}]
        with self.assertRaisesRegex(ValueError, '수동 세션'):
            self.hub.pipeline.start({'threadId': 'another', 'request': 'implement', 'source': str(self.source),
                                    'roles': {k: ['codex'] for k in ('plan', 'implement', 'verify')}, 'authorizeWrites': True})
        s = self.m.get(self.sid)
        self.m.save(s, scope=self.hub.scope(cfg), tid='manual-channel')
        self.m.db.commit()
        self.hub.collaboration.ingest([], cfg)
        self.hub.collaboration.ingest([{'threadId': 'manual-channel', 'state': 'open', 'messages': [
            {'sendingAgentName': 'ops', 'messageText': '@claude reference', 'mentionAgentNames': ['claude']}]}], cfg)
        self.assertEqual(self.m.db.execute('SELECT count(*) FROM collab_rounds').fetchone()[0], 0)
        self.m.cancel(self.sid)

    def test_readonly_mutation_is_detected_and_files_cannot_escape(self):
        s = self.m.get(self.sid)
        self.m.save(s, writable=False)
        self.m.db.commit()
        for name in ('../source/app.py', '.git/config', 'ignored.txt'):
            with self.assertRaises(ValueError):
                self.m.manage({'sessionId': self.sid, 'action': 'include', 'text': name})
        with self.assertRaises(ValueError):
            self.submit('"' + sys.executable + '" --version', kind='check')
        def mutate(*args):
            (self.workspace / 'app.py').write_text('unexpected = True\n')
            return {'reply': 'claimed success', 'exit_code': 0}
        result = self.finish(self.submit('@codex inspect')['id'], mutate)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(self.m.get(self.sid)['status'], 'interrupted')

    def test_provider_independent_packet_and_export_includes_new_and_deleted_files(self):
        (self.workspace / 'new.py').write_text('new = True\n')
        (self.workspace / 'app.py').unlink()
        self.m.manage({'sessionId': self.sid, 'action': 'sync'})
        first = self.m.get(self.sid)
        a, digest = context.build(first, [], 'same request')
        second = {**first, 'agent': 'cursor'}
        b, other = context.build(second, [], 'same request')
        self.assertEqual((a, digest), (b, other))
        self.assertEqual(a['context_bucket']['workspace_snapshot']['deleted_files'], ['app.py'])
        result = self.m.manage({'sessionId': self.sid, 'action': 'export'})
        self.assertEqual(result['files'], ['app.py', 'new.py'])
        self.assertIn(b'new = True', (Path(result['directory']) / 'changes.patch').read_bytes())
        self.assertEqual(ws.git(self.source, 'status', '--porcelain'), b'')

    def test_explicit_exclusion_keeps_file_identity_and_full_artifacts(self):
        (self.workspace / 'app.py').write_text('x' * 70000)
        self.m.manage({'sessionId': self.sid, 'action': 'sync'})
        with self.assertRaisesRegex(ValueError, '64KB'):
            self.submit('inspect')
        self.m.manage({'sessionId': self.sid, 'action': 'exclude', 'text': 'app.py'})
        packet, _ = context.build(self.m.get(self.sid), [], 'inspect')
        snapshot = packet['context_bucket']['workspace_snapshot']
        self.assertEqual(snapshot['excluded_files'], ['app.py'])
        self.assertIn('app.py', snapshot['changed_files'])
        self.assertEqual(snapshot['active_files'], {})
        self.assertEqual(snapshot['git_diff'], '')
        result = self.m.manage({'sessionId': self.sid, 'action': 'export'})
        self.assertIn(b'x' * 70000, (Path(result['directory']) / 'changes.patch').read_bytes())

    def test_coral_delivery_has_no_mentions_and_reconciles_receipt(self):
        result = self.finish(self.submit('@claude hello')['id'], lambda *args: {'reply': 'done', 'exit_code': 0})
        cfg = {'mode': 'coral', 'agents': ['claude'], 'observer': 'ops'}
        session = self.m.get(self.sid)
        self.m.save(session, scope=self.hub.scope(cfg), tid='mirror')
        self.m.db.commit()
        thread = {'threadId': 'mirror', 'state': 'open', 'messages': []}
        with patch.object(self.hub, 'peer') as peer:
            self.m.deliver(cfg, [thread])
            sent = peer.return_value.tool.call_args.kwargs
            self.assertEqual(sent['mentions'], [])
            self.assertIn('[HUB-MANUAL:', sent['content'])
            self.m.db.execute('UPDATE manual_turns SET delivered=0 WHERE id=?', (result['id'],))
            thread['messages'] = [{'sendingAgentName': 'ops', 'messageText': sent['content']}]
            self.m.deliver(cfg, [thread])
            self.assertEqual(peer.return_value.tool.call_count, 1)

    def test_http_csrf_reconnect_and_cli_switch(self):
        server = make_server(self.hub, 0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(server.server_port)
        try:
            client = Client(base)
            self.assertTrue(client.bootstrap['manual_discussions'])
            usage = client.request('/api/manual/context?id=' + self.sid)
            self.assertEqual(usage['limit_bytes'], context.MAX_CONTEXT_BYTES)
            self.assertEqual(client.session(self.sid)['workspace'], str(self.workspace))
            request = urllib.request.Request(base + '/api/manual/manage', data=json.dumps({'sessionId': self.sid, 'action': 'close'}).encode(), headers={'Content-Type': 'application/json'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request)
            self.assertEqual(error.exception.code, 403)
            with patch('builtins.input', side_effect=['@cursor', '/exit']), patch('sys.stdout', new_callable=io.StringIO):
                repl(client, client.session(self.sid))
            self.assertEqual(self.m.get(self.sid)['agent'], 'cursor')
            self.assertEqual(self.m.db.execute('SELECT count(*) FROM manual_turns').fetchone()[0], 0)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_cli_starts_server_and_resumes_without_an_extra_model_call(self):
        self.hub.close()
        # The CLI owns an independent Hub instance during this integration test.
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        argv = ['--resume', self.sid, '--data-dir', str(self.root / 'hub'), '--port', str(port)]
        try:
            with patch('builtins.input', side_effect=['@claude hello', '/exit']), patch('sys.stdout', new_callable=io.StringIO), \
                 patch('agent_hub.manual_runner.execute', return_value={'reply': 'hello', 'exit_code': 0}) as native, \
                 patch('agent_hub.engine.Hub.loop') as observer:
                self.assertEqual(cli_main(argv), 0)
                self.assertEqual(native.call_count, 1)
                observer.assert_not_called()
            with patch('builtins.input', side_effect=['/history', '/exit']), patch('sys.stdout', new_callable=io.StringIO), \
                 patch('agent_hub.manual_runner.execute') as native:
                self.assertEqual(cli_main(argv), 0)
                native.assert_not_called()
            with patch('builtins.input', side_effect=['"' + str(self.source) + '"', '/exit']), \
                 patch('sys.stdout', new_callable=io.StringIO), patch('agent_hub.manual_runner.execute') as native:
                self.assertEqual(cli_main(['--interactive-source', '--data-dir', str(self.root / 'hub'), '--port', str(port)]), 0)
                native.assert_not_called()
        finally:
            self.hub = Hub(self.root / 'hub')
            self.m = self.hub.manual


class NativeRunnerTests(unittest.TestCase):
    def test_native_stream_receipt_and_cancellation_with_real_child_processes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            packet = {'context_bucket': {'workspace_snapshot': {'current_directory': str(root)}}}
            script = root / 'fake_cli.py'
            script.write_text('''import json, pathlib, sys, time
sys.stdin.read()
agent, mode, final = sys.argv[1:]
pathlib.Path('changed.txt').write_text('actual edit')
event = {'type':'item.completed','item':{'id':'m','type':'agent_message','text':'partial'}} if agent=='codex' else {'type':'assistant','message':{'content':[{'type':'text','text':'partial'}]}}
print(json.dumps(event), flush=True)
if mode=='cancel':
    time.sleep(20)
elif mode=='ok':
    pathlib.Path(final).write_text('final answer')
    print(json.dumps({'type':'turn.completed'} if agent=='codex' else {'type':'result','subtype':'success','result':'final answer'}), flush=True)
''', encoding='utf-8')
            for agent in ('claude', 'codex', 'cursor'):
                for mode in ('ok', 'cancel', 'missing_receipt'):
                    with self.subTest(agent=agent, mode=mode):
                        folder = root / (agent + '-' + mode)
                        cancel = threading.Event()
                        events, processes = [], []
                        def emit(kind, data):
                            events.append((kind, data))
                            if mode == 'cancel':
                                cancel.set()
                        args = [sys.executable, '-u', str(script), agent, mode, str(folder / 'final.txt')]
                        with patch('agent_hub.manual_runner.command', return_value=args):
                            if mode == 'ok':
                                result = manual_runner.execute(agent, {}, packet, True, folder, cancel, processes.append, emit)
                                self.assertEqual(result['reply'], 'final answer')
                            else:
                                with self.assertRaises(RuntimeError):
                                    manual_runner.execute(agent, {}, packet, True, folder, cancel, processes.append, emit)
                        self.assertTrue(events)
                        self.assertIsNone(processes[-1])
                        self.assertIsNotNone(processes[0].poll())
                        self.assertEqual((root / 'changed.txt').read_text(), 'actual edit')
                        self.assertTrue((folder / 'context.json').is_file())


if __name__ == '__main__':
    unittest.main()
