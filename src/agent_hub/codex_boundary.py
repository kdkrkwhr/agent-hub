"""Explicit registration of one reviewed Codex hook, without trust bypass flags."""
from .storage import path as storage_path
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import shlex
import subprocess
import sys
import threading
import time
from .config import atomic_json


def definition():
    script=Path(__file__).with_name('boundary.py').resolve()
    argv=[Path(sys.executable).as_posix(),script.as_posix(),'--codex']
    command=subprocess.list2cmdline(argv) if os.name=='nt' else shlex.join(argv)
    setting='hooks.PostToolUse=[{matcher="^Bash$",hooks=[{type="command",command='+json.dumps(command)+',timeout=5}]}]'
    fingerprint=hashlib.sha256(script.read_bytes()+setting.encode()).hexdigest()
    return command,setting,fingerprint


def prepare(root):
    _,setting,fingerprint=definition()
    try:record=json.loads((storage_path(Path(root),'codex-boundary-trust.json')).read_text(encoding='utf-8'))
    except (OSError,ValueError):return []
    native_home=str(Path(os.environ.get('CODEX_HOME',Path.home()/'.codex')).resolve())
    if record.get('fingerprint')!=fingerprint or record.get('native_home')!=native_home:return []
    return ['-c',setting]


def register(root,config):
    from .adapters import discover
    root=Path(root);root.mkdir(parents=True,exist_ok=True)
    command,setting,fingerprint=definition()
    cmd=[config['executables']['codex']] if config.get('executables',{}).get('codex') else discover('codex')
    kwargs={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}
    proc=subprocess.Popen(cmd+['-c',setting,'app-server','--stdio'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',**kwargs)
    inbox=queue.Queue()
    def read():
        for line in proc.stdout:
            try:inbox.put(json.loads(line))
            except ValueError:pass
    thread=threading.Thread(target=read,daemon=True);thread.start()
    deadline=time.monotonic()+30
    def rpc(n,method,params):
        proc.stdin.write(json.dumps({'id':n,'method':method,'params':params})+'\n');proc.stdin.flush()
        while True:
            result=inbox.get(timeout=max(.01,deadline-time.monotonic()))
            if result.get('id')==n:
                if 'error' in result:raise RuntimeError('Codex hook registration failed: '+str(result['error'].get('message')))
                return result.get('result',{})
    try:
        rpc(1,'initialize',{'clientInfo':{'name':'agent-hub','version':'0.3.0'},'capabilities':{'experimentalApi':True}})
        proc.stdin.write('{"method":"initialized","params":{}}\n');proc.stdin.flush()
        data=rpc(2,'hooks/list',{'cwds':[str(root)]})
        matches=[h for entry in data.get('data',[]) for h in entry.get('hooks',[]) if h.get('source')=='sessionFlags' and h.get('eventName')=='postToolUse' and h.get('command')==command and h.get('matcher')=='^Bash$' and h.get('timeoutSec')==5 and not h.get('async')]
        if len(matches)!=1:raise RuntimeError('Expected exactly one HUB PostToolUse hook')
        hook=matches[0]
        # This explicit setup command trusts only the reviewed native definition/hash.
        rpc(3,'config/value/write',{'keyPath':'hooks.state.'+json.dumps(hook['key'])+'.trusted_hash','value':hook['currentHash'],'mergeStrategy':'replace'})
        atomic_json(storage_path(root,'codex-boundary-trust.json'),{'fingerprint':fingerprint,'key':hook['key'],'hash':hook['currentHash'],'native_home':str(Path(os.environ.get('CODEX_HOME',Path.home()/'.codex')).resolve())})
        return {'registered':True,'command':command,'hash':hook['currentHash']}
    finally:
        if proc.poll() is None:proc.terminate()
        try:proc.wait(timeout=3)
        except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=3)
        thread.join(timeout=1);proc.stdin.close();proc.stdout.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description='Register the reviewed HUB PostToolUse hook in native Codex trust settings.')
    parser.add_argument('--data-dir',type=Path,required=True)
    args=parser.parse_args()
    try:cfg=json.loads(storage_path(args.data_dir,'config.json').read_text(encoding='utf-8'))
    except FileNotFoundError:cfg={}
    print(json.dumps(register(args.data_dir,cfg)))
