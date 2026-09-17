"""Local activity inbox. Polling records terminal transitions without executing work."""
import time

class Notifications:
    def __init__(self,hub):
        self.hub=hub;self.db=hub.db
        self.db.execute("CREATE TABLE IF NOT EXISTS notifications(scope TEXT,id TEXT,tid TEXT,kind TEXT,title TEXT,body TEXT,target TEXT,created REAL,seen INTEGER DEFAULT 0,PRIMARY KEY(scope,id))")
        self.db.commit()

    def snapshot(self):
        scope=self.hub.scope(self.hub.config.value or {})
        sources=[
            ('pipeline',"SELECT id,tid,status,request AS body,COALESCE(ended,created) AS created,0 AS attempt FROM pipelines WHERE scope=? AND status IN ('completed','blocked','failed')"),
            ('collaboration',"SELECT r.id,r.tid,r.status,r.request AS body,COALESCE((SELECT MAX(created) FROM collab_events WHERE round_id=r.id),r.created) AS created,0 AS attempt FROM collab_rounds r WHERE scope=? AND status IN ('agreed','blocked')"),
            ('poll',"SELECT id,tid,status,passage AS body,COALESCE(ended,created) AS created,0 AS attempt FROM polls WHERE scope=? AND status='revealed'"),
            ('job',"SELECT id,tid,status,COALESCE(error,'') AS body,COALESCE(ended,started,0) AS created,attempt FROM jobs WHERE scope=? AND status IN ('done','failed')")]
        deleted={r[0] for r in self.db.execute('SELECT tid FROM deleted_channels WHERE scope=?',(scope,))}
        for source,query in sources:
            for r in self.db.execute(query,(scope,)).fetchall():
                if r['tid'] in deleted:continue
                kind='attention' if r['status']=='blocked' else 'failed' if r['status']=='failed' else 'complete'
                label={'pipeline':'역할 작업','collaboration':'합의 토론','poll':'투표','job':'에이전트 작업'}[source]
                title=label+' · '+{'attention':'확인 필요','failed':'실패','complete':'완료'}[kind]
                key=f"{source}:{r['id']}:{r['status']}:{r['attempt']}"
                self.db.execute('INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,?,?,?,?,0)',(scope,key,r['tid'],kind,title,str(r['body'])[:500],source,r['created']))
        self.db.execute('DELETE FROM notifications WHERE scope=? AND tid IN (SELECT tid FROM deleted_channels WHERE scope=?)',(scope,scope))
        self.db.commit()
        return [dict(r) for r in self.db.execute('SELECT id,tid,kind,title,body,target,created,seen FROM notifications WHERE scope=? ORDER BY created DESC,id DESC LIMIT 100',(scope,))]

    def read(self,ids):
        if not isinstance(ids,list) or len(ids)>100 or any(not isinstance(i,str) or len(i)>250 for i in ids):raise ValueError('알림 목록이 올바르지 않습니다.')
        with self.hub.lock:
            scope=self.hub.scope(self.hub.config.value or {})
            self.db.executemany('UPDATE notifications SET seen=1 WHERE scope=? AND id=?',[(scope,i) for i in ids]);self.db.commit()
        return {'ok':True}
