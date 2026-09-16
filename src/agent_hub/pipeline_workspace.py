"""Host-owned isolated Git copies, exact-tree checks, commands and artifacts."""
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import time
import zipfile


def git(folder,*args,timeout=30):
    cmd=['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','-C',str(folder),*args]
    p=subprocess.run(cmd,capture_output=True,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if p.returncode:raise ValueError('Git 작업 실패: 저장소 상태와 Git 설치를 확인해 주세요.')
    return p.stdout


def source_info(value):
    if not isinstance(value,str) or not value.strip():raise ValueError('대상 Git 저장소를 지정해 주세요.')
    source=Path(value).expanduser().resolve()
    if not source.is_dir():raise ValueError('대상 폴더를 찾을 수 없습니다.')
    source=Path(git(source,'rev-parse','--show-toplevel').decode().strip()).resolve()
    if git(source,'status','--porcelain','--untracked-files=normal').strip():raise ValueError('미커밋 변경이 있습니다. 커밋한 뒤 시작하세요. 이 기능은 원본 파일을 수정하거나 자동 커밋하지 않습니다.')
    base=git(source,'rev-parse','HEAD').decode().strip()
    for entry in git(source,'ls-tree','-r',base).splitlines():
        if entry.startswith((b'120000 ',b'160000 ')):raise ValueError('첫 버전에서는 심볼릭 링크·서브모듈이 없는 저장소만 지원합니다.')
    common=git(source,'rev-parse','--git-common-dir').decode().strip()
    project=os.path.normcase(str((source/common).resolve()))
    return str(source),project,base


def command_line(value):
    if not isinstance(value,str) or not 1<=len(value.strip())<=2000:raise ValueError('실제로 실행할 검증 명령을 입력해 주세요.')
    try:parts=shlex.split(value,posix=os.name!='nt')
    except ValueError:raise ValueError('검증 명령의 따옴표를 확인해 주세요.') from None
    if os.name=='nt':parts=[p[1:-1] if len(p)>1 and p[0]==p[-1] and p[0] in ('"',"'") else p for p in parts]
    if not parts or any(p in ('&&','||',';','|','>','<') for p in parts):raise ValueError('명령 한 개만 입력하세요. 셸 연결·리다이렉션은 지원하지 않습니다.')
    executable=shutil.which(parts[0])
    if not executable:raise ValueError('검증 명령의 실행 파일을 찾을 수 없습니다.')
    if os.name=='nt' and Path(executable).suffix.lower() not in ('.exe','.com'):
        # Resolve npm's native node entry point without cmd.exe interpolation.
        script=Path(executable).parent/'node_modules/npm/bin/npm-cli.js'
        if Path(executable).stem.lower()=='npm' and script.is_file() and shutil.which('node'):parts=[shutil.which('node'),str(script),*parts[1:]]
        else:raise ValueError('Windows에서는 실행 파일(.exe)을 사용하세요. 배치·PowerShell 명령은 직접 실행하지 않습니다.')
    else:parts[0]=executable
    return parts


def prepare(source,base,target):
    target=Path(target)
    if target.exists():raise ValueError('작업 공간이 이미 존재합니다. 자동으로 덮어쓰지 않습니다.')
    target.parent.mkdir(parents=True,exist_ok=True)
    # --no-local prevents hard-linked objects; there is no shared Git metadata.
    p=subprocess.run(['git','clone','--no-local','--no-hardlinks','--no-checkout','--',source,str(target)],capture_output=True,timeout=120,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if p.returncode:raise ValueError('분리된 작업 공간 생성에 실패했습니다.')
    git(target,'config','core.hooksPath','/dev/null')
    git(target,'config','core.fsmonitor','false')
    git(target,'remote','remove','origin')
    git(target,'checkout','--detach',base)
    if source_info(source)[2]!=base:raise ValueError('준비 중 원본 기준 커밋이 바뀌었습니다. 새 작업으로 다시 시작하세요.')
    return fingerprint(target,base)


def files(folder):
    root=Path(folder).resolve();names=git(root,'ls-files','--cached','--others','--exclude-standard','-z').decode('utf-8').split('\0')
    found=[]
    for name in sorted(set(n for n in names if n)):
        p=root/name
        if p.is_symlink() or not p.resolve().is_relative_to(root):raise ValueError('작업 공간 밖을 가리키는 파일은 결과물로 사용할 수 없습니다.')
        if p.exists() and not p.is_file():raise ValueError('일반 파일만 결과물로 지원합니다.')
        found.append((name,p))
    if len(found)>20000:raise ValueError('작업 파일 수 한도를 초과했습니다.')
    return found


def fingerprint(folder,base):
    if git(folder,'rev-parse','HEAD').decode().strip()!=base:raise ValueError('기준 커밋이 변경되었습니다. 작업 에이전트는 커밋·체크아웃할 수 없습니다.')
    h=hashlib.sha256();total=0
    for name,p in files(folder):
        h.update(name.encode());h.update(b'\0')
        if not p.exists():h.update(b'DELETED');continue
        size=p.stat().st_size;total+=size
        if size>32*1024*1024 or total>256*1024*1024:raise ValueError('첫 버전의 작업 파일 크기 한도를 초과했습니다.')
        h.update(str(p.stat().st_mode).encode())
        with p.open('rb') as f:
            while chunk:=f.read(65536):h.update(chunk)
    return h.hexdigest()


def run_check(argv,workspace,folder,cancel):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True);log=folder/'validation.log'
    flags={'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {'start_new_session':True}
    started=time.time();env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1','PYTHONUTF8':'1'}
    with log.open('wb') as out:
        p=subprocess.Popen(argv,cwd=workspace,stdin=subprocess.DEVNULL,stdout=out,stderr=subprocess.STDOUT,env=env,**flags)
        while p.poll() is None:
            if cancel.wait(.2) or time.time()-started>300:
                if os.name=='nt':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True,**flags)
                else:os.killpg(p.pid,signal.SIGTERM)
                try:p.wait(timeout=5)
                except subprocess.TimeoutExpired:p.kill();p.wait()
                raise RuntimeError('검증 취소 또는 5분 제한 초과')
    with log.open('rb') as f:
        f.seek(max(0,log.stat().st_size-10000));excerpt=f.read().decode('utf-8',errors='replace')
    return {'exit_code':p.returncode,'seconds':round(time.time()-started,2),'log':str(log),'output':excerpt,'argv':argv}


def export(folder,base,dest,report):
    dest=Path(dest);dest.mkdir(parents=True,exist_ok=True)
    before=fingerprint(folder,base)
    # Only the isolated copy's index is touched; original project stays unchanged.
    git(folder,'add','--intent-to-add','--all')
    patch=git(folder,'diff','--no-ext-diff','--no-textconv','--binary',base)
    names=git(folder,'diff','--name-only','-z',base).decode('utf-8').split('\0');names=[n for n in names if n]
    (dest/'changes.patch').write_bytes(patch)
    (dest/'report.md').write_text(report,encoding='utf-8')
    (dest/'manifest.json').write_text(json.dumps({'base':base,'fingerprint':before,'files':names},ensure_ascii=False,indent=2),encoding='utf-8')
    with zipfile.ZipFile(dest/'changed-files.zip','w',zipfile.ZIP_DEFLATED) as z:
        for name in names:
            p=Path(folder)/name
            if p.is_file() and not p.is_symlink() and p.resolve().is_relative_to(Path(folder).resolve()):z.write(p,name)
        z.write(dest/'manifest.json','AGENT-HUB-manifest.json')
    if fingerprint(folder,base)!=before:raise ValueError('결과물 생성 중 파일이 바뀌었습니다.')
    return {'files':names,'fingerprint':before,'artifacts':['changes.patch','changed-files.zip','report.md','manifest.json']}
