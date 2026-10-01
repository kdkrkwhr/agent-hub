"""Fresh native calls with normalized progress and a required terminal receipt."""
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time

from . import adapters
from .config import atomic_json
from .manual_context import instructions


def command(agent, config, folder, packet, writable):
    workspace = packet['context_bucket']['workspace_snapshot']['current_directory']
    args = adapters.pipeline_command(agent, config, folder,
                                     {'workspace': workspace, 'phase': 'implement' if writable else 'inspect'})
    if agent in ('claude', 'cursor'):
        args[args.index('--output-format') + 1] = 'stream-json'
        if agent == 'claude':
            args += ['--verbose', '--include-partial-messages']
        else:
            args += ['--stream-partial-output']
            if writable:
                args += ['--force']
    return args


class Stream:
    def __init__(self, agent, emit):
        self.agent, self.emit = agent, emit
        self.reply = ''
        self.terminal = False
        self.failed = False
        self.partial = False
        self.seen = set()

    def text(self, value):
        if isinstance(value, str) and value:
            self.emit('text', {'text': value})

    def tool(self, value):
        # Full native events remain in stdout.log; the shared history is bounded.
        encoded = json.dumps(value, ensure_ascii=False)
        self.emit('tool', {'event': value} if len(encoded) <= 16000 else
                  {'excerpt': encoded[:16000], 'truncated': True, 'full_log': 'stdout.log'})

    def feed(self, event):
        if not isinstance(event, dict):
            return
        kind = event.get('type')
        if self.agent == 'codex':
            if kind in ('turn.completed', 'turn.failed', 'error'):
                if kind != 'error':
                    self.terminal = True
                self.failed |= kind != 'turn.completed'
            item = event.get('item', {})
            if not isinstance(item, dict):
                return
            if kind == 'item.completed' and item.get('type') == 'agent_message':
                key = item.get('id') or json.dumps(item, sort_keys=True)
                if key not in self.seen:
                    self.seen.add(key)
                    self.text(item.get('text'))
            elif kind in ('item.started', 'item.completed') and item.get('type') in ('command_execution', 'file_change'):
                self.tool(event)
        else:
            if kind == 'result':
                self.terminal = True
                self.failed |= bool(event.get('is_error')) or event.get('subtype', 'success') != 'success'
                self.reply = event.get('result') or event.get('text') or ''
            elif kind == 'stream_event':
                delta = event.get('event', {}).get('delta', {})
                if delta.get('type') == 'text_delta':
                    self.partial = True
                    self.text(delta.get('text'))
            elif kind == 'assistant':
                contents = event.get('message', {}).get('content', [])
                is_delta = self.agent == 'cursor' and 'timestamp_ms' in event and 'model_call_id' not in event
                if is_delta:
                    self.partial = True
                for part in contents if isinstance(contents, list) else []:
                    if not isinstance(part, dict):
                        continue
                    if part.get('type') == 'text' and (is_delta or not self.partial):
                        self.text(part.get('text'))
                    elif part.get('type') == 'tool_use':
                        self.tool(part)
            elif kind == 'tool_call':
                self.tool(event)
            elif kind == 'user':
                contents = event.get('message', {}).get('content', [])
                for part in contents if isinstance(contents, list) else []:
                    if isinstance(part, dict) and part.get('type') == 'tool_result':
                        self.tool(part)


def terminate(proc):
    if proc.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(proc.pid), '/T', '/F'], capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        os.killpg(proc.pid, signal.SIGTERM)
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            proc.kill()
        proc.wait(timeout=5)


def execute(agent, config, packet, writable, folder, cancel, live, emit):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    atomic_json(folder / 'context.json', packet)
    prompt = instructions(packet, writable).encode('utf-8')
    args = command(agent, config, folder, packet, writable)
    stream = Stream(agent, emit)
    workspace = packet['context_bucket']['workspace_snapshot']['current_directory']
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
    env = {**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'}
    # Boundary inboxes belong to collaboration rounds, never to manual sessions.
    env.pop('AGENT_HUB_BOUNDARY_DB', None)
    env.pop('AGENT_HUB_BOUNDARY_TASK', None)
    with (folder / 'stdout.log').open('wb') as out, (folder / 'stderr.log').open('wb') as err:
        proc = subprocess.Popen(args, cwd=workspace, env=env, stdin=subprocess.PIPE,
                                stdout=out, stderr=err, **flags)
        live(proc)
        def write_input():
            try:
                proc.stdin.write(prompt)
            except (BrokenPipeError, OSError):
                pass
            finally:
                try:
                    proc.stdin.close()
                except OSError:
                    pass
        writer = threading.Thread(target=write_input, daemon=True)
        writer.start()
        pending = b''
        until = time.monotonic() + 600
        try:
            with (folder / 'stdout.log').open('rb') as reader:
                while True:
                    done = proc.poll() is not None
                    pending += reader.read()
                    if len(pending) > 4 * 1024 * 1024:
                        raise RuntimeError('CLI 출력 이벤트가 4MB 한도를 초과했습니다. 실행 로그를 확인하세요.')
                    lines = pending.split(b'\n')
                    pending = lines.pop()
                    if done and pending:
                        lines.append(pending)
                        pending = b''
                    for line in lines:
                        try:
                            event = json.loads(line)
                        except (ValueError, UnicodeError):
                            continue
                        stream.feed(event)
                    if cancel.is_set():
                        raise RuntimeError('사용자가 실행을 중단했습니다. 일부 파일 변경이 남을 수 있습니다.')
                    if done:
                        break
                    if time.monotonic() >= until:
                        raise RuntimeError('CLI 실행이 10분 제한을 초과했습니다.')
                    cancel.wait(.1)
            if proc.returncode or stream.failed or not stream.terminal:
                raise RuntimeError('CLI가 정상 완료되지 않았습니다. 실행 로그와 로그인 상태를 확인하세요.')
            reply = (folder / 'final.txt').read_text(encoding='utf-8') if agent == 'codex' else stream.reply
            if not isinstance(reply, str) or not reply.strip():
                raise RuntimeError('CLI가 최종 답변을 반환하지 않았습니다.')
            (folder / 'response.md').write_text(reply, encoding='utf-8')
            return {'reply': reply, 'exit_code': proc.returncode}
        finally:
            terminate(proc)
            writer.join(timeout=5)
            live(None)
