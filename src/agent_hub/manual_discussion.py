"""Two bounded parallel rounds over one shared, read-only context."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

from . import manual_context as context, manual_runner, pipeline_workspace as ws


def messages(events, status, error=None):
    """Recover attributed statements even if the server stopped mid-response."""
    found = {}
    for event in events:
        data = event['data']
        if event['kind'] not in ('text', 'speaker') or 'agent' not in data:
            continue
        key = (data['round'], data['agent'])
        if event['kind'] == 'speaker':
            found[key] = data
        else:
            item = found.setdefault(key, {'agent': data['agent'], 'round': data['round'],
                                         'message': '', 'status': status, 'error': error})
            item['message'] += data.get('text', '')
    return list(found.values())


def transcript(statements):
    return '\n\n'.join(f"[{s['round']}차 · {s['agent']} · {s['status']}]\n{s['message']}"
                       + ('\n' + s['error'] if s.get('error') else '') for s in statements)


def execute(participants, cfg, packet, folder, cancel, live, emit):
    statements, error = [], None
    snapshot = packet['context_bucket']['workspace_snapshot']

    def unchanged():
        if ws.fingerprint(snapshot['current_directory'], snapshot['base_commit']) != snapshot['fingerprint']:
            raise ValueError('토론 중 작업 사본이 변경되었습니다. /sync로 확인하세요.')

    def speak(agent, shared, round_number):
        partial, tool_events = [], []
        result, failure = {}, None
        def progress(kind, data):
            if kind == 'text':
                partial.append(data['text'])
            elif kind == 'tool':
                tool_events.append(data)
            emit(kind, {**data, 'agent': agent, 'round': round_number})
        try:
            if cancel.is_set():
                raise RuntimeError('토론이 중단되었습니다.')
            result = manual_runner.execute(agent, cfg, deepcopy(shared), False,
                folder / f'round-{round_number}' / agent, cancel,
                lambda proc: live(proc, agent), progress)
        except (RuntimeError, ValueError) as exc:
            failure = str(exc)
        except Exception:
            failure = '발언 실행에 실패했습니다. 로컬 실행 로그를 확인하세요.'
        statement = {'agent': agent, 'round': round_number,
                     'message': result.get('reply') or ''.join(partial),
                     'status': 'cancelled' if cancel.is_set() else ('failed' if failure else 'completed'),
                     'error': failure}
        emit('speaker', statement)
        return {**statement, 'tool_events': tool_events}

    try:
        with ThreadPoolExecutor(max_workers=len(participants)) as pool:
            for round_number in (1, 2):
                if cancel.is_set():
                    raise RuntimeError('토론이 중단되었습니다.')
                unchanged()
                shared = deepcopy(packet)
                shared['discussion'] = {'participants': participants, 'round': round_number, 'rounds': 2}
                shared['context_bucket']['discussion_history'] = deepcopy(statements)
                shared['context_hash'] = context.digest(shared)
                emit('round', {'round': round_number, 'participants': participants})
                # Submit everyone before waiting; round 2 starts only after all first replies finish.
                futures = [pool.submit(speak, agent, shared, round_number) for agent in participants]
                replies = [future.result() for future in futures]
                statements.extend(replies)
                unchanged()
                if any(s['status'] != 'completed' for s in replies):
                    raise RuntimeError('일부 발언이 완료되지 않아 토론을 중단했습니다. 받은 답변은 /history에 보존됩니다.')
    except (RuntimeError, ValueError) as exc:
        error = str(exc)
    return {'reply': transcript(statements), 'error': error,
            'exit_code': 0 if not error else None}
