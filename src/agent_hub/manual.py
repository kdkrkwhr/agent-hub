"""Durable, user-routed sessions sharing one workspace and one context history."""
import json
from pathlib import Path
import threading
import time
import uuid

from . import adapters, manual_context as context, manual_discussion, manual_runner, pipeline_workspace as ws
from .storage import path as storage_path


class ManualSessions:
    def __init__(self, hub):
        self.hub, self.db = hub, hub.db
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS manual_sessions (
                id TEXT PRIMARY KEY, project TEXT, status TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS manual_turns (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, session_id TEXT,
                agent TEXT, kind TEXT, request TEXT, status TEXT, input TEXT, config TEXT,
                reply TEXT, error TEXT, outcome TEXT, created REAL, ended REAL, delivered INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS manual_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT, turn_id TEXT, kind TEXT, data TEXT);
            CREATE INDEX IF NOT EXISTS manual_turn_session ON manual_turns(session_id,seq);
            CREATE INDEX IF NOT EXISTS manual_event_turn ON manual_events(turn_id,seq);
        ''')
        self.db.execute("UPDATE manual_turns SET status='interrupted',error=?,ended=? WHERE status IN ('pending','running')",
                        ('서버가 재시작되었습니다. 이전 CLI가 종료되었는지 확인하고 /sync 하세요. 자동 재실행하지 않습니다.', time.time()))
        self.db.execute("UPDATE manual_sessions SET status='interrupted' WHERE status IN ('preparing','running')")
        self.db.commit()
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def get(self, sid):
        row = self.db.execute('SELECT * FROM manual_sessions WHERE id=?', (sid,)).fetchone()
        if not row:
            raise ValueError('수동 세션을 찾을 수 없습니다.')
        return {**json.loads(row['data']), **{k: row[k] for k in ('id', 'project', 'status')}}

    def save(self, session, **changes):
        session.update(changes)
        self.db.execute('UPDATE manual_sessions SET status=?,data=? WHERE id=?',
                        (session['status'], context.pack({k: v for k, v in session.items() if k not in ('id', 'project', 'status')}), session['id']))

    def busy(self, project, exclude=None):
        return self.db.execute("SELECT 1 FROM manual_sessions WHERE project=? AND id!=? AND status IN ('preparing','running')",
                               (project, exclude or '')).fetchone() is not None

    def project_free(self, project, exclude=None):
        if self.busy(project, exclude) or self.db.execute("SELECT 1 FROM pipelines WHERE project=? AND status='active'", (project,)).fetchone():
            raise ValueError('같은 프로젝트에서 다른 작업이 진행 중입니다.')
        for active in self.hub.active.values():
            pid = active['job'].get('pipeline_id')
            p = self.hub.pipeline.get(pid) if pid else None
            if p and p['project'] == project:
                raise ValueError('이 프로젝트의 이전 작업 프로세스가 종료 중입니다.')

    def owns_channel(self, scope, tid):
        return any(s['scope'] == scope and s['tid'] == tid for s in self.list() if s['status'] != 'closed' and s['tid'])

    def list(self):
        return [self.get(r[0]) for r in self.db.execute('SELECT id FROM manual_sessions ORDER BY rowid DESC')]

    def status(self, sid):
        session = self.get(sid)
        row = self.db.execute('SELECT id,status FROM manual_turns WHERE session_id=? ORDER BY seq DESC LIMIT 1', (sid,)).fetchone()
        return {**session, 'last_turn': dict(row) if row else None}

    def context_usage(self, sid):
        session = self.get(sid)
        self.idle(session)
        return context.usage(session, self.history(sid, session['summary_until']))

    def create(self, body):
        writable = body.get('authorizeWrites', False)
        if type(writable) is not bool:
            raise ValueError('authorizeWrites는 참 또는 거짓이어야 합니다.')
        agent = body.get('agent', 'codex')
        if agent not in adapters.NAMES:
            raise ValueError('지원하지 않는 에이전트입니다.')
        source, project, base = ws.source_info(body.get('source'))
        with self.hub.lock:
            self.project_free(project)
            cfg = self.hub.config.value or {}
            scope, tid = self.hub.scope(cfg), body.get('threadId')
            if tid:
                if cfg.get('mode') != 'coral' or not any(t['threadId'] == tid and t.get('state') != 'closed' and not t.get('detached') for t in self.hub.threads):
                    raise ValueError('기록을 연결할 열린 Coral 채널을 선택하세요.')
                if self.owns_channel(scope, tid) or any(self.db.execute(sql, (scope, tid)).fetchone() for sql in (
                    "SELECT 1 FROM collab_rounds WHERE scope=? AND tid=? AND status='active'",
                    "SELECT 1 FROM pipelines WHERE scope=? AND tid=? AND status='active'",
                    "SELECT 1 FROM polls WHERE scope=? AND tid=? AND status='active'")):
                    raise ValueError('이 채널의 기존 작업을 먼저 종료하세요.')
            sid = 'manual-' + uuid.uuid4().hex
            session = {'id': sid, 'project': project, 'source': source, 'base': base,
                       'workspace': str((self.hub.root / 'workspaces' / sid / 'repo').resolve()),
                       'status': 'preparing', 'fingerprint': None, 'revision': 0, 'agent': agent,
                       'writable': writable, 'summary': '', 'summary_until': 0, 'included': '[]', 'excluded': '[]',
                       'scope': scope, 'tid': tid, 'created': time.time()}
            self.db.execute('INSERT INTO manual_sessions VALUES (?,?,?,?)', (sid, project, 'preparing', '{}'))
            self.save(session)
            self.db.commit()
        try:
            fingerprint = ws.prepare(source, base, session['workspace'])
        except Exception:
            with self.hub.lock:
                self.save(session, status='interrupted')
                self.db.commit()
            raise
        with self.hub.lock:
            self.save(session, status='ready', fingerprint=fingerprint)
            self.db.commit()
            return session

    def history(self, sid, after=0):
        self.get(sid)
        output = []
        for row in self.db.execute('SELECT * FROM manual_turns WHERE session_id=? AND seq>? ORDER BY seq', (sid, after)):
            output.append({'sender': 'Human', 'message': row['request'], 'turn_id': row['id']})
            if len(json.loads(row['config']).get('participants', [])) > 1:
                events = self.events(row['id'])
                for statement in manual_discussion.messages(events, row['status'], row['error']):
                    output.append({**statement, 'sender': statement['agent'], 'turn_id': row['id']})
                output.append({'sender': 'Host', 'status': row['status'], 'error': row['error'],
                               'outcome': json.loads(row['outcome'] or '{}'), 'turn_id': row['id']})
            else:
                output.append({'sender': row['agent'], 'message': row['reply'] or '', 'status': row['status'],
                               'error': row['error'], 'outcome': json.loads(row['outcome'] or '{}'), 'turn_id': row['id']})
            tools = [json.loads(e[0]) for e in self.db.execute("SELECT data FROM manual_events WHERE turn_id=? AND kind='tool' ORDER BY seq", (row['id'],))]
            if tools:
                output.append({'sender': 'Host', 'tool_events': tools, 'turn_id': row['id']})
        return output

    def idle(self, session):
        if session['status'] in ('running', 'preparing'):
            raise ValueError('현재 턴을 완료하거나 중단한 뒤 진행하세요.')

    def submit(self, body):
        sid, text = body.get('sessionId'), body.get('text')
        kind = body.get('kind', 'chat')
        if kind not in ('chat', 'check'):
            raise ValueError('지원하지 않는 턴 종류입니다.')
        key = body.get('requestId') or uuid.uuid4().hex
        try:
            uuid.UUID(key)
        except (ValueError, TypeError, AttributeError):
            raise ValueError('requestId는 UUID여야 합니다.') from None
        with self.hub.lock:
            session = self.get(sid)
            old = self.db.execute('SELECT * FROM manual_turns WHERE id=?', (key,)).fetchone()
            if old:
                if old['session_id'] != sid or json.loads(old['config']).get('original_text') != text or old['kind'] != kind:
                    raise ValueError('이미 다른 요청에 사용된 requestId입니다.')
                return {'id': key, 'agent': old['agent']}
            self.idle(session)
            if session['status'] != 'ready':
                raise ValueError('세션이 준비되지 않았습니다. 중단된 세션은 /sync로 확인하세요.')
            participants, request = context.route(text, session['agent']) if kind == 'chat' else ([session['agent']], text)
            agent = ', '.join(participants)
            if not request and kind == 'chat':
                self.save(session, agent=agent)
                self.db.commit()
                return {'agent': agent, 'switched': True}
            if not isinstance(request, str) or not 1 <= len(request) <= 12000:
                raise ValueError('요청 또는 검증 명령을 입력하세요.')
            self.project_free(session['project'], sid)
            cfg = self.hub.config.value or {}
            frozen = {k: cfg.get(k, {}) for k in ('models', 'executables')}
            frozen['original_text'] = text
            frozen['participants'] = participants
            if kind == 'check':
                if not session['writable']:
                    raise ValueError('읽기 전용 세션에서는 검증 명령을 실행하지 않습니다.')
                frozen['argv'] = ws.command_line(request)
            else:
                for participant in participants:
                    if participant not in frozen['executables'] and not adapters.discover(participant):
                        raise ValueError(participant + ' CLI를 설치하고 로그인한 뒤 다시 요청하세요.')
            packet, digest = context.build(session, self.history(sid, session['summary_until']), request)
            packet['context_hash'] = digest
            self.db.execute('''INSERT INTO manual_turns
                (id,session_id,agent,kind,request,status,input,config,created)
                VALUES (?,?,?,?,?,'pending',?,?,?)''',
                (key, sid, agent, kind, request, context.pack(packet), context.pack(frozen), time.time()))
            self.save(session, status='running', agent=agent if len(participants) == 1 else session['agent'])
            self.db.commit()
            return {'id': key, 'agent': agent}

    def event(self, key, kind, data):
        with self.hub.lock:
            self.db.execute('INSERT INTO manual_events(turn_id,kind,data) VALUES (?,?,?)', (key, kind, context.pack(data)))
            self.db.commit()

    def events(self, key):
        return [{'kind': e['kind'], 'data': json.loads(e['data'])} for e in
                self.db.execute('SELECT kind,data FROM manual_events WHERE turn_id=? ORDER BY seq', (key,))]

    def turn(self, key, after=0):
        row = self.db.execute('SELECT * FROM manual_turns WHERE id=?', (key,)).fetchone()
        if not row:
            raise ValueError('턴을 찾을 수 없습니다.')
        events = [dict(e) for e in self.db.execute('SELECT * FROM manual_events WHERE turn_id=? AND seq>? ORDER BY seq LIMIT 201', (key, int(after)))]
        return {**{k: row[k] for k in ('id', 'session_id', 'agent', 'status', 'reply', 'error', 'created', 'ended')},
                'discussion': len(json.loads(row['config']).get('participants', [])) > 1,
                'outcome': json.loads(row['outcome'] or '{}'), 'more': len(events) > 200,
                'events': [{**e, 'data': json.loads(e['data'])} for e in events[:200]]}

    def cancel(self, sid):
        with self.hub.lock:
            session = self.get(sid)
            for active in self.hub.active.values():
                if active['job'].get('manual_id') == sid:
                    active['cancel'].set()
                    return {'ok': True}
            self.db.execute("UPDATE manual_turns SET status='cancelled',error='실행 전 취소',ended=? WHERE session_id=? AND status='pending'", (time.time(), sid))
            if session['status'] == 'running':
                self.save(session, status='ready')
            self.db.commit()
            return {'ok': True}

    def manage(self, body):
        with self.hub.lock:
            session = self.get(body.get('sessionId'))
            self.idle(session)
            action = body.get('action')
            if action == 'export':
                self.project_free(session['project'], session['id'])
                if ws.fingerprint(session['workspace'], session['base']) != session['fingerprint']:
                    raise ValueError('사본 변경을 /sync로 확인한 뒤 내보내세요.')
                dest = self.hub.root / 'artifacts' / session['id'] / str(session['revision'])
                report = '# 수동 세션\n\n' + context.pack(self.history(session['id']))
                artifacts = ws.export(session['workspace'], session['base'], dest, report)
                return {'directory': str(dest), **artifacts}
            if session['status'] == 'closed':
                raise ValueError('종료된 세션입니다. 기록과 결과물은 계속 확인할 수 있습니다.')
            if action == 'sync':
                self.project_free(session['project'], session['id'])
                fp = ws.fingerprint(session['workspace'], session['base'])
                self.save(session, status='ready', fingerprint=fp, revision=session['revision'] + 1)
                self.db.execute('''INSERT INTO manual_turns
                    (id,session_id,agent,kind,request,status,reply,config,created,ended)
                    VALUES (?,?,'Host','sync','/sync','completed',?,'{}',?,?)''',
                    (uuid.uuid4().hex, session['id'], '사용자가 외부 또는 중단 후 파일 상태를 확인하고 계속하기로 했습니다.', time.time(), time.time()))
            elif action == 'compact':
                summary = body.get('text')
                if not isinstance(summary, str) or not 1 <= len(summary.strip()) <= 12000:
                    raise ValueError('유지할 조건·결정·남은 작업을 1~12,000자로 입력하세요.')
                seq = self.db.execute('SELECT COALESCE(MAX(seq),0) FROM manual_turns WHERE session_id=?', (session['id'],)).fetchone()[0]
                self.save(session, summary=summary.strip(), summary_until=seq, revision=session['revision'] + 1)
            elif action in ('include', 'exclude'):
                name = body.get('text')
                if not isinstance(name, str) or not name:
                    raise ValueError('작업 사본 기준 상대 파일 경로를 입력하세요.')
                name = name.replace('\\', '/')
                names = json.loads(session['included'])
                excluded = json.loads(session.get('excluded', '[]'))
                if action == 'include':
                    if name not in dict(ws.files(session['workspace'])):
                        raise ValueError('Git 관리 대상 또는 무시되지 않은 작업 파일만 포함할 수 있습니다.')
                    if name not in names:
                        names.append(name)
                    excluded = [n for n in excluded if n != name]
                else:
                    if name not in dict(ws.files(session['workspace'])):
                        raise ValueError('작업 사본에 속한 파일 경로만 제외할 수 있습니다.')
                    names = [n for n in names if n != name]
                    if name not in excluded:
                        excluded.append(name)
                self.save(session, included=context.pack(names), excluded=context.pack(excluded), revision=session['revision'] + 1)
            elif action == 'close':
                self.save(session, status='closed')
            else:
                raise ValueError('지원하지 않는 세션 명령입니다.')
            self.db.commit()
            return session

    def run(self, turn, session, cancel, live):
        packet, cfg = json.loads(turn['input']), json.loads(turn['config'])
        participants = cfg.get('participants', [turn['agent']])
        discussion = len(participants) > 1
        folder = storage_path(self.hub.root, 'runs') / ('manual-' + turn['id'])
        result, error = {}, None
        try:
            if ws.fingerprint(session['workspace'], session['base']) != packet['context_bucket']['workspace_snapshot']['fingerprint']:
                raise ValueError('실행 대기 중 파일이 변경되어 호출을 중단했습니다.')
            if cancel.is_set():
                raise RuntimeError('실행 취소')
            if turn['kind'] == 'check':
                check = ws.run_check(cfg['argv'], session['workspace'], folder, cancel)
                self.event(turn['id'], 'tool', {'check': check})
                result = {'reply': check['output'], 'check': check, 'exit_code': check['exit_code']}
                if check['exit_code']:
                    error = '검증 명령이 실패했습니다.'
            elif discussion:
                result = manual_discussion.execute(participants, cfg, packet, folder, cancel, live,
                                                   lambda k, d: self.event(turn['id'], k, d))
                error = result.pop('error', None)
            else:
                result = manual_runner.execute(turn['agent'], cfg, packet, session['writable'], folder,
                                               cancel, live, lambda k, d: self.event(turn['id'], k, d))
        except (RuntimeError, ValueError) as exc:
            error = str(exc)
        except Exception:
            error = '실행에 실패했습니다. 로컬 실행 로그를 확인하세요.'
        try:
            fp = ws.fingerprint(session['workspace'], session['base'])
            changed = ws.git(session['workspace'], 'diff', '--no-renames', '--name-only', '-z', 'HEAD').decode('utf-8').split('\0')
            changed += ws.git(session['workspace'], 'ls-files', '--others', '--exclude-standard', '-z').decode('utf-8').split('\0')
            if (discussion or not session['writable']) and fp != session['fingerprint']:
                error = '읽기 전용 실행에서 파일 변경이 감지되었습니다. /sync로 확인하세요.'
                fp = None
        except Exception:
            fp, changed = None, []
            error = '실행 후 작업 사본을 검증할 수 없습니다. 로그와 Git 상태를 확인하세요.'
        return {'result': result, 'error': error, 'fingerprint': fp,
                'outcome': {'before': session['fingerprint'], 'after': fp, 'changed_files': sorted(set(n for n in changed if n)),
                            'exit_code': result.get('exit_code'), 'check': result.get('check'), 'logs': str(folder)}}

    def collect(self):
        for agent, active in list(self.hub.active.items()):
            if self.hub.active.get(agent) is not active:
                continue  # A discussion reserves several providers with the same active job.
            sid = active['job'].get('manual_id')
            if not sid or not active['future'].done():
                continue
            try:
                wrapped = active['future'].result()
            except Exception:
                wrapped = {'result': {}, 'error': '작업 종료 처리 실패. /sync로 상태를 확인하세요.', 'fingerprint': None, 'outcome': {}}
            status = 'cancelled' if active['cancel'].is_set() else ('failed' if wrapped['error'] else 'completed')
            reply = wrapped['result'].get('reply', '')
            if not reply and len(active.get('participants', [])) > 1:
                reply = manual_discussion.transcript(manual_discussion.messages(
                    self.events(active['job']['id']), status, wrapped['error']))
            elif not reply:
                reply = ''.join(json.loads(e[0]).get('text', '') for e in self.db.execute(
                    "SELECT data FROM manual_events WHERE turn_id=? AND kind='text' ORDER BY seq", (active['job']['id'],)))
            self.db.execute('UPDATE manual_turns SET status=?,reply=?,error=?,outcome=?,ended=? WHERE id=?',
                            (status, reply, wrapped['error'], context.pack(wrapped['outcome']), time.time(), active['job']['id']))
            session = self.get(sid)
            self.save(session, status='ready' if wrapped['fingerprint'] else 'interrupted',
                      fingerprint=wrapped['fingerprint'], revision=session['revision'] + 1)
            for participant in active.get('participants', [agent]):
                del self.hub.active[participant]
            self.db.commit()

    def tick(self):
        self.collect()
        if self.hub.stop.is_set():
            return
        for row in self.db.execute("SELECT * FROM manual_turns WHERE status='pending' ORDER BY seq").fetchall():
            participants = json.loads(row['config']).get('participants', [row['agent']])
            if any(agent in self.hub.active for agent in participants):
                continue
            session = self.get(row['session_id'])
            cancel = threading.Event()
            active = {'job': {'id': row['id'], 'manual_id': session['id'], 'tid': session['tid']},
                      'participants': participants, 'cancel': cancel, 'process': None, 'processes': {}}
            self.db.execute("UPDATE manual_turns SET status='running' WHERE id=?", (row['id'],))
            self.db.commit()
            for agent in participants:
                self.hub.active[agent] = active
            def live(proc, provider=None, a=active):
                if provider:
                    a['processes'][provider] = proc
                else:
                    a['process'] = proc
            active['future'] = self.hub.pool.submit(self.run, dict(row), session, cancel, live)

    def loop(self):
        while not self.hub.stop.wait(.15):
            with self.hub.lock:
                self.tick()

    def deliver(self, cfg, threads):
        scope = self.hub.scope(cfg)
        for row in self.db.execute("SELECT * FROM manual_turns WHERE delivered=0 AND status NOT IN ('pending','running') ORDER BY seq").fetchall():
            session = self.get(row['session_id'])
            if not session['tid'] or session['scope'] != scope:
                continue
            thread = next((t for t in threads if t['threadId'] == session['tid'] and t.get('state') != 'closed'), None)
            if not thread:
                continue
            marker = '[HUB-MANUAL:' + row['id'] + ']'
            if not any(marker in m.get('messageText', '') and m.get('sendingAgentName') == cfg['observer'] for m in thread.get('messages', [])):
                text = f"수동 세션 · {row['agent']} · {row['status']}\n\n요청: {row['request']}\n\n{row['reply'] or row['error'] or ''}"
                if len(text) > 5800:
                    text = text[:5800] + '\n[전체 원문은 CLI /history에서 확인하세요.]'
                self.hub.peer(cfg['observer'], cfg).tool('coral_send_message', threadId=session['tid'], content=text + '\n\n' + marker, mentions=[])
            self.db.execute('UPDATE manual_turns SET delivered=1 WHERE id=?', (row['id'],))
            self.db.commit()
