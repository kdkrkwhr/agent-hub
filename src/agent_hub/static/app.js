'use strict';
const $=id=>document.getElementById(id);
let csrf='',boot=null,snapshot=null,selected='',agent='',tab='chat',lastKey='',busy=false;
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const when=value=>{const d=new Date(typeof value==='number'?value*1000:value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});};
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Hub-CSRF':csrf},body:JSON.stringify(body)});const data=await r.json();if(r.status===404&&path==='/api/thread/close')throw Error('실행 중인 서버가 이전 버전입니다. AGENT HUB 서버를 종료한 뒤 start.cmd로 다시 실행해 주세요. 창 새로고침만으로는 적용되지 않습니다.');if(!r.ok)throw Error(data.error||'요청 실패');return data;}
function notify(text){$('notice').textContent=text;}
function names(){return [...document.querySelectorAll('[data-provider]:checked')].map(e=>e.dataset.provider);}
function mode(){return document.querySelector('[name=mode]:checked').value;}
function connectionFields(){
 $('coral-settings').hidden=mode()!=='coral';const holder=$('endpoint-fields');
 const values=Object.fromEntries([...holder.querySelectorAll('input')].map(e=>[e.dataset.endpoint,e.value]));holder.replaceChildren();
 for(const name of [...new Set([$('observer').value.trim(),...names()])].filter(Boolean)){
  const label=node('label','',`${name.toUpperCase()} · MCP URL`),input=node('input');input.type='password';input.autocomplete='off';input.dataset.endpoint=name;
  input.placeholder=boot?.config?.endpoint_configured?.includes(name)?'저장된 주소 유지 (변경 시 입력)':'https://… 또는 http://localhost:5555/…';input.value=values[name]||'';label.append(input);holder.append(label);
 }
}
function setup(){
 const cfg=snapshot?.config||boot.config;
 document.querySelector(`[name=mode][value=${cfg?.mode||'demo'}]`).checked=true;
 const holder=$('provider-options');holder.replaceChildren();
 for(const [name,data] of Object.entries(boot.providers)){
  const box=node('div','provider'),label=node('label','inline'),check=node('input');check.type='checkbox';check.dataset.provider=name;check.checked=cfg?cfg.agents.includes(name):true;
  label.append(check,node('strong','',name.toUpperCase()),node('span',data.installed?'detected':'missing',data.installed?'설치 감지됨':'CLI 미감지'));
  const input=node('input');input.dataset.executable=name;input.placeholder='실행 파일 경로 직접 지정 (선택)';input.value=cfg?.executables?.[name]||'';
  box.append(label,input);holder.append(box);check.onchange=connectionFields;
 }
 $('observer').value=cfg?.observer||'ops';$('url-file').value=cfg?.url_file||'';$('workspace').value=cfg?.workspace||'';$('enable-auto').checked=cfg?.automatic||false;
 $('close-setup').hidden=!cfg;$('setup-status').textContent='';$('endpoint-fields').replaceChildren();connectionFields();$('setup').showModal();
}
function formConfig(){return {mode:mode(),agents:names(),observer:$('observer').value,url_file:$('url-file').value,workspace:$('workspace').value,automatic:$('enable-auto').checked,
 endpoints:Object.fromEntries([...document.querySelectorAll('[data-endpoint]')].map(e=>[e.dataset.endpoint,e.value])),executables:Object.fromEntries([...document.querySelectorAll('[data-executable]')].map(e=>[e.dataset.executable,e.value]))};}
