"""Model selection and safe metadata. Never read native authentication files."""
from .storage import path as storage_path
import json
import os
from pathlib import Path
import re
import subprocess
import time
import queue
import threading
import concurrent.futures
import tomllib
from .config import atomic_json,PROVIDERS

PATTERN=re.compile(r'[A-Za-z0-9][A-Za-z0-9._:/+\[\],= -]{0,159}')
def model_id(value):return value if isinstance(value,str) and PATTERN.fullmatch(value) else ''
def validate(values):
    if not isinstance(values,dict) or any(k not in PROVIDERS for k in values):raise ValueError('Invalid model settings.')
    result={}
    for name,value in values.items():
        if not isinstance(value,str):raise ValueError('Model must be text.')
        value=value.strip()
        if value and not model_id(value):raise ValueError(f'{name}: invalid model identifier.')
        if value:result[name]=value
    return result

def read_json(path):
    try:
        if path.stat().st_size>8_000_000:return {}
        value=json.loads(path.read_text(encoding='utf-8'))
        return value if isinstance(value,dict) else {}
    except (OSError,ValueError):return {}

def native(name):
    home=Path.home()
    if name=='claude':
        value=os.environ.get('ANTHROPIC_MODEL') or read_json(Path(os.environ.get('CLAUDE_CONFIG_DIR',home/'.claude'))/'settings.json').get('model')
    elif name=='cursor':
        value=read_json(home/'.cursor/cli-config.json').get('model')
        if isinstance(value,dict):value=value.get('displayModelId') or value.get('modelId')
    else:
        try:value=tomllib.loads((Path(os.environ.get('CODEX_HOME',home/'.codex'))/'config.toml').read_text(encoding='utf-8')).get('model')
        except (OSError,ValueError):value=None
    return model_id(value)

def observed(name,folder):
    # Parse only native CLI envelopes, never model-authored reply JSON.
    data=read_json(folder/'stdout.log')
    if name=='claude':return list(dict.fromkeys(m for m in data.get('modelUsage',{}) if model_id(m))) if isinstance(data.get('modelUsage'),dict) else []
    if name=='cursor':return [data['model']] if model_id(data.get('model')) else []
    # Codex JSONL is not guaranteed to expose the actual served model.
    return []

def cursor_models(text):
    options=[]
    text=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',text)
    for line in text.splitlines():
        slug,sep,label=line.strip().partition(' - ')
        if sep and model_id(slug):options.append({'id':slug,'label':label[:180]})
    return options[:400]

def catalog(root,name):
    if name=='claude':return {'source':'CLI 별칭 · 계정별 사용 가능 여부는 실행 시 확인','options':[{'id':m,'label':m} for m in ('opus','sonnet','haiku')]}
    if name=='codex':
        cached=read_json(storage_path(root,'model-catalog.json')).get('codex',{})
        if cached.get('options'):return {**cached,'source':'Codex CLI 조회 목록·기본 모델'}
        data=read_json(Path(os.environ.get('CODEX_HOME',Path.home()/'.codex'))/'models_cache.json')
        return {'source':'Codex 로컬 목록 캐시 · 최신 계정 권한을 보장하지 않음','options':[{'id':m['slug'],'label':str(m.get('display_name') or m['slug'])[:180]} for m in data.get('models',[]) if isinstance(m,dict) and model_id(m.get('slug')) and m.get('visibility','list')!='hide']}
    data=read_json(storage_path(root,'model-catalog.json')).get('cursor',{})
    return {'source':'Cursor CLI 조회 목록' if data.get('options') else '목록 새로고침으로 Cursor 계정 모델 조회','options':data.get('options',[]),'updated':data.get('updated')}

