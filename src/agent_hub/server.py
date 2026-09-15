"""Loopback-only UI server with same-origin mutation checks and CSRF protection."""
import json
import mimetypes
from pathlib import Path
import secrets
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs

STATIC=Path(__file__).parent/'static'

def make_server(hub,port):
    token=secrets.token_urlsafe(32)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def allowed(self,mutate=False):
            host=self.headers.get('Host','')
            if host not in (f'localhost:{self.server.server_port}',f'127.0.0.1:{self.server.server_port}'):return False
            origin=self.headers.get('Origin')
            if origin and origin not in (f'http://localhost:{self.server.server_port}',f'http://127.0.0.1:{self.server.server_port}'):return False
            if self.headers.get('Sec-Fetch-Site')=='cross-site':return False
            return not mutate or secrets.compare_digest(self.headers.get('X-Hub-CSRF',''),token)
        def reply(self,status,data,content='application/json; charset=utf-8'):
            body=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode('utf-8')
            self.send_response(status);self.send_header('Content-Type',content);self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'")
            self.end_headers()
            try:self.wfile.write(body)
            except (BrokenPipeError,ConnectionResetError):pass
        def do_GET(self):
            if not self.allowed():return self.reply(403,{'error':'Forbidden origin or host.'})
            path=urlsplit(self.path).path
            if path=='/api/state':return self.reply(200,hub.snapshot())
            if path=='/api/bootstrap':
                from .adapters import inventory
                return self.reply(200,{'csrf':token,'providers':inventory(),'config':hub.config.public(),'version':'0.1.0'})
            if path=='/api/result':
                try:return self.reply(200,hub.result(parse_qs(urlsplit(self.path).query).get('id',[''])[0]))
                except ValueError as e:return self.reply(404,{'error':str(e)})
            name='index.html' if path=='/' else path.lstrip('/')
            allowed={'index.html','app.js','style.css','icon.png','icon.ico'}
            if name not in allowed:return self.reply(404,{'error':'Not found.'})
            self.reply(200,(STATIC/name).read_bytes(),mimetypes.guess_type(name)[0] or 'application/octet-stream')
        def do_POST(self):
            if not self.allowed(mutate=True):return self.reply(403,{'error':'Forbidden origin or CSRF token.'})
            try:
                size=int(self.headers.get('Content-Length','0'))
                if size<1 or size>65536:raise ValueError('Invalid request size.')
                if self.headers.get_content_type()!='application/json':raise ValueError('Expected JSON.')
                body=json.loads(self.rfile.read(size))
                if not isinstance(body,dict):raise ValueError('Expected an object.')
                if self.path=='/api/config':result=hub.save(body)
                elif self.path=='/api/test':result=hub.test_connection(body)
                elif self.path=='/api/thread':result={'id':hub.new_thread(body.get('name'))}
                elif self.path=='/api/thread/close':hub.close_thread(body.get('threadId'),body.get('summary'));result={'ok':True}
                elif self.path=='/api/message':hub.message(body.get('threadId'),body.get('text'),body.get('mentions',[]));result={'ok':True}
                elif self.path=='/api/automatic':hub.set_automatic(body.get('enabled'));result={'ok':True}
                elif self.path=='/api/cancel':hub.cancel(body.get('id'));result={'ok':True}
                elif self.path=='/api/retry':hub.retry(body.get('id'));result={'ok':True}
                else:return self.reply(404,{'error':'Not found.'})
                self.reply(200,result)
            except ValueError as exc:self.reply(400,{'error':str(exc)})
            except Exception:self.reply(502,{'error':'Operation failed. Check Coral connection and settings.'})
    return ThreadingHTTPServer(('127.0.0.1',port),Handler)