function lastActivity(thread){
 return (thread.messages||[]).reduce((latest,message)=>{const value=message.messageTimestamp,time=typeof value==='number'?value*1000:Date.parse(value);return Number.isFinite(time)?Math.max(latest,time):latest;},0);
}
function allMessages(){return(snapshot?.threads||[]).flatMap(t=>(t.messages||[]).map((m,i)=>({...m,tid:t.threadId,thread:t.threadName,index:i}))).sort((a,b)=>new Date(typeof a.messageTimestamp==='number'?a.messageTimestamp*1000:a.messageTimestamp)-new Date(typeof b.messageTimestamp==='number'?b.messageTimestamp*1000:b.messageTimestamp)||a.index-b.index);}
function render(){
 if(!snapshot)return;
 $('connection').textContent=snapshot.connected?(snapshot.config?.mode==='demo'?'● DEMO':'● LIVE'):'연결 대기';$('connection').classList.toggle('off',!snapshot.connected);
 $('updated').textContent=snapshot.updated?'마지막 수신 '+when(snapshot.updated):'연결 대기 중';
 $('automatic').disabled=snapshot.config?.mode!=='coral';$('automatic').textContent=snapshot.config?.automatic?'자동 응답 켜짐':'자동 응답 꺼짐';
 const key=JSON.stringify([snapshot.threads,snapshot.jobs,snapshot.active,selected,agent,tab,$('search').value,$('show-closed').checked]);if(key===lastKey)return;lastKey=key;
 const threads=snapshot.threads||[],all=allMessages();if(selected&&!threads.some(t=>t.threadId===selected))selected='';
 const nav=$('threads');nav.replaceChildren();function channel(id,title,meta){const b=node('button',selected===id?'active':'');b.append(node('strong','',title),node('small','',meta));b.onclick=()=>{selected=id;lastKey='';render();};nav.append(b);}
 channel('','전체 대화',`${threads.length}개 채널 · ${all.length}개 메시지`);
 threads.filter(t=>$('show-closed').checked||t.state!=='closed').reverse().sort((a,b)=>lastActivity(b)-lastActivity(a)).forEach(t=>channel(t.threadId,(t.state==='closed'?'[닫힘] ':'')+t.threadName,`${t.messages?.length||0}개 메시지 · ${(t.participatingAgents||[]).join(' / ')}`));$('channel-count').textContent=threads.length;
 $('title').textContent=threads.find(t=>t.threadId===selected)?.threadName||'전체 대화';
 const scoped=all.filter(m=>!selected||m.tid===selected),filters=$('agents');filters.replaceChildren();
 for(const name of ['',...(snapshot.config?.agents||[])]){const b=node('button',agent===name?'active':'');b.append(node('span',name,name?name.toUpperCase():'ALL AGENTS'),node('strong','',String(scoped.filter(m=>!name||m.sendingAgentName===name).length)),node('small','',snapshot.active.includes(name)?'실행 중':'메시지'));b.onclick=()=>{agent=name;lastKey='';render();};filters.append(b);}
 const q=$('search').value.trim().toLowerCase();const messages=scoped.filter(m=>(!agent||m.sendingAgentName===agent)&&(!q||`${m.messageText} ${m.sendingAgentName} ${m.thread}`.toLowerCase().includes(q)));
 const feed=$('feed'),top=feed.scrollTop;feed.replaceChildren();
 if(!messages.length)feed.append(node('div','empty','표시할 대화가 없습니다. 새 채널을 만들거나 검색 조건을 바꿔 보세요.'));
 for(const m of messages.slice(-600)){const card=node('article','message'),head=node('div','message-head'),name=m.sendingAgentName||'unknown';
  head.append(node('span','sender',name.toUpperCase()));if(m.mentionAgentNames?.length)head.append(node('span','target','→ '+m.mentionAgentNames.join(', ')));head.append(node('time','',when(m.messageTimestamp)));
  card.append(head,node('div','message-text',m.messageText));if(!selected)card.append(node('small','thread-tag',m.thread));feed.append(card);}
 feed.scrollTop=$('autoscroll').checked?feed.scrollHeight:top;
 $('feed').hidden=tab!=='chat';$('jobs').hidden=tab!=='jobs';$('composer').hidden=tab!=='chat';$('tab-chat').classList.toggle('active',tab==='chat');$('tab-jobs').classList.toggle('active',tab==='jobs');
 const picked=[...document.querySelectorAll('[data-mention]:checked')].map(e=>e.dataset.mention);$('mentions').replaceChildren();
 for(const name of snapshot.config?.agents||[]){const label=node('label','inline'),check=node('input');check.type='checkbox';check.dataset.mention=name;check.checked=picked.includes(name);label.append(check,node('span','',name.toUpperCase()));$('mentions').append(label);}
 const current=threads.find(t=>t.threadId===selected),closed=current?.state==='closed';
 $('close-thread').hidden=!current||closed;$('close-thread').disabled=busy;
 $('subtitle').textContent=closed?'닫힌 채널 · 읽기 전용'+(current.summary?' · '+current.summary:''):'에이전트의 대화와 작업을 한곳에서 확인하세요.';
 $('send').disabled=!selected||closed||busy;$('message').disabled=!selected||closed;
 document.querySelectorAll('[data-mention]').forEach(e=>e.disabled=closed);
 $('job-count').textContent=snapshot.jobs.length;const jobs=$('jobs');jobs.replaceChildren();
 if(!snapshot.jobs.length)jobs.append(node('div','empty','아직 자동 작업이 없습니다. Coral 연결 후 자동 응답을 켜고 에이전트를 멘션하세요.'));
 for(const job of snapshot.jobs){const card=node('article','job'),head=node('div','job-head');head.append(node('strong','',job.agent.toUpperCase()),node('span','badge',job.status),node('small','',job.id));card.append(head);if(job.error)card.append(node('p','error',job.error));
  const actions=node('div','job-actions');function action(label,endpoint){const b=node('button','',label);b.onclick=async()=>{b.disabled=true;try{await api(endpoint,{id:job.id});await pollOnce();}catch(e){notify(e.message);}finally{b.disabled=false;}};actions.append(b);}
  if(['running','pending'].includes(job.status))action('취소','/api/cancel');if(['failed','cancelled'].includes(job.status)&&!threads.some(t=>t.threadId===job.tid&&t.state==='closed'))action('재시도','/api/retry');
  const view=node('button','','결과 보기');view.onclick=async()=>{try{const r=await api('/api/result?id='+encodeURIComponent(job.id));$('result-text').textContent=r?.reply||'아직 결과가 없습니다.';$('result-dialog').showModal();}catch(e){notify(e.message);}};actions.append(view);card.append(actions);jobs.append(card);}
}
async function pollOnce(){snapshot=await api('/api/state');render();if(snapshot.error)notify(snapshot.error);else notify(snapshot.config?.mode==='demo'?'데모 데이터입니다. 실제 모델 호출 없이 화면을 체험할 수 있습니다.':'Coral 대화와 작업 결과를 표시합니다. 자동 작업은 읽기·분석·답변으로 제한됩니다.');}
async function poll(){try{await pollOnce();}catch(e){$('connection').textContent='서버 연결 끊김';notify(e.message);}setTimeout(poll,3000);}
$('settings').onclick=setup;$('close-setup').onclick=()=>$('setup').close();$('setup').addEventListener('cancel',e=>{if(!snapshot?.configured)e.preventDefault();});
document.querySelectorAll('[name=mode]').forEach(e=>e.onchange=connectionFields);$('observer').onchange=connectionFields;
$('setup-form').onsubmit=async e=>{e.preventDefault();$('save-setup').disabled=true;try{await api('/api/config',formConfig());boot=await api('/api/bootstrap');csrf=boot.csrf;$('setup').close();selected='';lastKey='';await pollOnce();}catch(err){$('setup-status').textContent=err.message;}finally{$('save-setup').disabled=false;}};
$('test-connection').onclick=async()=>{$('test-connection').disabled=true;$('setup-status').textContent='연결 확인 중…';try{const r=await api('/api/test',formConfig());$('setup-status').textContent=r.message;}catch(e){$('setup-status').textContent=e.message;}finally{$('test-connection').disabled=false;}};
$('new-thread').onclick=()=>{$('channel-name').value='';$('create-channel').showModal();};$('cancel-channel').onclick=()=>$('create-channel').close();
$('channel-form').onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/thread',{name:$('channel-name').value});selected=r.id;$('create-channel').close();await pollOnce();}catch(err){notify(err.message);}};
$('composer').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('send').disabled=true;try{await api('/api/message',{threadId:selected,text:$('message').value,mentions:[...document.querySelectorAll('[data-mention]:checked')].map(e=>e.dataset.mention)});$('message').value='';await pollOnce();}catch(err){notify(err.message);}finally{busy=false;$('send').disabled=!selected;}};
$('show-closed').onchange=()=>{if(!$('show-closed').checked&&snapshot.threads.some(t=>t.threadId===selected&&t.state==='closed'))selected='';render();};
let closingId='';
$('close-thread').onclick=()=>{closingId=selected;$('close-summary').value='';$('close-error').textContent='';$('close-channel').showModal();};
$('cancel-close-channel').onclick=()=>$('close-channel').close();
$('close-channel-form').onsubmit=async e=>{e.preventDefault();$('confirm-close-channel').disabled=true;try{await api('/api/thread/close',{threadId:closingId,summary:$('close-summary').value});$('close-channel').close();$('show-closed').checked=true;await pollOnce();}catch(err){$('close-error').textContent=err.message;}finally{$('confirm-close-channel').disabled=false;}};
$('automatic').onclick=async()=>{try{await api('/api/automatic',{enabled:!snapshot.config.automatic});await pollOnce();}catch(e){notify(e.message);}};
$('tab-chat').onclick=()=>{tab='chat';render();};$('tab-jobs').onclick=()=>{tab='jobs';render();};$('search').oninput=()=>render();$('close-result').onclick=()=>$('result-dialog').close();
(async()=>{try{boot=await api('/api/bootstrap');csrf=boot.csrf;await pollOnce();if(!boot.config)setup();poll();}catch(e){notify('시작 실패: '+e.message);}})();