def load_cursor(cfg):
    from .adapters import discover
    if 'cursor' not in cfg.get('agents',[]):return
    cmd=[cfg['executables']['cursor']] if cfg.get('executables',{}).get('cursor') else discover('cursor')
    if not cmd:raise ValueError('Cursor CLI not found.')
    kwargs={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}
    try:r=subprocess.run(cmd+['--list-models'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60,**kwargs)
    except (OSError,subprocess.TimeoutExpired):raise ValueError('Cursor model list unavailable. Check native login or retry.') from None
    options=cursor_models(r.stdout)
    if r.returncode or not options:raise ValueError('Cursor model list unavailable. Existing model choices were preserved.')
    return {'options':options,'updated':time.time()}

def load_codex(root,cfg):
    from .adapters import discover
    cmd=[cfg['executables']['codex']] if cfg.get('executables',{}).get('codex') else discover('codex')
    if not cmd:raise ValueError('Codex CLI not found.')
    kwargs={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}
    proc=subprocess.Popen(cmd+['app-server','--stdio'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',**kwargs)
    inbox=queue.Queue()
    def reader():
        for line in proc.stdout:
            try:inbox.put(json.loads(line))
            except ValueError:pass
    thread=threading.Thread(target=reader,daemon=True);thread.start()
    deadline=time.monotonic()+35
    def rpc(i,method,params):
        proc.stdin.write(json.dumps({'id':i,'method':method,'params':params})+'\n');proc.stdin.flush()
        while True:
            value=inbox.get(timeout=max(.01,deadline-time.monotonic()))
            if value.get('id')==i:
                if 'error' in value:raise ValueError('Codex model metadata unavailable.')
                return value.get('result',{})
    try:
        rpc(1,'initialize',{'clientInfo':{'name':'agent-hub','version':'0.1.0'}})
        proc.stdin.write(json.dumps({'method':'initialized','params':{}})+'\n');proc.stdin.flush()
        config=rpc(2,'config/read',{'includeLayers':False}).get('config',{})
        data=rpc(3,'model/list',{}).get('data',[])
        options=[{'id':m['model'],'label':str(m.get('displayName') or m['model'])[:180]} for m in data if model_id(m.get('model'))]
        if not options:raise ValueError('Codex returned no model choices.')
        default=model_id(config.get('model')) or next((model_id(m.get('model')) for m in data if m.get('isDefault')),'')
        return {'options':options,'default':default,'updated':time.time()}
    except (queue.Empty,OSError):raise ValueError('Codex model metadata unavailable. Check native CLI login.') from None
    finally:
        if proc.poll() is None:proc.terminate()
        try:proc.wait(timeout=3)
        except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=3)
        thread.join(timeout=1)
        proc.stdin.close();proc.stdout.close()

def refresh_catalog(root,cfg):
    cached=read_json(storage_path(root,'model-catalog.json'));warnings=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        calls={}
        if 'cursor' in cfg.get('agents',[]):calls['cursor']=pool.submit(load_cursor,cfg)
        if 'codex' in cfg.get('agents',[]):calls['codex']=pool.submit(load_codex,root,cfg)
        for name,future in calls.items():
            try:cached[name]=future.result()
            except Exception:warnings.append(name.upper()+': 목록 조회 실패 · 기존 목록 유지')
    atomic_json(storage_path(root,'model-catalog.json'),cached)
    return warnings

def info(root,cfg,tasks):
    result={}
    for name in cfg.get('agents',[]):
        selected=cfg.get('models',{}).get(name,'');choices=catalog(root,name);hint=native(name) or choices.get('default','');recent=None;running=None
        own=[t for t in tasks if t['agent']==name and t.get('started')]
        own.sort(key=lambda t:t.get('started') or 0,reverse=True)
        for task in own[:20]:
            folder=storage_path(root,'runs')/task['id'];record=read_json(folder/'model-info.json')
            actual=observed(name,folder)
            entry={'requested':model_id(record.get('requested')),'native_hint':model_id(record.get('native_hint')),'actual':actual,'started':task['started'],'task':task['id']}
            if task['status']=='running' and running is None:running=entry
            if actual and recent is None:recent=entry
            if running and recent:break
        result[name]={'selected':selected,'native_hint':hint,'recent':recent,'running':running,**choices}
    return result
