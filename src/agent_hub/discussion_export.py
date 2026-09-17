"""Read-only Markdown export of channel messages and complete discussion history."""
import json
import re
from datetime import datetime, timezone
from .collaboration import PHASES

LABELS={**PHASES,'request':'요청','guidance':'추가 지침','question':'질문','notice':'정보 공유','issue':'쟁점','opinions_sealed':'독립 의견 취합','opinions_revealed':'전체 의견 공개','agreed':'검토 완료','blocked':'합의 보류','cancelled':'취소','format_correction':'응답 형식 확인','validation_failed':'자동 검증 실패','pipeline_context':'이전 작업 참고'}
STATUS={'active':'진행 중','agreed':'검토 완료','blocked':'보류','cancelled':'취소'}

def inline(value):
    return re.sub(r'([\\`*_{}\[\]<>#|!])',r'\\\1',str(value or '').replace('\r',' ').replace('\n',' '))

def stamp(value):
    try:
        d=datetime.fromtimestamp(value,timezone.utc) if isinstance(value,(int,float)) else datetime.fromisoformat(str(value).replace('Z','+00:00'))
        return d.astimezone().isoformat(timespec='seconds')
    except (ValueError,TypeError,OverflowError,OSError):return '시각 미상'

def quote(value):
    # Nest original Markdown so message headings cannot replace the document outline.
    return '\n'.join('> '+line for line in str(value or '').splitlines()) or '> (내용 없음)'

def export_channel(hub,tid):
    with hub.lock:
        thread=next((t for t in hub.threads if t['threadId']==tid),None)
        if thread is None:raise ValueError('채널을 찾을 수 없습니다.')
        scope=hub.scope(hub.config.value or {})
        rounds=hub.db.execute('SELECT * FROM collab_rounds WHERE scope=? AND tid=? ORDER BY created,id',(scope,tid)).fetchall()
        title=thread.get('threadName') or tid
        now=datetime.now().astimezone()
        lines=['# '+inline(title),'', '- 내보낸 시각: '+now.isoformat(timespec='seconds'),'- 채널: '+inline(tid),'- 토론 수: '+str(len(rounds)), '', '현재까지 저장된 채널 메시지와 전체 내부 토론 기록입니다. 진행 중인 토론은 미완성 기록이며, 전원 제출 전 독립 의견은 포함하지 않습니다.', '']
        notes=hub.channels.notes().get(tid)
        if notes:
            lines+=['## 저장한 작업 요약','']
            for key,label in [('goal','목표'),('decisions','결정 사항'),('remaining','남은 작업')]:
                if notes.get(key):lines+=['### '+label,'',quote(notes[key]),'']
        lines+=['## 목차','','- [채널 메시지](#channel-messages)']
        for n,r in enumerate(rounds,1):lines.append(f'- [토론 {n} · {STATUS.get(r["status"],r["status"])}](#discussion-{n})')
        lines+=['','<a id="channel-messages"></a>','## 채널 메시지','']
        for m in thread.get('messages',[]):
            body=str(m.get('messageText',''))
            # The original full terminal result appears in its discussion below.
            if any(f'[COLLAB-FINAL:{r["id"]}]' in body and m.get('sendingAgentName')==r['lead'] and r['final'] for r in rounds):continue
            lines+=['### '+inline(m.get('sendingAgentName','알 수 없음'))+' · '+stamp(m.get('messageTimestamp')),'',quote(body),'']
        if not thread.get('messages'):lines+=['_채널 메시지가 없습니다._','']
        for n,r in enumerate(rounds,1):
            lines+=['---','',f'<a id="discussion-{n}"></a>',f'## 토론 {n} · {STATUS.get(r["status"],r["status"])}','', '- 시작: '+stamp(r['created']),'- 참여자: '+', '.join(inline(a.upper()) for a in json.loads(r['team'])),'- 단계: '+LABELS.get(r['stage'],r['stage'])+f' · V{r["version"]}','', '### 요청','',quote(r['request']),'']
            events=hub.db.execute('SELECT * FROM collab_events WHERE round_id=? ORDER BY id',(r['id'],)).fetchall()
            sealed=any(e['kind']=='opinions_sealed' for e in events) and not any(e['kind']=='opinions_revealed' for e in events)
            if sealed:lines+=['_독립 의견 취합 중: 제출 내용은 전원 제출 후 공개됩니다._','']
            lines+=['### 토론 기록','']
            for e in events:
                if e['kind'] in ('request','agreed','blocked','cancelled') or (sealed and e['kind']=='explore'):continue
                lines+=['#### '+inline(e['sender'].upper())+' · '+LABELS.get(e['kind'],inline(e['kind']))+' · '+stamp(e['created']),'']
                targets=json.loads(e['targets'] or '[]')
                if targets and e['kind'] in ('question','issue','notice'):lines+=['받는 에이전트: '+', '.join(inline(a.upper()) for a in targets),'']
                if e['kind']=='review':
                    task=hub.db.execute("SELECT version,result FROM collab_tasks WHERE round_id=? AND agent=? AND stage='review' AND status='done' AND ended<=? ORDER BY ended DESC LIMIT 1",(r['id'],e['sender'],e['created'])).fetchone()
                    if task:
                        vote=json.loads(task['result']);lines+=[f'검토: V{task["version"]} · '+inline(vote.get('decision','')),'']
                lines+=[quote(e['content']),'']
            lines+=['### 최종 결과','',quote(r['final']) if r['final'] else '_아직 최종 결과가 없습니다._','']
        filename=re.sub(r'[<>:"/\\|?*\x00-\x1f]','_',str(title)).strip(' .')[:80] or 'channel'
        return {'filename':f'토론_{filename}_{now:%Y%m%d-%H%M%S}.md','markdown':'\n'.join(lines)}
