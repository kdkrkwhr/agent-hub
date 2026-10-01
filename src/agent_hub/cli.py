"""Single-terminal client for the Hub's centralized manual sessions."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import shlex
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

from .config import data_directory, atomic_json
from .manual_context import route

HELP = '''@claude / @codex / @cursor [요청]  담당자 전환 또는 실행
@claude @codex [주제]             동시 의견 → 서로 읽고 재검토 (읽기 전용 2회차)
멘션 없는 요청                   현재 담당자에게 실행
/status                         작업 폴더와 최근 턴 확인
/history                        공통 대화 원문 보기
/context                        다음 요청에 전달할 대화·도구·코드 용량 확인
/include 경로 | /exclude 경로   컨텍스트에 포함할 상대 파일 경로
/compact 요약                   이전 기록 대신 전달할 공통 요약 (원문 보존)
/sync                           외부 변경·중단 후 파일 상태 확인 및 계속하기
/check 명령                     작업 사본에서 검증 명령 한 개 실행
/cancel                         진행 중인 턴 중단
/export                         누적 패치·ZIP·보고서 생성
/close                          세션 종료 (기록·사본 보존)
/exit                           CLI 나가기 (다음 실행에서 --resume 가능)
실행 중 Ctrl+C: 중단 요청'''


def clean(text):
    # Model/tool output must not execute terminal control sequences.
    text = re.sub(r'\x1b\][^\x07]*(?:\x07|\x1b\\)', '', str(text))
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    return ''.join(c for c in text if c in '\n\t' or ord(c) >= 32 and not 127 <= ord(c) <= 159)


class Client:
    def __init__(self, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'http' or parsed.hostname not in ('127.0.0.1', 'localhost') or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('--server는 로컬 Hub의 http://127.0.0.1:포트 주소여야 합니다.')
        self.url, self.token = url.rstrip('/'), None
        self.bootstrap = self.request('/api/bootstrap')
        if self.bootstrap.get('manual_sessions') is not True:
            raise RuntimeError('실행 중인 Hub가 수동 세션을 지원하지 않습니다. 서버를 최신 코드로 재시작하세요.')
        self.token = self.bootstrap['csrf']

    def request(self, path, body=None):
        request = urllib.request.Request(self.url + path,
                    data=json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None,
                    headers={'Content-Type': 'application/json', 'X-Hub-CSRF': self.token or ''})
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            try:
                message = json.load(exc).get('error', 'Hub 요청 실패')
            except (ValueError, AttributeError):
                message = 'Hub 요청 실패'
            raise ValueError(message) from None

    def session(self, sid):
        return self.request('/api/manual/session?' + urllib.parse.urlencode({'id': sid}))

    def turn(self, key, after=0):
        return self.request('/api/manual/turn?' + urllib.parse.urlencode({'id': key, 'after': after}))


@contextmanager
def connection(args):
    root = (args.data_dir or data_directory()).expanduser().resolve()
    launch = root / 'config' / 'launcher.json'
    saved = json.loads(launch.read_text(encoding='utf-8')) if launch.exists() else {}
    port = args.port or saved.get('port', 8768)
    url = args.server or f'http://127.0.0.1:{port}'
    try:
        client = Client(url)
    except urllib.error.URLError:
        if args.server:
            raise RuntimeError('지정한 Hub에 연결할 수 없습니다.') from None
    else:
        if args.data_dir and Path(client.bootstrap.get('data_directory', '')).resolve() != root:
            raise ValueError('이 포트의 Hub는 다른 데이터 폴더를 사용합니다. --port로 다른 포트를 선택하세요.')
        yield client
        return
    from .__main__ import InstanceLock
    from .engine import Hub
    from .server import make_server
    from .storage import initialize
    root.mkdir(parents=True, exist_ok=True)
    with InstanceLock(root / 'instance.lock'):
        if not (root / 'storage.json').exists() and not (root / 'config.json').exists() and not (root / 'queue.sqlite3').exists():
            initialize(root)
        hub = Hub(root)
        try:
            server = make_server(hub, port)
        except OSError:
            hub.close()
            raise RuntimeError('포트를 사용할 수 없습니다. --port로 다른 포트를 선택하세요.') from None
        serving = threading.Thread(target=server.serve_forever, daemon=True)
        try:
            hub.start(manual_only=True)
            serving.start()
            atomic_json(launch, {'port': server.server_port})
            print('이 터미널에서 수동 세션용 Hub를 시작했습니다. CLI 종료 시 함께 종료됩니다.')
            yield Client(f'http://127.0.0.1:{server.server_port}')
        finally:
            server.shutdown()
            server.server_close()
            serving.join(timeout=5)
            hub.close()


def tool_label(data):
    if 'check' in data:
        return '검증 명령 종료: ' + str(data['check'].get('exit_code'))
    event = data.get('event', {})
    item = event.get('item', {})
    if item.get('type') == 'command_execution':
        return f"명령: {item.get('command', '')} · {item.get('status', event.get('type', ''))} · exit={item.get('exit_code')}"
    return '도구: ' + str(event.get('name') or item.get('type') or event.get('type') or '실행 기록')


class DiscussionOutput:
    def __init__(self):
        self.pending, self.displayed = {}, {}

    def flush(self, key):
        text = self.pending.pop(key, '')
        if text:
            print(f'[{key[0]}차 · {key[1]}] ' + clean(text), flush=True)

    def feed(self, kind, data):
        if kind == 'round':
            title = '각자 의견' if data['round'] == 1 else '서로의 의견을 읽고 재검토'
            print(f"\n[토론 {data['round']}/2 · {title} · 읽기 전용]", flush=True)
            return
        key = (data['round'], data['agent'])
        if kind == 'text':
            self.displayed[key] = self.displayed.get(key, '') + data['text']
            text = self.pending.get(key, '') + data['text']
            lines = text.split('\n')
            for line in lines[:-1]:
                print(f'[{key[0]}차 · {key[1]}] ' + clean(line), flush=True)
            self.pending[key] = lines[-1]
            if len(lines[-1]) >= 240:
                self.flush(key)
        elif kind == 'tool':
            self.flush(key)
            print(f'[{key[0]}차 · {key[1]}] ' + clean(tool_label(data)), flush=True)
        elif kind == 'speaker':
            self.flush(key)
            if data['message'] and data['message'] not in self.displayed.get(key, ''):
                print(f'[{key[0]}차 · {key[1]}]\n' + clean(data['message']), flush=True)
            if data['status'] != 'completed':
                print(f'[{key[0]}차 · {key[1]} · {data["status"]}] ' + clean(data.get('error') or ''), flush=True)


def watch(client, sid, key):
    after, displayed, cancelling = 0, '', False
    discussion = DiscussionOutput()
    while True:
        try:
            turn = client.turn(key, after)
            for event in turn['events']:
                after = event['seq']
                if 'round' in event['data']:
                    discussion.feed(event['kind'], event['data'])
                elif event['kind'] == 'text':
                    print(clean(event['data']['text']), end='', flush=True)
                    displayed += event['data']['text']
                elif event['kind'] == 'tool':
                    print('\n[' + clean(tool_label(event['data'])) + ']', flush=True)
            if turn['status'] not in ('pending', 'running') and not turn['more']:
                for pending in list(discussion.pending):
                    discussion.flush(pending)
                if not turn.get('discussion') and turn['reply'] and turn['reply'] not in displayed:
                    print('\n' + clean(turn['reply']))
                print('\n[' + turn['status'] + ']' + (' ' + clean(turn['error']) if turn['error'] else ''))
                return
            time.sleep(.2)
        except KeyboardInterrupt:
            if cancelling:
                raise
            cancelling = True
            client.request('/api/manual/cancel', {'sessionId': sid})
            print('\n중단 요청을 보냈습니다. 프로세스 종료와 파일 상태 기록을 기다립니다.')


def repl(client, session):
    sid = session['id']
    print(clean(f"세션: {sid}\n작업 사본: {session['workspace']}\n모드: {'파일 수정 허용' if session['writable'] else '읽기 전용'}"))
    if session.get('workspace_kind') == 'folder':
        print('일반 폴더 사본입니다. 시작 시 파일 상태를 기준으로 변경을 기록합니다. Git은 사용하지 않습니다.')
    root = client.bootstrap['data_directory']
    quoted = "'" + root.replace("'", "''") + "'" if os.name == 'nt' else shlex.quote(root)
    port = urllib.parse.urlsplit(client.url).port or 80
    print(clean(f'이후 재접속: agent-hub chat --resume {sid} --data-dir {quoted} --port {port}'))
    print('입력 시 선택한 실제 CLI가 실행됩니다. /help로 명령을 확인하세요.')
    while True:
        try:
            session = client.session(sid)
            last = session.get('last_turn')
            if last and last['status'] in ('pending', 'running'):
                watch(client, sid, last['id'])
                session = client.session(sid)
            line = input(session['agent'] + '> ').strip()
            if not line:
                continue
            if line == '/exit':
                return
            if line == '/help':
                print(HELP)
            elif line == '/status':
                print(clean(json.dumps(client.session(sid), ensure_ascii=False, indent=2)))
            elif line == '/history':
                history = client.request('/api/manual/history?' + urllib.parse.urlencode({'id': sid}))
                for item in history:
                    print(clean(json.dumps(item, ensure_ascii=False)))
            elif line == '/context':
                usage = client.request('/api/manual/context?' + urllib.parse.urlencode({'id': sid}))
                print(f"현재 컨텍스트 {usage['context_bytes'] / 1024:.1f} / {usage['limit_bytes'] / 1024:.0f}KB (다음 요청 본문 제외)")
                print(f"대화 {usage['history_bytes'] / 1024:.1f}KB (그중 도구 {usage['tool_bytes'] / 1024:.1f}KB), "
                      f"코드·diff {usage['snapshot_bytes'] / 1024:.1f}KB, 요약 {usage['summary_bytes'] / 1024:.1f}KB")
                for file in usage['largest_files']:
                    print(clean(f"  {file['path']}: {file['bytes'] / 1024:.1f}KB"))
                print('대화가 크면 /compact 유지할 조건·결정·남은 작업, 파일이 크면 /exclude 상대경로를 사용하세요. 원문은 보존됩니다.')
            elif line == '/cancel':
                client.request('/api/manual/cancel', {'sessionId': sid})
            elif line.startswith('/') and not line.startswith('/check '):
                action, _, value = line[1:].partition(' ')
                if action not in ('include', 'exclude', 'compact', 'sync', 'export', 'close'):
                    raise ValueError('알 수 없는 명령입니다. /help를 확인하세요.')
                result = client.request('/api/manual/manage', {'sessionId': sid, 'action': action, 'text': value})
                print(clean(result.get('directory') or '반영했습니다.'))
                if action == 'close':
                    return
            else:
                check = line.startswith('/check ')
                if not check and len(route(line, session['agent'])[0]) > 1 and not client.bootstrap.get('manual_discussions'):
                    raise RuntimeError('실행 중인 Hub가 동시 토론을 지원하지 않습니다. Hub를 최신 코드로 재시작하세요.')
                result = client.request('/api/manual/submit', {'sessionId': sid, 'text': line[7:] if check else line,
                                        'kind': 'check' if check else 'chat', 'requestId': uuid.uuid4().hex})
                if not result.get('switched'):
                    watch(client, sid, result['id'])
        except EOFError:
            return
        except KeyboardInterrupt:
            print('\nCLI를 종료합니다. 기록은 보존됩니다.')
            return
        except (ValueError, RuntimeError) as exc:
            print(clean(exc))
        except (urllib.error.URLError, TimeoutError, OSError):
            print('Hub 통신이 끊겼습니다. --resume으로 실행 상태를 확인하세요. 요청은 자동 재전송하지 않습니다.')
            return


def main(argv=None):
    parser = argparse.ArgumentParser(prog='agent-hub chat', description='공통 기록과 작업 사본을 사용하는 수동 에이전트 세션')
    parser.add_argument('--source', type=Path, help='새 세션의 작업 폴더 (기본값: 현재 폴더, Git 없어도 사용 가능)')
    parser.add_argument('--folder', action='store_true', help='새 세션을 일반 폴더 사본으로 시작 (Git·커밋 불필요, 재접속에는 기존 방식 유지)')
    parser.add_argument('--interactive-source', action='store_true', help='새 세션의 프로젝트 경로를 터미널에서 입력')
    parser.add_argument('--resume', help='기존 세션 ID')
    parser.add_argument('--list', action='store_true', help='저장된 세션 목록')
    parser.add_argument('--agent', choices=('claude', 'codex', 'cursor'), default='codex')
    parser.add_argument('--read-only', action='store_true')
    parser.add_argument('--thread', help='선택적으로 기록을 전달할 열린 Coral 채널 ID')
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--port', type=int)
    parser.add_argument('--server', help='실행 중인 로컬 Hub 주소 (자동 시작하지 않음)')
    args = parser.parse_args(argv)
    if args.resume and (args.source or args.thread or args.read_only):
        parser.error('--resume은 저장된 작업 폴더·채널·권한을 그대로 사용합니다.')
    if args.interactive_source and not (args.source or args.resume or args.list):
        try:
            value = input('작업할 폴더 경로 (Git 불필요, 빈칸: 종료): ').strip()
        except (EOFError, KeyboardInterrupt):
            return 0
        if not value:
            return 0
        if len(value) > 1 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        args.source = Path(value)
    try:
        with connection(args) as client:
            if args.list:
                for s in client.request('/api/manual/sessions'):
                    print(clean(f"{s['id']}  {s['status']}  {s['source']}"))
                return 0
            if args.folder and not args.resume and not client.bootstrap.get('manual_folders'):
                raise RuntimeError('실행 중인 Hub가 일반 폴더 사본을 지원하지 않습니다. Hub를 최신 코드로 재시작하세요.')
            session = client.session(args.resume) if args.resume else client.request('/api/manual/session', {
                'source': str((args.source or Path.cwd()).resolve()), 'agent': args.agent,
                'authorizeWrites': not args.read_only, 'threadId': args.thread,
                'workspaceMode': 'folder' if args.folder else 'auto'})
            repl(client, session)
        return 0
    except (ValueError, RuntimeError, OSError, urllib.error.URLError) as exc:
        print(clean(exc))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
