"""Start the pinned official Coral server for an explicitly configured data root."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from .config import atomic_json,Config
from .coral import Peer

JAR_SHA256='1e83a383f35b55367a3f337f39ae66c2a6f09c24a58503fe97281beeb4e1863d'

def ensure(root):
    root=Path(root).resolve();settings=root/'config'/'coral.json'
    if not settings.exists():return
    cfg=json.loads(settings.read_text(encoding='utf-8'));coral=root/'coral';config=Config(root)
    if not config.value or config.value.get('mode')!='coral':return
    expected=(coral/'session'/'coral-urls.txt').resolve()
    if Path(config.value.get('url_file','')).resolve()!=expected:return
    port=cfg['port'];key=(coral/'config'/'admin-key.txt').read_text().strip()
    def api(path,body=None):
        request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
        with urllib.request.urlopen(request,timeout=8) as response:return json.load(response)
    server=None
    try:
        api('/api/v1/local/namespace')
    except Exception:
        with socket.socket() as sock:
            try:sock.bind(('127.0.0.1',port))
            except OSError:raise RuntimeError('Coral 포트를 다른 서버가 사용 중입니다. config/coral.json을 확인하세요.') from None
        jar=coral/'runtime'/'coral-server-1.4.0.jar'
        if hashlib.sha256(jar.read_bytes()).hexdigest()!=JAR_SHA256:raise RuntimeError('공식 Coral JAR 검증에 실패했습니다.')
        java=Path(cfg['java'])
        if not java.is_file():raise RuntimeError('설정된 Java 실행 파일을 찾을 수 없습니다.')
        for folder in ('logs','home','runtime','session','config'):(coral/folder).mkdir(parents=True,exist_ok=True)
        args=[str(java),'-Duser.home='+str(coral/'home'),'-Dfile.encoding=UTF-8','-jar',str(jar),'--auth.keys='+key,'--network.bind_port='+str(port),'--network.bind_address=127.0.0.1','--network.allow_any_host=true','--registry.include_coral_home_agents=false','--registry.local_agents='+str(coral/'runtime'/'endpoint-agent'),'--logging.log_files_directory='+str(coral/'logs')]
        flags={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {'start_new_session':True}
        with (coral/'logs'/'console.log').open('ab') as log:server=subprocess.Popen(args,cwd=coral,stdout=log,stderr=subprocess.STDOUT,**flags)
        atomic_json(coral/'session'/'server.json',{'pid':server.pid,'port':port,'jar':str(jar)})
        for _ in range(60):
            if server.poll() is not None:raise RuntimeError('Coral 시작 실패: coral/logs/console.log를 확인하세요.')
            try:api('/api/v1/local/namespace');break
            except Exception:time.sleep(1)
        else:
            server.terminate();raise RuntimeError('Coral 서버 시작 시간이 초과되었습니다.')
    try:
        Peer(config.endpoints()[config.value['observer']]).threads()
        return
    except Exception:pass
    names=[config.value['observer'],*config.value['agents']]
    endpoint_dir=coral/'session'/uuid.uuid4().hex;endpoint_dir.mkdir(parents=True)
    # One private capture directory for each session avoids reusing stale URLs.
    agent=coral/'runtime'/'endpoint-agent';agent.mkdir(parents=True,exist_ok=True)
    capture=agent/'capture.py'
    capture.write_text("import os,time\nfrom pathlib import Path\np=Path("+repr(str(endpoint_dir))+")\nn=os.environ['CORAL_AGENT_ID']\n(p/(n+'.url')).write_text(os.environ['CORAL_CONNECTION_URL'])\n(p/(n+'.pid')).write_text(str(os.getpid()))\nwhile True:time.sleep(3600)\n",encoding='utf-8')
    body={'agentGraphRequest':{'agents':[{'id':{'name':'hub-endpoint','version':'0.1.0','registrySourceId':{'type':'local'}},'name':n,'provider':{'type':'local','runtime':'executable'},'options':{},'blocking':False} for n in names],'groups':[names]},'namespaceProvider':{'type':'create_if_not_exists','namespaceRequest':{'name':'agent-hub','deleteOnLastSessionExit':False}},'execution':{'mode':'immediate','runtimeSettings':{'extendedEndReport':True}}}
    try:
        receipt=api('/api/v1/local/session',body)
        atomic_json(coral/'session'/'session.json',receipt)
        for _ in range(45):
            if all((endpoint_dir/(n+'.url')).exists() for n in names):break
            time.sleep(1)
        else:raise RuntimeError('Coral 신원 생성 실패: coral/logs를 확인하세요.')
        lines=[]
        for name in names:
            url=(endpoint_dir/(name+'.url')).read_text().strip();Peer(url).call('tools/list',{});lines.append(name+'|'+url)
        temporary=expected.with_suffix('.new');temporary.write_text('\n'.join(lines)+'\n',encoding='utf-8');os.replace(temporary,expected)
    except Exception as exc:
        if server:server.terminate()
        raise RuntimeError('공식 Coral 연결 준비에 실패했습니다. coral/logs를 확인하세요.') from None
