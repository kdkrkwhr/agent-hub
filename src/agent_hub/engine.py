"""Local durable queue and shared state. No product or user paths are hardcoded."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import time
import uuid

from . import adapters
from .config import Config,atomic_json
from .coral import Peer

class Hub:
    def __init__(self,root):
        self.root=Path(root);self.root.mkdir(parents=True,exist_ok=True)
        self.config=Config(root);self.lock=threading.RLock();self.stop=threading.Event()
        self.db=sqlite3.connect(self.root/'queue.sqlite3',check_same_thread=False)
        self.db.row_factory=sqlite3.Row
        self.db.executescript('''CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, scope TEXT, tid TEXT, agent TEXT, source TEXT, status TEXT,
            attempt INTEGER, started REAL, ended REAL, result TEXT, error TEXT);
            CREATE TABLE IF NOT EXISTS archives (scope TEXT, tid TEXT, snapshot TEXT, confirmed INTEGER DEFAULT 0, PRIMARY KEY(scope,tid));
            CREATE TABLE IF NOT EXISTS baselines (scope TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS executions (job TEXT, attempt INTEGER, scope TEXT, tid TEXT, agent TEXT, PRIMARY KEY(job,attempt));
        ''')
        self.db.execute("UPDATE jobs SET status='failed',error='Interrupted by restart. Review the run before retrying.' WHERE status='running'")
        self.db.commit()
        self.threads=[];self.connected=False;self.error=None;self.updated=None
        self.active={};self.pool=concurrent.futures.ThreadPoolExecutor(max_workers=3)
        self.demo=[];self.revision=0
        self.thread=threading.Thread(target=self.loop,daemon=True)

    def start(self):self.thread.start()

    def scope(self,cfg):
        return hashlib.sha256(json.dumps({k:cfg.get(k) for k in ('mode','agents','observer','url_file','endpoints')},sort_keys=True).encode()).hexdigest()

    def peer(self,name,cfg=None):return Peer(self.config.endpoints(cfg)[name])

    def save(self,body):
        with self.lock:
            if self.active:raise ValueError('Stop or finish active jobs before changing settings.')
            result=self.config.save(body)
            self.revision+=1;self.threads=[];self.connected=False;self.error=None
            self.db.execute("UPDATE jobs SET status='cancelled',error='Configuration changed.' WHERE status='pending'");self.db.commit()
            if self.config.value['mode']=='demo':self.seed_demo()
            return result

    def test_connection(self,body):
        cfg=self.config.prepare(body)
        if cfg['mode']=='demo':return {'ok':True,'message':'Demo needs no accounts or server.'}
        for name in [cfg['observer'],*cfg['agents']]:self.peer(name,cfg).call('tools/list',{})
        ts=self.peer(cfg['observer'],cfg).threads()
        return {'ok':True,'message':f'Coral connected. {len(ts)} visible threads.'}

    def seed_demo(self):
        agents=self.config.value['agents'];now=time.time()
        self.demo=[{'threadId':'demo-welcome','threadName':'AGENT HUB에 오신 것을 환영합니다',
            'participatingAgents':['hub',*agents],'state':'open','messages':[
                {'sendingAgentName':'hub','messageText':'데모 모드입니다. 실제 에이전트 호출이나 요금은 발생하지 않습니다. 설정에서 Coral에 연결하세요.','messageTimestamp':now,'mentionAgentNames':[]},
                {'sendingAgentName':agents[0],'messageText':'스레드를 선택해 대화를 읽고, 새 채널을 만들거나 메시지를 보내 보세요. 이 답변은 데모 예시입니다.','messageTimestamp':now+.001,'mentionAgentNames':[]}]}]

    def snapshot(self):
        with self.lock:
            return {'configured':self.config.value is not None,'config':self.config.public(),
                'connected':self.connected,'error':self.error,'updated':self.updated,
                'threads':self.threads,'jobs':[dict(r) for r in self.db.execute(
                    'SELECT id,tid,agent,status,attempt,started,ended,error FROM jobs ORDER BY rowid DESC LIMIT 80')],
                'active':list(self.active),'data_directory':str(self.root)}

    def new_thread(self,title):
        if not isinstance(title,str) or not title.strip() or len(title)>120:raise ValueError('Thread name must contain 1–120 characters.')
        with self.lock:
            cfg=self.config.value
            if not cfg:raise ValueError('Complete setup first.')
            if cfg['mode']=='demo':
                tid='demo-'+uuid.uuid4().hex
                self.demo.append({'threadId':tid,'threadName':title,'participatingAgents':['hub',*cfg['agents']],'state':'open','messages':[]})
                self.threads=list(self.demo);return tid
        receipt=self.peer(cfg['observer'],cfg).tool('coral_create_thread',threadName=title,participantNames=[cfg['observer'],*cfg['agents']])
        tid=receipt['structuredContent']['thread']['id']
        threads=self.peer(cfg['observer'],cfg).threads()
        with self.lock:self.threads=threads
        return tid

    def archived_threads(self,threads,cfg):
        merged={t['threadId']:t for t in threads}
        for row in self.db.execute('SELECT * FROM archives WHERE scope=?',(self.scope(cfg),)):
            current=merged.get(row['tid'])
            if row['confirmed'] or (current and current.get('state')=='closed'):
                saved=json.loads(row['snapshot']);saved['state']='closed';saved['archived']=True
                merged[row['tid']]=saved
        return list(merged.values())

    def close_thread(self,tid,summary):
        if not isinstance(summary,str) or not summary.strip() or len(summary)>2000:
            raise ValueError('Closing summary must contain 1–2000 characters.')
        with self.lock:
            cfg=self.config.value
            if not cfg:raise ValueError('Complete setup first.')
            if any(a['job']['tid']==tid for a in self.active.values()):
                raise ValueError('이 채널의 실행 중인 작업을 완료하거나 취소한 뒤 닫아 주세요.')
            peer=self.peer(cfg['observer'],cfg) if cfg['mode']=='coral' else None
            threads=peer.threads() if peer else self.demo
            current=next((t for t in threads if t['threadId']==tid),None)
            if not current:raise ValueError('Channel not found.')
            if current.get('state')=='closed':raise ValueError('Channel is already closed.')
            saved=dict(current);saved['summary']=summary.strip()
            scope=self.scope(cfg)
            # Commit the last readable snapshot BEFORE Coral can erase messages.
            self.db.execute('INSERT OR REPLACE INTO archives VALUES (?,?,?,0)',
                (scope,tid,json.dumps(saved,ensure_ascii=False)))
            self.db.commit()
            if peer:peer.tool('coral_close_thread',threadId=tid,summary=summary.strip())
            else:current['state']='closed'
            self.db.execute('UPDATE archives SET confirmed=1 WHERE scope=? AND tid=?',(scope,tid))
            self.db.execute("UPDATE jobs SET status='cancelled',ended=?,error='Channel closed.' WHERE scope=? AND tid=? AND status IN ('pending','ready')",(time.time(),scope,tid))
            self.db.commit()
            self.revision+=1
            self.threads=self.archived_threads(threads,cfg)

    def message(self,tid,text,mentions):
        if not isinstance(text,str) or not text.strip() or len(text)>12000:raise ValueError('Message must contain 1–12000 characters.')
        with self.lock:
            cfg=self.config.value
            if not cfg:raise ValueError('Complete setup first.')
            if not isinstance(mentions,list) or any(a not in cfg['agents'] for a in mentions):raise ValueError('Invalid mentions.')
            t=next((t for t in self.threads if t['threadId']==tid),None)
            if not t or t.get('state')=='closed':raise ValueError('Select an open thread.')
            if cfg['mode']=='demo':
                t['messages'].append({'sendingAgentName':'hub','messageText':text,'messageTimestamp':time.time(),'mentionAgentNames':mentions})
                for a in mentions:t['messages'].append({'sendingAgentName':a,'messageText':'[데모 응답] 메시지를 수신했습니다. 실제 모델은 호출하지 않았습니다.','messageTimestamp':time.time(),'mentionAgentNames':[]})
                return
        self.peer(cfg['observer'],cfg).tool('coral_send_message',threadId=tid,content=text,mentions=mentions)

    def set_automatic(self,enabled):
        if not isinstance(enabled,bool):raise ValueError('Expected boolean.')
        with self.lock:
            cfg=self.config.value
            if not cfg or cfg['mode']!='coral':raise ValueError('Connect Coral first.')
            cfg['automatic']=enabled;atomic_json(self.config.path,cfg)

    def ingest(self,threads,cfg):
        scope=self.scope(cfg)
        baseline=self.db.execute('SELECT 1 FROM baselines WHERE scope=?',(scope,)).fetchone() is None
        for t in threads:
            if t.get('state')=='closed':continue
            for msg in t.get('messages',[]):
                sender=msg.get('sendingAgentName')
                if sender not in [cfg['observer'],*cfg['agents']]:continue
                for agent in set(msg.get('mentionAgentNames') or []) & set(cfg['agents']):
                    if sender==agent:continue
                    key=hashlib.sha256(json.dumps([scope,t['threadId'],msg,agent],sort_keys=True).encode()).hexdigest()[:24]
                    self.db.execute('INSERT OR IGNORE INTO jobs VALUES (?,?,?,?,?,?,1,NULL,NULL,NULL,NULL)',
                        (key,scope,t['threadId'],agent,json.dumps(msg,ensure_ascii=False),'baseline' if baseline else 'pending'))
        self.db.execute('INSERT OR IGNORE INTO baselines VALUES (?)',(scope,));self.db.commit()

    def cancel(self,key):
        with self.lock:
            row=self.db.execute('SELECT * FROM jobs WHERE id=?',(key,)).fetchone()
            if not row:raise ValueError('Job not found.')
            for active in self.active.values():
                if active['job']['id']==key:active['cancel'].set();return
            if row['status']=='pending':
                self.db.execute("UPDATE jobs SET status='cancelled',ended=? WHERE id=?",(time.time(),key));self.db.commit()
            else:raise ValueError('Only pending or running jobs can be cancelled.')

    def retry(self,key):
        with self.lock:
            row=self.db.execute('SELECT * FROM jobs WHERE id=?',(key,)).fetchone()
            if not row or row['status'] not in ('failed','cancelled'):raise ValueError('Only failed or cancelled jobs can be retried.')
            if row['scope']!=self.scope(self.config.value):raise ValueError('This job belongs to different connection settings.')
            if any(t['threadId']==row['tid'] and t.get('state')=='closed' for t in self.threads):raise ValueError('Channel is closed.')
            self.db.execute("UPDATE jobs SET status='pending',attempt=attempt+1,error=NULL,result=NULL,started=NULL,ended=NULL WHERE id=?",(key,));self.db.commit()

    def result(self,key):
        with self.lock:
            row=self.db.execute('SELECT result FROM jobs WHERE id=?',(key,)).fetchone()
            if not row:raise ValueError('Job not found.')
            return json.loads(row['result']) if row['result'] else None

    def work(self,cfg,threads):
        for agent,active in list(self.active.items()):
            if not active['future'].done():continue
            row=active['job'];error=None
            try:result=active['future'].result()
            except Exception as exc:
                # Never forward arbitrary native stderr (it can contain credentials).
                error=str(exc) if isinstance(exc,RuntimeError) else 'Local agent execution failed.'
                result={'reply':f'AGENT HUB: {error}','mentions':[]}
            if active['cancel'].is_set():
                error='Cancelled.';result={'reply':'AGENT HUB: Cancelled.','mentions':[]}
            self.db.execute("UPDATE jobs SET status='ready',ended=?,result=?,error=? WHERE id=?",
                (time.time(),json.dumps(result,ensure_ascii=False),error,row['id']))
            self.db.commit();del self.active[agent]
        scope=self.scope(cfg)
        for row in self.db.execute("SELECT * FROM jobs WHERE status='ready' AND scope=?",(scope,)).fetchall():
            marker=f"[HUB:{row['id']}:{row['attempt']}]"
            t=next((t for t in threads if t['threadId']==row['tid']),None)
            if not t:continue
            if t.get('state')=='closed':
                self.db.execute("UPDATE jobs SET status='cancelled',error='Channel closed.' WHERE id=?",(row['id'],));self.db.commit();continue
            exists=any(marker in m.get('messageText','') and m.get('sendingAgentName')==row['agent'] for m in t.get('messages',[]))
            if not exists:
                result=json.loads(row['result'])
                allowed=[cfg['observer'],*cfg['agents']]
                mentions=list(dict.fromkeys(a for a in result.get('mentions',[]) if isinstance(a,str) and a in allowed and a!=row['agent']))
                text=result['reply'][:6000]
                if len(result['reply'])>6000:text+='\n\n[전체 답변은 AGENT HUB 작업 결과에서 확인하세요.]'
                try:self.peer(row['agent'],cfg).tool('coral_send_message',threadId=row['tid'],content=text+'\n\n'+marker,mentions=mentions)
                except Exception:continue
            status='failed' if row['error'] else 'done'
            self.db.execute('UPDATE jobs SET status=? WHERE id=?',(status,row['id']));self.db.commit()
        if not cfg['automatic']:return
        for agent in cfg['agents']:
            if agent in self.active:continue
            row=self.db.execute("SELECT * FROM jobs WHERE status='pending' AND agent=? AND scope=? ORDER BY rowid LIMIT 1",(agent,scope)).fetchone()
            if not row:continue
            used=self.db.execute('SELECT COUNT(*) FROM executions WHERE scope=? AND tid=? AND agent=?',(scope,row['tid'],agent)).fetchone()[0]
            if used>=6:
                self.db.execute("UPDATE jobs SET status='failed',error='Six-run thread limit reached. Create a new thread.' WHERE id=?",(row['id'],));self.db.commit();continue
            t=next((t for t in threads if t['threadId']==row['tid']),{})
            if not t or t.get('state')=='closed':
                self.db.execute("UPDATE jobs SET status='failed',error='Thread unavailable or closed.' WHERE id=?",(row['id'],));self.db.commit();continue
            self.db.execute('INSERT INTO executions VALUES (?,?,?,?,?)',(row['id'],row['attempt'],scope,row['tid'],agent))
            self.db.execute("UPDATE jobs SET status='running',started=? WHERE id=?",(time.time(),row['id']));self.db.commit()
            cancel=threading.Event();active={'job':dict(row),'cancel':cancel,'process':None}
            self.active[agent]=active
            def live(proc,a=active):a['process']=proc
            active['future']=self.pool.submit(adapters.execute,agent,dict(cfg),t,
                json.loads(row['source']).get('messageText',''),self.root/'runs'/row['id']/str(row['attempt']),cancel,live)

    def loop(self):
        while not self.stop.is_set():
            with self.lock:cfg=self.config.value;revision=self.revision
            try:
                if cfg:
                    if cfg['mode']=='demo':
                        with self.lock:
                            if not self.demo:self.seed_demo()
                            threads=list(self.demo)
                    else:threads=self.peer(cfg['observer'],cfg).threads()
                    with self.lock:
                        if revision!=self.revision:continue
                        threads=self.archived_threads(threads,cfg)
                        self.threads=threads;self.connected=True;self.error=None;self.updated=time.time()
                        if cfg['mode']=='coral':self.ingest(threads,cfg);self.work(cfg,threads)
            except Exception:
                with self.lock:self.connected=False;self.error='Coral connection unavailable. Retrying; check connection settings.'
            self.stop.wait(3)

    def close(self):
        self.stop.set()
        with self.lock:
            for active in self.active.values():active['cancel'].set()
        if self.thread.is_alive():self.thread.join(timeout=20)
        self.pool.shutdown(wait=True,cancel_futures=True)
        self.db.close()
