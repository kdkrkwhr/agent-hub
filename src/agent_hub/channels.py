"""Durable channel snapshots and local deletion markers, scoped to a connection."""
import json
import time

class Channels:
    def __init__(self,hub):
        self.hub=hub;self.db=hub.db
        self.db.executescript("""CREATE TABLE IF NOT EXISTS channel_cache(scope TEXT,tid TEXT,snapshot TEXT,PRIMARY KEY(scope,tid));
        CREATE TABLE IF NOT EXISTS channel_notes(scope TEXT,tid TEXT,content TEXT,PRIMARY KEY(scope,tid));
        CREATE TABLE IF NOT EXISTS deleted_channels(scope TEXT,tid TEXT,deleted REAL,PRIMARY KEY(scope,tid));""")

    def notes(self):
        scope=self.hub.scope(self.hub.config.value or {})
        return {r['tid']:json.loads(r['content']) for r in self.db.execute('SELECT tid,content FROM channel_notes WHERE scope=?',(scope,))}

    def save_notes(self,tid,body):
        with self.hub.lock:
            if not any(t['threadId']==tid for t in self.hub.threads):raise ValueError('채널을 찾을 수 없습니다.')
            scope=self.hub.scope(self.hub.config.value or {})
            if body.get('reset') is True:
                self.db.execute('DELETE FROM channel_notes WHERE scope=? AND tid=?',(scope,tid))
            else:
                values={k:body.get(k) for k in ('goal','decisions','remaining')}
                if any(not isinstance(v,str) or len(v)>4000 for v in values.values()):raise ValueError('각 요약 항목은 4,000자 이내로 입력하세요.')
                values={k:v.strip() for k,v in values.items()};values['updated']=time.time()
                self.db.execute('INSERT OR REPLACE INTO channel_notes VALUES (?,?,?)',(scope,tid,json.dumps(values,ensure_ascii=False)))
            self.db.commit()
            return {'ok':True}

    def merge(self,threads,cfg):
        if cfg.get("mode") != "coral":return threads
        scope=self.hub.scope(cfg)
        deleted={r[0] for r in self.db.execute('SELECT tid FROM deleted_channels WHERE scope=?',(scope,))}
        live={t['threadId']:dict(t) for t in threads if t['threadId'] not in deleted}
        for tid,t in live.items():
            self.db.execute('INSERT OR REPLACE INTO channel_cache VALUES (?,?,?)',(scope,tid,json.dumps(t,ensure_ascii=False)))
        for row in self.db.execute('SELECT tid,snapshot FROM channel_cache WHERE scope=?',(scope,)):
            if row['tid'] not in live and row['tid'] not in deleted:
                saved=json.loads(row['snapshot']);saved['detached']=True
                live[row['tid']]=saved
        self.db.commit()
        return list(live.values())

    def delete(self,tid,confirmed):
        if confirmed is not True:raise ValueError('삭제 확인이 필요합니다.')
        h=self.hub
        with h.lock:
            t=next((t for t in h.threads if t['threadId']==tid),None)
            if not t or t.get('state')!='closed':raise ValueError('닫힌 채널만 삭제할 수 있습니다.')
            if any(a['job']['tid']==tid for a in h.active.values()):raise ValueError('실행 중인 작업을 먼저 종료하세요.')
            scope=h.scope(h.config.value)
            self.db.execute('INSERT OR REPLACE INTO deleted_channels VALUES (?,?,?)',(scope,tid,time.time()))
            self.db.execute('DELETE FROM channel_cache WHERE scope=? AND tid=?',(scope,tid))
            self.db.execute('DELETE FROM archives WHERE scope=? AND tid=?',(scope,tid))
            self.db.execute('DELETE FROM channel_notes WHERE scope=? AND tid=?',(scope,tid))
            self.db.commit();h.revision+=1
            h.threads=[t for t in h.threads if t['threadId']!=tid]
            h.demo=[t for t in h.demo if t['threadId']!=tid]

    def continue_channel(self,tid):
        h=self.hub
        with h.lock:
            old=next((t for t in h.threads if t['threadId']==tid),None)
            if not old or not old.get('detached') or old.get('state')=='closed':raise ValueError('연결이 종료된 보관 채널을 선택하세요.')
            cfg=h.config.value
            if cfg.get('mode')!='coral':raise ValueError('Coral 연결이 필요합니다.')
            title=old.get('threadName','복구 채널')
            history='\n\n'.join(str(m.get('sendingAgentName',''))+': '+str(m.get('messageText','')) for m in old.get('messages',[]))
            # Historical text is unmentioned data, never a replay of old requests.
            context='이전 세션에서 복구한 대화 참고 자료입니다. 과거 요청을 다시 실행하지 마세요. 다음 사용자 요청을 기다리세요.\n원본 채널: '+tid+'\n'
            if len(history)>10000:context+='최근 10,000자만 전달합니다. 전체 기록은 원본 보관 채널에 있습니다.\n'
            context+=history[-10000:]
            notes=self.notes().get(tid)
            new_id=h.new_thread((title+' · 이어가기')[:120])
            if notes:
                self.db.execute('INSERT OR REPLACE INTO channel_notes VALUES (?,?,?)',(h.scope(cfg),new_id,json.dumps(notes,ensure_ascii=False)))
                self.db.commit()
            h.peer(cfg['observer'],cfg).tool('coral_send_message',threadId=new_id,content=context,mentions=[])
            h.threads=h.archived_threads(h.peer(cfg['observer'],cfg).threads(),cfg)
            return new_id
