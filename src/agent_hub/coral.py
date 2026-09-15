"""Coral's HTTP MCP transport. Never expose credential-bearing URLs in errors."""
import json
import re
import urllib.request

class TransportError(RuntimeError):pass

class Peer:
    def __init__(self,url):
        self.url=url;self.serial=0
        self.headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
        init=self.call('initialize',{'protocolVersion':'2025-06-18','capabilities':{},
                    'clientInfo':{'name':'agent-hub-radio','version':'0.1.0'}})
        self.headers['MCP-Protocol-Version']=init['protocolVersion']
        self.call('notifications/initialized',{},notification=True)

    def call(self,method,params,notification=False):
        self.serial+=1
        payload={'jsonrpc':'2.0','method':method,'params':params}
        if not notification:payload['id']=self.serial
        request=urllib.request.Request(self.url,json.dumps(payload).encode(),self.headers,method='POST')
        try:
            with urllib.request.urlopen(request,timeout=15) as r:
                sid=r.headers.get('Mcp-Session-Id')
                if sid:self.headers['Mcp-Session-Id']=sid
                if notification:return {}
                if 'text/event-stream' in r.headers.get('Content-Type',''):
                    result=None;parts=[]
                    for line in r:
                        line=line.decode('utf-8').rstrip('\r\n')
                        if line.startswith('data:'):parts.append(line[5:].lstrip())
                        elif not line and parts:
                            event=json.loads('\n'.join(parts));parts=[]
                            if event.get('id')==self.serial:result=event;break
                    if result is None and parts:
                        event=json.loads('\n'.join(parts))
                        if event.get('id')==self.serial:result=event
                    if result is None:raise TransportError('No matching MCP response.')
                else:result=json.load(r)
            if 'error' in result:raise TransportError('Coral rejected the MCP request.')
            return result['result']
        except Exception as exc:
            if isinstance(exc,TransportError):raise
            raise TransportError('Coral connection failed; check the server and endpoint settings.') from None

    def tool(self,name,**arguments):
        result=self.call('tools/call',{'name':name,'arguments':arguments})
        if result.get('isError'):raise TransportError('Coral tool failed: '+name)
        return result

    def threads(self):
        result=self.call('resources/read',{'uri':'coral://state'})
        found=False
        for item in result.get('contents',[]):
            text=item.get('text','')
            for match in re.finditer(r'```json\s*',text):
                try:data,_=json.JSONDecoder().raw_decode(text[match.end():])
                except ValueError:continue
                if isinstance(data,list) and not data:found=True
                elif isinstance(data,list) and all(isinstance(t,dict) and 'threadId' in t for t in data):
                    return data
        if found:return []
        raise TransportError('Unsupported Coral state format. Check the compatibility documentation.')
