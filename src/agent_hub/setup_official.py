"""Explicit, offline migration and installation of the verified official Coral JAR."""
import argparse
import hashlib
import json
from pathlib import Path
import secrets
import shutil
import sqlite3
import sys
from .config import Config,atomic_json
from .storage import initialize,path
from .managed_coral import JAR_SHA256

def scope(cfg):return hashlib.sha256(json.dumps({k:cfg.get(k) for k in ('mode','agents','observer','url_file','endpoints')},sort_keys=True).encode()).hexdigest()

def copy_verified(source,target):
    source=Path(source);target=Path(target)
    if source.is_symlink() or (hasattr(source,'is_junction') and source.is_junction()):raise ValueError('링크된 데이터 폴더는 수동 검토가 필요합니다.')
    if source.is_dir():
        target.mkdir(parents=True,exist_ok=True)
        for item in source.iterdir():copy_verified(item,target/item.name)
    else:
        target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
        with source.open('rb') as a,target.open('rb') as b:
            if hashlib.file_digest(a,'sha256').digest()!=hashlib.file_digest(b,'sha256').digest():raise RuntimeError('복사 검증 실패')

def install(root,jar,java,port=5568):
    root=Path(root).resolve();jar=Path(jar).resolve();java=Path(java).resolve()
    if hashlib.sha256(jar.read_bytes()).hexdigest()!=JAR_SHA256:raise ValueError('검증된 공식 v1.4.0 JAR이 아닙니다.')
    if not java.is_file():raise ValueError('Java 실행 파일이 없습니다.')
    if not 1024<=port<=32767:raise ValueError('Coral 포트는 1024~32767 범위를 사용하세요.')
    if not (root/'storage.json').exists():initialize(root)
    coral=root/'coral'
    for name in ('config','runtime/endpoint-agent','session','logs','home'):(coral/name).mkdir(parents=True,exist_ok=True)
    copy_verified(jar,coral/'runtime'/'coral-server-1.4.0.jar')
    key=coral/'config'/'admin-key.txt'
    if not key.exists():key.write_text(secrets.token_urlsafe(32),encoding='utf-8')
    agent=coral/'runtime'/'endpoint-agent'
    (agent/'coral-agent.toml').write_text('edition = 3\n[agent]\nname = "hub-endpoint"\nversion = "0.1.0"\ndescription = "Local AGENT HUB endpoint"\nreadme = "Endpoint holder; no model execution"\nsummary = "Hub endpoint"\n[agent.license]\ntype = "spdx"\nexpression = "MIT"\n[runtimes.executable]\npath = '+json.dumps(sys.executable.replace('\\','/'))+'\narguments = ["capture.py"]\ntransport = "streamable_http"\n',encoding='utf-8')
    if not (agent/'capture.py').exists():(agent/'capture.py').write_text('raise SystemExit("Session not configured")\n')
    atomic_json(root/'config'/'coral.json',{'version':'1.4.0','java':str(java),'port':port,'sha256':JAR_SHA256,'source':'https://github.com/Coral-Protocol/coral-server/releases/tag/v1.4.0'})
    config=Config(root);old=config.value or config.prepare({'mode':'demo','agents':['codex']})
    new={**old,'mode':'coral','url_file':str(coral/'session'/'coral-urls.txt'),'endpoints':{}}
    if not config.value:new['automatic']=False
    database=path(root,'queue.sqlite3')
    if database.exists():
        db=sqlite3.connect(database)
        with db:
            tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            for table in tables:
                if 'scope' in [row[1] for row in db.execute('PRAGMA table_info("'+table+'")')]:
                    db.execute('UPDATE "'+table+'" SET scope=? WHERE scope=?',(scope(new),scope(old)))
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';db.close()
    atomic_json(path(root,'config.json'),new)

def migrate(source,target):
    from .__main__ import InstanceLock
    source=Path(source).resolve();target=Path(target).resolve()
    if source==target or source in target.parents or target in source.parents:raise ValueError('이전 폴더와 대상 폴더는 분리되어야 합니다.')
    if target.exists() and any(target.iterdir()):raise ValueError('대상 폴더는 비어 있어야 합니다.')
    with InstanceLock(source/'instance.lock'):
        initialize(target)
        for item in ('config.json','codex-boundary-trust.json','model-catalog.json','runs','workspaces','artifacts','window-profile'):
            original=path(source,item)
            if original.exists():copy_verified(original,path(target,item))
        src=sqlite3.connect(path(source,'queue.sqlite3'));dst=sqlite3.connect(path(target,'queue.sqlite3'))
        src.backup(dst);src.close()
        assert dst.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        backup=target/'backups'/'before-official.sqlite3';b=sqlite3.connect(backup);dst.backup(b);b.close()
        counts={row[0]:dst.execute('SELECT COUNT(*) FROM "'+row[0]+'"').fetchone()[0] for row in dst.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        replacements=[(str(source/'runs'),str(path(target,'runs'))),(str(source),str(target))]
        def relocate(value):
            if isinstance(value,str):
                for old,new in replacements:value=value.replace(old,new).replace(old.replace('\\','/'),new.replace('\\','/'))
                return value
            if isinstance(value,dict):return {k:relocate(v) for k,v in value.items()}
            if isinstance(value,list):return [relocate(v) for v in value]
            return value
        # Rewrite structured workspace/result references, never historical message text.
        with dst:
            for table,columns in {'pipelines':['workspace','artifacts'],'pipeline_tasks':['input','result'],'pipeline_publications':['data']}.items():
                if table not in counts:continue
                for column in columns:
                    for rowid,value in dst.execute('SELECT rowid,"'+column+'" FROM "'+table+'" WHERE "'+column+'" IS NOT NULL').fetchall():
                        if column=='workspace':updated=relocate(value)
                        else:
                            try:updated=json.dumps(relocate(json.loads(value)),ensure_ascii=False)
                            except (ValueError,TypeError):continue
                        if updated!=value:dst.execute('UPDATE "'+table+'" SET "'+column+'"=? WHERE rowid=?',(updated,rowid))
        dst.close()
        atomic_json(target/'config'/'migration.json',{'source':str(source),'counts':counts,'legacy_url_file':Config(source).value.get('url_file',''),'ui_storage_key':'agent-hub-read:'+json.dumps([str(source),Config(source).value.get('mode'),Config(source).value.get('observer'),Config(source).value.get('url_file'),Config(source).value.get('agents')],ensure_ascii=False,separators=(',',':'))})
    return counts

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path);p.add_argument('--data-dir',type=Path,required=True);p.add_argument('--jar',type=Path,required=True);p.add_argument('--java',type=Path,required=True);p.add_argument('--port',type=int,default=5568);a=p.parse_args()
    if a.source:migrate(a.source,a.data_dir)
    install(a.data_dir,a.jar,a.java,a.port)
    print('Official Coral configuration ready:',a.data_dir)
if __name__=='__main__':main()
