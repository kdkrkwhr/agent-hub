"""Per-user configuration. No credentials are returned to the UI or logged."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

PROVIDERS = ('claude', 'codex', 'cursor')

def data_directory():
    if os.environ.get('AGENT_HUB_HOME'):
        return Path(os.environ['AGENT_HUB_HOME']).expanduser().resolve()
    if sys.platform == 'win32':
        return Path(os.environ.get('LOCALAPPDATA', str(Path.home()/'AppData/Local')))/'AgentHub'
    if sys.platform == 'darwin':
        return Path.home()/'Library/Application Support/AgentHub'
    return Path(os.environ.get('XDG_STATE_HOME', str(Path.home()/'.local/state')))/'agent-hub'

def atomic_json(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(dir=path.parent,prefix='.save-')
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            json.dump(value,f,ensure_ascii=False,indent=2)
            f.flush();os.fsync(f.fileno())
        os.replace(name,path)
        if os.name!='nt':path.chmod(0o600)
    finally:
        if os.path.exists(name):os.unlink(name)

def valid_url(value):
    if not isinstance(value,str) or len(value)>8192:
        raise ValueError('Coral endpoint must be a URL.')
    try:u=urlsplit(value)
    except ValueError:raise ValueError('Invalid Coral endpoint.') from None
    if u.username or u.password or not u.hostname or u.fragment:
        raise ValueError('Invalid Coral endpoint.')
    if u.scheme!='https' and not (u.scheme=='http' and u.hostname in ('localhost','127.0.0.1','::1')):
        raise ValueError('Use HTTPS, or HTTP on localhost only.')
    return value

class Config:
    def __init__(self,root):
        self.root=Path(root);self.path=self.root/'config.json'
        self.value=json.loads(self.path.read_text(encoding='utf-8')) if self.path.exists() else None

    def prepare(self,body):
        old=self.value or {}
        if not isinstance(body,dict):raise ValueError('Expected an object.')
        if any(not isinstance(body.get(k,''),str) for k in ('observer','url_file','workspace')):
            raise ValueError('Expected text settings.')
        if not isinstance(body.get('executables',{}),dict):raise ValueError('Invalid executable settings.')
        mode=body.get('mode','demo')
        if mode not in ('demo','coral'):raise ValueError('Unknown connection mode.')
        names=body.get('agents',[])
        if not isinstance(names,list) or not names or any(n not in PROVIDERS for n in names):
            raise ValueError('Select at least one supported agent.')
        observer=body.get('observer','ops').strip()
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}',observer):raise ValueError('Invalid observer identity.')
        if mode=='coral' and observer in names:
            raise ValueError('The hub observer must differ from automated agents (for example hub or ops).')
        raw_file=body.get('url_file','').strip()
        url_file=str(Path(raw_file).expanduser().resolve()) if raw_file else ''
        endpoints={}
        provided=body.get('endpoints',{})
        if not isinstance(provided,dict):raise ValueError('Invalid endpoint settings.')
        for name in [observer,*names]:
            value=provided.get(name) or old.get('endpoints',{}).get(name)
            if value:endpoints[name]=valid_url(value)
        commands={}
        for name,value in body.get('executables',{}).items():
            if name not in names or not value:continue
            p=Path(value).expanduser().resolve()
            if not p.is_file():raise ValueError(f'{name}: executable not found.')
            if p.suffix.lower() in ('.cmd','.bat','.ps1','.sh'):
                raise ValueError('Choose the native executable, not a shell wrapper.')
            commands[name]=str(p)
        workspace=body.get('workspace','').strip()
        if workspace:
            p=Path(workspace).expanduser().resolve()
            if not p.is_dir():raise ValueError('The read-only workspace does not exist.')
            workspace=str(p)
        automatic=body.get('automatic',False)
        if not isinstance(automatic,bool):raise ValueError('Invalid automatic mode.')
        from .models import validate
        models=validate(body.get('models',old.get('models',{})))
        zero_turn=body.get('zero_turn_agents',old.get('zero_turn_agents',[]))
        if not isinstance(zero_turn,list) or any(n not in ('claude','codex') for n in zero_turn):
            raise ValueError('Tool-boundary delivery currently supports Claude and Codex.')
        config={'zero_turn_agents':[n for n in dict.fromkeys(zero_turn) if n in names],'models':models,'mode':mode,'agents':list(dict.fromkeys(names)), 'observer':observer,
                'url_file':url_file,'endpoints':endpoints,'executables':commands,
                'workspace':workspace,'automatic':automatic if mode=='coral' else False}
        if mode=='coral':
            resolved=self.endpoints(config)
            missing=[n for n in [observer,*names] if n not in resolved]
            if missing:raise ValueError('Missing Coral endpoint: '+', '.join(missing))
        return config

    def save(self,body):
        value=self.prepare(body);atomic_json(self.path,value);self.value=value
        return self.public()

    def endpoints(self,value=None):
        value=value or self.value or {}
        result=dict(value.get('endpoints',{}))
        if value.get('url_file'):
            try:lines=Path(value['url_file']).read_text(encoding='utf-8-sig').splitlines()
            except OSError:raise ValueError('Cannot read Coral URL file.') from None
            for line in lines:
                if '|' in line:
                    name,url=line.split('|',1)
                    result[name.strip()]=valid_url(url.strip())
        return result

    def public(self):
        if self.value is None:return None
        return {**{k:v for k,v in self.value.items() if k!='endpoints'},
                'endpoint_configured':list(self.value.get('endpoints',{}))}
