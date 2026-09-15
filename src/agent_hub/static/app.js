'use strict';
const $=id=>document.getElementById(id);
let csrf='',boot=null,snapshot=null,selected='',agent='',tab='chat',lastKey='',busy=false;
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const when=value=>{const d=new Date(typeof value==='number'?value*1000:value);return Number.isNaN(d.getTime())?'':d.toLocaleString('ko-KR',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});};
const markdown=window.markdownit({html:false,breaks:true,linkify:false,typographer:false});
// Remote images are labels only: reading a message must not trigger network requests.
markdown.renderer.rules.image=(tokens,index)=>markdown.utils.escapeHtml(tokens[index].content||'[이미지]');
markdown.validateLink=url=>/^https?:\/\//i.test(url)||/^mailto:/i.test(url);
const defaultLink=markdown.renderer.rules.link_open||((tokens,index,options,env,self)=>self.renderToken(tokens,index,options));
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return defaultLink(tokens,index,options,env,self);};
function renderMarkdown(element,text){
 element.classList.add('markdown');
 try{element.innerHTML=markdown.render(String(text||''));}catch{element.textContent=String(text||'');}
 for(const table of element.querySelectorAll('table')){const wrap=node('div','table-scroll');wrap.tabIndex=0;wrap.setAttribute('aria-label','표 가로 스크롤');table.replaceWith(wrap);wrap.append(table);}
 return element;
}
async function api(path,body){const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Hub-CSRF':csrf},body:JSON.stringify(body)});const data=await r.json();if(r.status===404&&path==='/api/thread/close')throw Error('실행 중인 서버가 이전 버전입니다. AGENT HUB 서버를 종료한 뒤 start.cmd로 다시 실행해 주세요. 창 새로고침만으로는 적용되지 않습니다.');if(!r.ok)throw Error(data.error||'요청 실패');return data;}
function notify(text){$('notice').textContent=text;$('notice').hidden=!text;}
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
let channelPrefs={},prefsKey='';
let readKey='',readMarks={},openingChannel=false,serverOffline=false;
const messageKey=m=>m.eventKey||JSON.stringify([m.messageTimestamp,m.sendingAgentName,m.messageText]);
function loadReadMarks(){
 const cfg=snapshot.config||{},key='agent-hub-read:'+JSON.stringify([snapshot.data_directory,cfg.mode,cfg.observer,cfg.url_file,cfg.agents]);
 if(key===readKey)return;readKey=key;readMarks={};prefsKey=key.replace('agent-hub-read:','agent-hub-channels:');channelPrefs={};
 try{const saved=JSON.parse(localStorage.getItem(prefsKey));if(saved&&typeof saved==='object'&&!Array.isArray(saved))channelPrefs=saved;}catch{}
 try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&typeof saved==='object'&&!Array.isArray(saved))readMarks=saved;}catch{}
}
function channelTitle(t){return channelPrefs[t.threadId]?.name||t.threadName;}
function saveChannelPrefs(id,change){
 const next={...channelPrefs,[id]:{...channelPrefs[id],...change}};
 localStorage.setItem(prefsKey,JSON.stringify(next));channelPrefs=next;lastKey='';render();
}
function readCount(t){
 const mark=readMarks[t.threadId],messages=threadMessages(t);
 if(!mark||!Number.isInteger(mark.count)||mark.count<1)return 0;
 return messages.findIndex(m=>messageKey(m)===mark.anchor)+1;
}
function markVisibleRead(){
 if(!snapshot||!selected||tab!=='chat'||agent||$('search').value.trim()||document.visibilityState!=='visible'||document.querySelector('dialog[open]'))return;
 const feed=$('feed');if(feed.scrollHeight-feed.scrollTop-feed.clientHeight>24)return;
 const t=snapshot.threads.find(t=>t.threadId===selected),messages=t?threadMessages(t):[];
 if(!messages.length||readCount(t)===messages.length)return;
 readMarks[selected]={count:messages.length,anchor:messageKey(messages[messages.length-1])};
 try{localStorage.setItem(readKey,JSON.stringify(readMarks));}catch{}
 const badge=[...document.querySelectorAll('[data-channel]')].find(b=>b.dataset.channel===selected)?.querySelector('.unread');if(badge)badge.remove();
}
function agentStatus(name){
 if(serverOffline)return ['offline','허브 연결 끊김'];
 if(snapshot.config?.mode==='demo')return ['idle','데모'];
 const jobs=snapshot.jobs.filter(j=>j.agent===name);
 if(snapshot.active.includes(name)||jobs.some(j=>j.status==='running'))return ['running','실행 중'];
 if(!snapshot.connected)return ['offline','Coral 연결 끊김'];
 if(jobs.some(j=>j.status==='ready'))return ['pending','응답 전송 대기'];
 if(!snapshot.config?.automatic)return ['idle','관찰 모드'];
 const pending=jobs.filter(j=>j.status==='pending').length;
 if(pending)return ['pending',`${snapshot.config?.automatic?'요청 대기':'자동 응답 꺼짐 · 대기'} ${pending}건`];
 const recent=jobs.find(j=>['done','failed','cancelled'].includes(j.status));
 if(recent?.round_id&&recent.status==='done'&&snapshot.collaboration?.some(r=>r.id===recent.round_id&&r.status==='active'))return ['idle','단계 완료 · 동료 대기'];
 if(recent)return [{done:'done',failed:'failed',cancelled:'idle'}[recent.status],{done:'응답 완료',failed:'작업 실패',cancelled:'작업 취소'}[recent.status]];
 return ['idle',snapshot.config?.automatic?'요청 없음':'자동 응답 꺼짐'];
}
function messageTime(m){const v=m.messageTimestamp,t=typeof v==='number'?v*1000:Date.parse(v);return Number.isFinite(t)?t:0;}
function threadMessages(thread){
 const rounds=(snapshot?.collaboration||[]).filter(r=>r.tid===thread.threadId);
 const finalRounds=new Set(rounds.filter(r=>r.events.some(e=>['agreed','blocked','cancelled'].includes(e.kind))).map(r=>r.id));
 const messages=(thread.messages||[]).filter(m=>!([...finalRounds].some(id=>m.sendingAgentName===rounds.find(r=>r.id===id).lead&&m.messageText?.includes(`[COLLAB-FINAL:${id}]`))));
 for(const r of rounds)for(const e of r.events){
  if(['request','guidance'].includes(e.kind))continue;
  const terminal=['agreed','blocked','cancelled'].includes(e.kind);
  let targets=[];try{targets=JSON.parse(e.targets||'[]');}catch{}
  let text=e.content;
  if(e.vote)text=`**V${e.vote.version} · ${e.vote.decision==='APPROVE'?'승인합니다':'반대합니다'}**\n\n`+text;
  if(terminal&&e.kind==='agreed'&&r.votes?.length)text+='\n\n**최종안 승인 기록**\n'+r.votes.map(v=>`- ${v.agent.toUpperCase()}: V${v.version} ${v.decision==='APPROVE'?'승인':'반대'}`).join('\n');
  if(e.kind==='plan'&&Object.keys(r.assignments).length)text+='\n\n**역할 분담**\n'+Object.entries(r.assignments).map(([a,task])=>`- ${a.toUpperCase()}: ${task}`).join('\n');
  messages.push({sendingAgentName:terminal?r.lead:e.sender,messageText:text,messageTimestamp:e.created,
   mentionAgentNames:['question','issue'].includes(e.kind)?targets:[],eventKey:`collab:${r.id}:${e.id}`,
   phase:e.kind,final:terminal,issues:terminal?r.issues:[]});
 }
 return messages.sort((a,b)=>messageTime(a)-messageTime(b));
}
function lastActivity(thread){return threadMessages(thread).reduce((latest,m)=>Math.max(latest,messageTime(m)),0);}
function allMessages(){return(snapshot?.threads||[]).flatMap(t=>threadMessages(t).map((m,i)=>({...m,tid:t.threadId,thread:channelTitle(t),index:i}))).sort((a,b)=>messageTime(a)-messageTime(b)||a.index-b.index);}
const collaborationLabels={explore:'독립 분석',plan:'역할 분담',execute:'분업 조사',synthesize:'쟁점 조율',review:'교차 검토',resolve:'쟁점 확인',consult:'동료 질문 확인',agreed:'전원 합의',blocked:'합의 보류',cancelled:'취소'};
function renderCollaborationStatus(){
 const rounds=(snapshot.collaboration||[]).filter(r=>!selected||r.tid===selected),active=rounds.find(r=>r.status==='active'),bar=$('collab-status');bar.replaceChildren();bar.hidden=!active;
 if(!active)return;
 bar.append(node('span','',`협업 중 · ${collaborationLabels[active.stage]} · V${active.version} · 미해결 쟁점 ${active.issues.filter(i=>i.status!=='resolved').length}개`));
 const stop=node('button','','협업 중지');stop.onclick=async()=>{try{await api('/api/collaboration/cancel',{id:active.id});await pollOnce();}catch(e){notify(e.message);}};bar.append(stop);
}
function render(){
 if(!snapshot)return;loadReadMarks();
 $('connection').textContent=snapshot.connected?(snapshot.config?.mode==='demo'?'● DEMO':'● LIVE'):'연결 대기';$('connection').classList.toggle('off',!snapshot.connected);
 $('updated').textContent=snapshot.updated?'마지막 수신 '+when(snapshot.updated):'연결 대기 중';
 $('automatic').disabled=snapshot.config?.mode!=='coral';$('automatic').textContent=snapshot.config?.automatic?'허브 자동 응답 켜짐':'관찰 모드';
 const key=JSON.stringify([snapshot.threads,snapshot.jobs,snapshot.collaboration,snapshot.active,snapshot.connected,snapshot.config?.automatic,serverOffline,selected,agent,tab,$('search').value,$('show-closed').checked]);if(key===lastKey)return;lastKey=key;
 const threads=snapshot.threads||[],all=allMessages();if(selected&&!threads.some(t=>t.threadId===selected))selected='';
 const nav=$('threads');nav.replaceChildren();function channel(id,title,meta){const b=node('button',selected===id?'active':'');b.append(node('strong','',title),node('small','',meta));b.dataset.channel=id;const t=threads.find(t=>t.threadId===id),unread=t?threadMessages(t).length-readCount(t):0;if(unread){const badge=node('span','unread',String(unread));badge.setAttribute('aria-label',`읽지 않은 메시지 ${unread}개`);b.append(badge);}b.onclick=()=>{selected=id;openingChannel=true;lastKey='';render();};nav.append(b);}
 channel('','전체 대화',`${threads.length}개 채널 · ${all.length}개 메시지`);
 threads.filter(t=>$('show-closed').checked||t.state!=='closed').reverse().sort((a,b)=>Number(!!channelPrefs[b.threadId]?.pinned)-Number(!!channelPrefs[a.threadId]?.pinned)||lastActivity(b)-lastActivity(a)).forEach(t=>channel(t.threadId,(channelPrefs[t.threadId]?.pinned?'★ ':'')+(t.state==='closed'?'[닫힘] ':'')+channelTitle(t),`${threadMessages(t).length}개 메시지 · ${(t.participatingAgents||[]).join(' / ')}`));$('channel-count').textContent=threads.length;
 $('title').textContent=threads.find(t=>t.threadId===selected)?channelTitle(threads.find(t=>t.threadId===selected)):'전체 대화';
 const scoped=all.filter(m=>!selected||m.tid===selected),filters=$('agents');filters.replaceChildren();
 for(const name of ['',...(snapshot.config?.agents||[])]){const b=node('button',agent===name?'active':'');b.append(node('span',name,name?name.toUpperCase():'ALL AGENTS'),node('strong','',String(scoped.filter(m=>!name||m.sendingAgentName===name).length)),node('small','',name?agentStatus(name)[1]:'메시지'));if(name){b.dataset.status=agentStatus(name)[0];b.title='이 허브가 실행한 작업 기준입니다. Coral 연결 상태는 공통이며 외부 CLI의 로그인·실행 상태는 확인하지 않습니다.';}b.onclick=()=>{agent=name;lastKey='';render();};filters.append(b);}
 const q=$('search').value.trim().toLowerCase();const messages=scoped.filter(m=>(!agent||m.sendingAgentName===agent)&&(!q||`${m.messageText} ${m.sendingAgentName} ${m.thread}`.toLowerCase().includes(q)));
 const feed=$('feed'),top=feed.scrollTop,atBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<=24;feed.replaceChildren();
 const currentThread=threads.find(t=>t.threadId===selected),boundary=currentThread?readCount(currentThread):0;let divider=null;
 if(!messages.length)feed.append(node('div','empty','표시할 대화가 없습니다. 새 채널을 만들거나 검색 조건을 바꿔 보세요.'));
 for(const m of (selected?messages:messages.slice(-600))){const card=node('article','message'),head=node('div','message-head'),name=m.sendingAgentName||'unknown';
  if(selected&&!agent&&!q&&m.index===boundary){divider=node('div','unread-divider','여기부터 읽지 않은 메시지');feed.append(divider);}
  head.append(node('span','sender',name.toUpperCase()));if(m.mentionAgentNames?.length)head.append(node('span','target','→ '+m.mentionAgentNames.join(', ')));head.append(node('time','',when(m.messageTimestamp)));
  if(m.phase)head.append(node('span',m.final?'chat-phase final-phase':'chat-phase',m.final?(m.phase==='agreed'?'전원 승인 · 자동 제출':collaborationLabels[m.phase]):(collaborationLabels[m.phase]||{question:'질문',issue:'쟁점'}[m.phase]||'토론')));
  const sender=name.toLowerCase(),identity=['claude','codex','cursor','ops','hub'].includes(sender)?sender:'other';
  card.dataset.sender=identity;
  const avatar=node('div','chat-avatar',{claude:'CL',codex:'CX',cursor:'CU',ops:'OP',hub:'나',other:'?'}[identity]);avatar.setAttribute('aria-hidden','true');
  const body=node('div','bubble-body');body.append(head,renderMarkdown(node('div','message-text'),m.messageText));
  if(m.issues?.length){const details=node('details','bubble-issues');details.append(node('summary','',`쟁점 ${m.issues.length}개`));for(const i of m.issues){details.append(node('p','',`${i.owner.toUpperCase()} · ${{open:'미해결',investigated:'조사 완료',resolved:'해결'}[i.status]} · ${i.question}`));if(i.resolution)details.append(renderMarkdown(node('div'),i.resolution));}body.append(details);}
  if(!selected)body.append(node('small','thread-tag',m.thread));card.append(avatar,body);feed.append(card);}
 if(openingChannel){feed.scrollTop=divider?divider.offsetTop-feed.offsetTop:feed.scrollHeight;openingChannel=false;}else feed.scrollTop=$('autoscroll').checked&&atBottom?feed.scrollHeight:top;
 renderCollaborationStatus();
 $('feed').hidden=tab!=='chat';$('jobs').hidden=tab!=='jobs';$('composer').hidden=tab!=='chat';$('tab-chat').classList.toggle('active',tab==='chat');$('tab-jobs').classList.toggle('active',tab==='jobs');
 const picked=[...document.querySelectorAll('[data-mention]:checked')].map(e=>e.dataset.mention);$('mentions').replaceChildren();
 for(const name of snapshot.config?.agents||[]){const label=node('label','inline'),check=node('input');check.type='checkbox';check.dataset.mention=name;check.checked=picked.includes(name);label.append(check,node('span','',name.toUpperCase()));$('mentions').append(label);}
 const current=threads.find(t=>t.threadId===selected),closed=current?.state==='closed';
 $('rename-thread').hidden=!current;$('pin-thread').hidden=!current;$('pin-thread').textContent=channelPrefs[selected]?.pinned?'★ 고정 해제':'☆ 상단 고정';$('pin-thread').setAttribute('aria-pressed',String(!!channelPrefs[selected]?.pinned));
 $('close-thread').hidden=!current||closed;$('close-thread').disabled=busy;
 $('subtitle').textContent=closed?'닫힌 채널 · 읽기 전용'+(current.summary?' · '+current.summary:''):'';
 $('send').disabled=!selected||closed||busy;$('message').disabled=!selected||closed;
 document.querySelectorAll('[data-mention]').forEach(e=>e.disabled=closed);
 $('job-count').textContent=snapshot.jobs.length;const jobs=$('jobs');jobs.replaceChildren();
 if(!snapshot.jobs.length)jobs.append(node('div','empty','아직 자동 작업이 없습니다. Coral 연결 후 자동 응답을 켜고 에이전트를 멘션하세요.'));
 for(const job of snapshot.jobs){const card=node('article','job'),head=node('div','job-head');head.append(node('strong','',job.agent.toUpperCase()),node('span','badge',job.status),node('small','',job.id));card.append(head);if(job.error)card.append(node('p','error',job.error));
  const actions=node('div','job-actions');function action(label,endpoint){const b=node('button','',label);b.onclick=async()=>{b.disabled=true;try{await api(endpoint,{id:job.id});await pollOnce();}catch(e){notify(e.message);}finally{b.disabled=false;}};actions.append(b);}
  if(['running','pending'].includes(job.status))action('취소','/api/cancel');if(!job.id.startsWith('collab-')&&snapshot.config?.automatic&&['failed','cancelled'].includes(job.status)&&!threads.some(t=>t.threadId===job.tid&&t.state==='closed'))action('재시도','/api/retry');
  const view=node('button','','결과 보기');view.onclick=async()=>{try{const r=await api('/api/result?id='+encodeURIComponent(job.id));renderMarkdown($('result-text'),r?.reply||'아직 결과가 없습니다.');$('result-dialog').showModal();}catch(e){notify(e.message);}};actions.append(view);card.append(actions);jobs.append(card);}
}
async function pollOnce(){snapshot=await api('/api/state');snapshot.jobs=[...(snapshot.collaboration_jobs||[]),...snapshot.jobs];serverOffline=false;render();markVisibleRead();if(snapshot.error)notify(snapshot.error);else notify(snapshot.config?.mode==='demo'?'데모 데이터입니다. 실제 모델 호출 없이 화면을 체험할 수 있습니다.':'');}
async function poll(){try{await pollOnce();}catch(e){serverOffline=true;lastKey='';render();$('connection').textContent='서버 연결 끊김';$('connection').classList.add('off');notify(e.message);}setTimeout(poll,3000);}
$('feed').addEventListener('scroll',markVisibleRead);document.addEventListener('visibilitychange',markVisibleRead);
$('settings').onclick=setup;$('close-setup').onclick=()=>$('setup').close();$('setup').addEventListener('cancel',e=>{if(!snapshot?.configured)e.preventDefault();});
document.querySelectorAll('[name=mode]').forEach(e=>e.onchange=connectionFields);$('observer').onchange=connectionFields;
$('setup-form').onsubmit=async e=>{e.preventDefault();$('save-setup').disabled=true;try{await api('/api/config',formConfig());boot=await api('/api/bootstrap');csrf=boot.csrf;$('setup').close();selected='';lastKey='';await pollOnce();}catch(err){$('setup-status').textContent=err.message;}finally{$('save-setup').disabled=false;}};
$('test-connection').onclick=async()=>{$('test-connection').disabled=true;$('setup-status').textContent='연결 확인 중…';try{const r=await api('/api/test',formConfig());$('setup-status').textContent=r.message;}catch(e){$('setup-status').textContent=e.message;}finally{$('test-connection').disabled=false;}};
$('new-thread').onclick=()=>{$('channel-name').value='';$('create-channel').showModal();};$('cancel-channel').onclick=()=>$('create-channel').close();
$('channel-form').onsubmit=async e=>{e.preventDefault();try{const r=await api('/api/thread',{name:$('channel-name').value});selected=r.id;$('create-channel').close();await pollOnce();}catch(err){notify(err.message);}};
$('composer').onsubmit=async e=>{e.preventDefault();if(busy)return;busy=true;$('send').disabled=true;try{await api('/api/message',{threadId:selected,text:$('message').value,mentions:[...document.querySelectorAll('[data-mention]:checked')].map(e=>e.dataset.mention)});$('message').value='';await pollOnce();}catch(err){notify(err.message);}finally{busy=false;$('send').disabled=!selected;}};
let renamingId='';
$('rename-thread').onclick=()=>{renamingId=selected;const t=snapshot.threads.find(t=>t.threadId===renamingId);$('rename-name').value=channelTitle(t);$('rename-error').textContent='';$('rename-channel').showModal();$('rename-name').focus();};
$('cancel-rename').onclick=()=>$('rename-channel').close();
$('rename-form').onsubmit=e=>{e.preventDefault();const name=$('rename-name').value.trim();if(!name){$('rename-error').textContent='이름을 입력해 주세요.';return;}try{saveChannelPrefs(renamingId,{name});$('rename-channel').close();}catch{$('rename-error').textContent='이름을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.';}};
$('pin-thread').onclick=()=>{try{saveChannelPrefs(selected,{pinned:!channelPrefs[selected]?.pinned});}catch{notify('고정 설정을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');}};
$('show-closed').onchange=()=>{if(!$('show-closed').checked&&snapshot.threads.some(t=>t.threadId===selected&&t.state==='closed'))selected='';render();};
let closingId='';
$('close-thread').onclick=()=>{closingId=selected;$('close-summary').value='';$('close-error').textContent='';$('close-channel').showModal();};
$('cancel-close-channel').onclick=()=>$('close-channel').close();
$('close-channel-form').onsubmit=async e=>{e.preventDefault();$('confirm-close-channel').disabled=true;try{await api('/api/thread/close',{threadId:closingId,summary:$('close-summary').value});$('close-channel').close();$('show-closed').checked=true;await pollOnce();}catch(err){$('close-error').textContent=err.message;}finally{$('confirm-close-channel').disabled=false;}};
$('automatic').onclick=async()=>{if(!snapshot.config.automatic&&!confirm('허브가 새 멘션에 직접 응답합니다. 같은 에이전트를 처리하는 외부 실행기가 있다면 먼저 중지해 주세요. 관찰 중인 과거 요청은 실행하지 않습니다. 허브 자동 응답을 켤까요?'))return;try{await api('/api/automatic',{enabled:!snapshot.config.automatic});await pollOnce();}catch(e){notify(e.message);}};
$('tab-chat').onclick=()=>{tab='chat';render();};$('tab-jobs').onclick=()=>{tab='jobs';render();};$('search').oninput=()=>render();$('close-result').onclick=()=>$('result-dialog').close();
(async()=>{try{boot=await api('/api/bootstrap');csrf=boot.csrf;await pollOnce();if(!boot.config)setup();poll();}catch(e){notify('시작 실패: '+e.message);}})();
