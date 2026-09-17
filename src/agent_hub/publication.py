"""Explicit user publication of frozen pipeline artifacts. No model-driven Git writes."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from . import pipeline_workspace as ws


def git(root,*args,env=None):
    e={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never'}
    if env:e.update(env)
    hook_args=[] if args and args[0] in ('commit','push') else ['-c','core.hooksPath=/dev/null']
    p=subprocess.run(['git',*hook_args,'-c','core.fsmonitor=false','-C',str(root),*args],capture_output=True,timeout=45,env=e,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if p.returncode:raise ValueError('Git 작업 실패: 충돌, Git 사용자 설정 또는 원격 인증·권한을 확인하세요. 자동 되돌리기는 하지 않습니다.')
    return p.stdout


def tree_for_patch(workspace,base,patch):
    with tempfile.TemporaryDirectory(prefix='hub-publish-index-') as folder:
        env={'GIT_INDEX_FILE':str(Path(folder)/'index')}
        git(workspace,'read-tree',base,env=env)
        git(workspace,'apply','--cached','--whitespace=nowarn','--',str(patch),env=env)
        return git(workspace,'write-tree',env=env).decode().strip()


class Publication:
    def __init__(self,pipeline):
        self.pipeline=pipeline;self.hub=pipeline.hub;self.db=pipeline.db
        self.db.execute('CREATE TABLE IF NOT EXISTS pipeline_publications (pipeline_id TEXT PRIMARY KEY, data TEXT)')

    def load(self,pid):
        row=self.db.execute('SELECT data FROM pipeline_publications WHERE pipeline_id=?',(pid,)).fetchone()
        return json.loads(row[0]) if row else None

    def save(self,pid,data):
        self.db.execute('INSERT OR REPLACE INTO pipeline_publications VALUES (?,?)',(pid,json.dumps(data,ensure_ascii=False)));self.db.commit()

    def context(self,pid):
        if not isinstance(pid,str):raise ValueError('작업 ID를 확인하세요.')
        p=self.pipeline.get(pid)
        if not p or p['scope']!=self.hub.scope(self.hub.config.value or {}) or p['status']!='completed' or not p['artifacts']:raise ValueError('결과물이 있는 완료 작업만 원본에 반영할 수 있습니다.')
        if self.db.execute("SELECT 1 FROM pipelines WHERE project=? AND status='active'",(p['project'],)).fetchone() or any(a['job'].get('pipeline_id') and (q:=self.pipeline.get(a['job']['pipeline_id'])) and q['project']==p['project'] for a in self.hub.active.values()):raise ValueError('같은 프로젝트의 실행이 끝난 후 반영하세요.')
        patch=(self.hub.root/'artifacts'/pid/'changes.patch').resolve()
        if not patch.is_file() or patch.stat().st_size>16*1024*1024:raise ValueError('패치가 없거나 16MB 제한을 초과했습니다.')
        data=patch.read_bytes()
        if not data:raise ValueError('반영할 변경이 없습니다.')
        source=Path(p['source']).resolve()
        if not source.is_dir() or Path(git(source,'rev-parse','--show-toplevel').decode().strip()).resolve()!=source:raise ValueError('원본 저장소 경로가 변경되었습니다.')
        if os.path.normcase(str((source/git(source,'rev-parse','--git-common-dir').decode().strip()).resolve()))!=p['project']:raise ValueError('원본 Git 저장소 식별자가 변경되었습니다.')
        branch=git(source,'symbolic-ref','--quiet','--short','HEAD').decode().strip()
        git(source,'check-ref-format','refs/heads/'+branch)
        remote=''
        try:
            urls=git(source,'remote','get-url','--push','--all','origin').decode().splitlines()
            if len(urls)==1:remote=urls[0]
        except ValueError:pass
        # Never expose credentials embedded in a remote URL to the UI.
        if '://' in remote and '@' in remote.split('://',1)[1].split('/',1)[0]:raise ValueError('원격 URL에 인증 정보가 포함되어 있습니다. 자격 증명 관리자를 사용한 원격 주소로 설정하세요.')
        return p,source,patch,data,branch,remote

    def validate_state(self,p,source,record):
        head=git(source,'rev-parse','HEAD').decode().strip()
        stage=record['stage']
        if stage=='ready':
            if head!=p['base']:raise ValueError('작업 시작 후 원본 커밋이 변경되었습니다. 자동 병합하지 않습니다.')
            if git(source,'status','--porcelain','--untracked-files=all').strip():raise ValueError('원본에 기존 변경 또는 미추적 파일이 있습니다. 정리한 뒤 다시 확인하세요.')
        elif stage=='applied':
            if head!=p['base']:raise ValueError('반영 후 원본 커밋이 변경되었습니다.')
            if git(source,'write-tree').decode().strip()!=record['tree']:raise ValueError('스테이징 내용이 미리 본 결과와 다릅니다. 다른 변경을 함께 커밋하지 않습니다.')
            if git(source,'diff','--name-only').strip() or git(source,'ls-files','--others','--exclude-standard').strip():raise ValueError('반영 이후 추가 수정이 있습니다. 먼저 확인하세요.')
        elif stage in ('committed','pushed'):
            if head!=record.get('commit') or git(source,'status','--porcelain','--untracked-files=all').strip():raise ValueError('커밋 이후 원본 상태가 변경되었습니다. 자동으로 push하지 않습니다.')
        else:raise ValueError('이전 Git 작업이 중단되어 상태 확인이 필요합니다. 원본 Git 상태를 직접 확인하세요.')

    def preview(self,pid):
        p,source,patch,blob,branch,remote=self.context(pid);digest=hashlib.sha256(blob).hexdigest();record=self.load(pid)
        if not record:
            record={'stage':'ready','base':p['base'],'patch_hash':digest,'branch':branch,'remote':remote}
        if record['patch_hash']!=digest or (record['stage']!='ready' and record['branch']!=branch):raise ValueError('패치 또는 반영한 브랜치가 이전 확인 내용과 다릅니다.')
        record['branch']=branch;record['remote']=remote
        self.validate_state(p,source,record)
        if record['stage']=='ready':
            git(source,'apply','--check','--index','--',str(patch))
            record['tree']=tree_for_patch(p['workspace'],p['base'],patch)
        record['token']=secrets.token_urlsafe(24);record['previewed']=time.time();self.save(pid,record)
        return {**{k:v for k,v in record.items() if k not in ('patch_hash','tree')},'id':pid,'source':str(source),'files':json.loads(p['artifacts'])['files'],'diff':blob[:80000].decode('utf-8',errors='replace'),'diff_truncated':len(blob)>80000,'test_status':json.loads(p['checks']).get('status','executed') if p['checks'] else 'not_run'}

    def execute(self,body):
        pid=body.get('id');action=body.get('action');message=body.get('message','');record=self.load(pid)
        if action not in ('apply','commit','push') or body.get('confirmed') is not True:raise ValueError('실행할 Git 작업과 확인 여부를 선택하세요.')
        if not record or not isinstance(body.get('token'),str) or not secrets.compare_digest(body['token'],record.get('token','')) or time.time()-record.get('previewed',0)>600:raise ValueError('변경 미리보기를 다시 열어 확인하세요.')
        if action in ('commit','push') and record['stage'] in ('ready','applied') and (not isinstance(message,str) or not 1<=len(message.strip())<=2000):raise ValueError('커밋 메시지를 1~2,000자로 입력하세요.')
        p,source,patch,blob,branch,remote=self.context(pid)
        if hashlib.sha256(blob).hexdigest()!=record['patch_hash'] or branch!=record['branch'] or remote!=record['remote']:raise ValueError('미리보기 이후 패치·브랜치·원격 주소가 변경되었습니다.')
        self.validate_state(p,source,record)
        if action=='push':
            if not remote:raise ValueError('단일 origin push 주소가 필요합니다.')
            tip=git(source,'ls-remote','--heads',remote,'refs/heads/'+branch).decode().split()
            if not tip or tip[0] not in (record['base'],record.get('commit')):raise ValueError('원격 브랜치가 기준 커밋과 다릅니다. 다른 커밋을 함께 push하거나 자동 병합하지 않습니다.')
        # Persist intent before each mutation. An interrupted action must not blindly rerun.
        try:
            if record['stage']=='ready':
                git(source,'apply','--check','--index','--',str(patch));self.validate_state(p,source,record)
                record['stage']='applying';self.save(pid,record)
                git(source,'apply','--index','--',str(patch))
                record['stage']='applied';self.validate_state(p,source,record);self.save(pid,record)
            if action in ('commit','push') and record['stage']=='applied':
                self.validate_state(p,source,record);record['stage']='committing';self.save(pid,record)
                git(source,'commit','-m',message.strip())
                record['commit']=git(source,'rev-parse','HEAD').decode().strip()
                if git(source,'rev-parse','HEAD^{tree}').decode().strip()!=record['tree'] or git(source,'rev-parse','HEAD^').decode().strip()!=record['base']:raise ValueError('커밋 내용 또는 부모가 예상과 다릅니다.')
                record['stage']='committed';self.save(pid,record)
            if action=='push' and record['stage']=='committed':
                self.validate_state(p,source,record)
                git(source,'push','--porcelain','--',remote,record['commit']+':refs/heads/'+branch)
                record['stage']='pushed';self.save(pid,record)
        except (ValueError,subprocess.TimeoutExpired):
            record['error']='Git 작업이 완료되지 않았습니다. 반영·커밋된 내용은 보존됩니다. 표시된 단계와 원본 상태를 확인하세요.';self.save(pid,record)
            raise ValueError(record['error']) from None
        record.pop('error',None);record['token']='';self.save(pid,record)
        self.pipeline.event(pid,'hub','publication',{'applied':'원본에 반영하고 스테이징했습니다. 커밋하지 않았습니다.','committed':'원본에 반영하고 커밋했습니다. push하지 않았습니다.','pushed':'선택한 원격 브랜치에 push했습니다.'}[record['stage']]);self.db.commit()
        return {'stage':record['stage'],'commit':record.get('commit'),'branch':branch,'source':str(source)}
