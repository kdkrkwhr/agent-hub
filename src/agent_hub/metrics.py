"""Measured native invocations and collaboration delivery counters; no cost estimates."""
from .storage import path as storage_path
import json
import time
import uuid
from pathlib import Path
from .config import atomic_json


def usage(name, text):
    try:
        if name == 'codex':
            records=[json.loads(line) for line in text.splitlines() if line.strip()]
            values=[r.get('usage') for r in records if r.get('type')=='turn.completed']
        else:
            r=json.loads(text)
            values=[r.get('usage')] if r.get('type')=='result' else []
        if not values or any(not isinstance(v,dict) for v in values):return None
        keys=('input_tokens','output_tokens')
        if any(type(v.get(k)) is not int or v[k]<0 for v in values for k in keys):return None
        result={k:sum(v[k] for v in values) for k in keys}
        for key in ('cache_read_input_tokens','cache_creation_input_tokens','cached_input_tokens'):
            if any(key in v for v in values):
                if any(type(v.get(key,0)) is not int or v.get(key,0)<0 for v in values):return None
                result[key]=sum(v.get(key,0) for v in values)
        return result
    except (ValueError,TypeError,AttributeError):return None


def execute(run, name, config, context, incoming, folder, cancel, live):
    path=folder/('metrics-'+uuid.uuid4().hex+'.json')
    record=None
    def report(proc):
        nonlocal record
        if proc is not None:
            record={'agent':name,'started':time.time(),'ended':None,'usage':None}
            try:atomic_json(path,record)
            except OSError:pass
        live(proc)
    try:return run(name,config,context,incoming,folder,cancel,report)
    finally:
        if record is not None:
            record['ended']=time.time()
            try:record['usage']=usage(name,(folder/'stdout.log').read_text(encoding='utf-8',errors='replace'))
            except OSError:pass
            try:atomic_json(path,record)
            except OSError:pass


def snapshot(db, root, round_, events, now=None):
    now=time.time() if now is None else now
    tasks=[dict(t) for t in db.execute('SELECT * FROM collab_tasks WHERE round_id=?',(round_['id'],))]
    agents=[]
    for agent in round_['team']:
        own=[t for t in tasks if t['agent']==agent]
        records=[];legacy=0;legacy_seconds=0
        for task in own:
            found=[]
            for file in (storage_path(Path(root),'runs')/task['id']).glob('metrics-*.json'):
                try:found.append(json.loads(file.read_text(encoding='utf-8')))
                except (OSError,ValueError):continue
            records.extend(found)
            if not found and task['started'] is not None:
                legacy+=1
                legacy_seconds+=max(0,(task['ended'] or now)-task['started'])
                # Historical repair attempts have no independent timestamps.
                legacy+=db.execute('SELECT COUNT(*) FROM collab_repairs WHERE task=?',(task['id'],)).fetchone()[0]
        known=[r['usage'] for r in records if r.get('usage') is not None]
        totals={k:sum(u.get(k,0) for u in known) for k in set().union(*(u.keys() for u in known))}
        agents.append({'agent':agent,'calls':len(records)+legacy,'legacy_calls':legacy,
            'seconds':legacy_seconds+sum(max(0,(r['ended'] or now)-r['started']) for r in records),
            'usage':totals or None,'usage_calls':len(known)})
    terminal=[e['created'] for e in events if e['kind'] in ('agreed','blocked','cancelled')]
    elapsed=max(0,((max(terminal) if terminal else now)-round_['created']))
    boundary=db.execute('SELECT COUNT(*),COUNT(d.acknowledged) FROM collab_boundary_deliveries d JOIN collab_tasks t ON t.id=d.task WHERE t.round_id=?',(round_['id'],)).fetchone()
    bundled=db.execute("""SELECT COUNT(*) FROM collab_inbox i JOIN collab_tasks t ON t.id=i.consumed_by
        JOIN collab_events e ON e.id=i.event WHERE t.round_id=? AND t.stage!='consult' AND e.kind='question'
        AND NOT EXISTS (SELECT 1 FROM collab_boundary_deliveries d WHERE d.task=t.id AND d.event=e.id AND d.acknowledged IS NOT NULL)""",(round_['id'],)).fetchone()[0]
    cancelled=sum(t['status']=='cancelled' and t['error']=='Question received at tool boundary' for t in tasks)
    return {'elapsed_seconds':elapsed,'calls':sum(a['calls'] for a in agents),'agents':agents,
        'bundled_questions':bundled,'boundary_offered':boundary[0],'boundary_received':boundary[1],
        'boundary_cancelled_calls':cancelled}
