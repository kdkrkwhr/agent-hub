'use strict';
const $ = id => document.getElementById(id);
let csrf = '', current = null, sessions = [], polling = false, working = false, boot;
const drafts = new Map();
const labels = {claude:'Claude Code',codex:'Codex',cursor:'Cursor Agent'};
const message = text => { $('notice').textContent = text || ''; };
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Hub-CSRF':csrf},body:JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent=text;
  if(className)node.className=className;return node;
}
function renderSessions() {
  $('sessions').replaceChildren(...sessions.map(session => {
    const button=element('button',session.source.split(/[\\/]/).filter(Boolean).at(-1));
    button.classList.toggle('active',session.id===current?.id);
    button.append(element('small',`${session.agent} · ${session.status}`));
    button.addEventListener('click',()=>selectSession(session.id).catch(e=>message(e.message)));
    return button;
  }));
}
async function refreshSessions() { sessions=await api('/api/manual/sessions'); renderSessions(); }
function rememberDraft() { if(current)drafts.set(current.id,$('request').value); }
function renderCurrent() {
  $('welcome').hidden=!!current;$('workspace').hidden=!current;
  $('workspace-title').textContent=current?current.source.split(/[\\/]/).filter(Boolean).at(-1):'Bring your agents together.';
  $('workspace-path').textContent=current?.source||'Choose a project. Work in a separate copy. Keep the conversation.';
  if(!current)return;
  const busy=['running','preparing'].includes(current.status);
  $('status').textContent=`${current.status} · ${current.writable?'editing enabled':'read only'}`;
  $('copy-path').textContent=`Working copy: ${current.workspace}`;
  $('default-agent').textContent=`Default: ${labels[current.agent]||current.agent}`;
  $('send').disabled=working||current.status!=='ready';$('stop').disabled=!busy||working;
  $('export').disabled=busy||working;$('close-session').disabled=busy||working||current.status==='closed';
  $('sync').disabled=busy||working||current.status==='closed';
}
async function selectSession(id) {
  if(working)return;
  rememberDraft();current=await api('/api/manual/session?id='+encodeURIComponent(id));
  $('request').value=drafts.get(id)||'';message('');renderCurrent();renderSessions();await renderHistory();
}
async function renderHistory() {
  if(!current)return;
  const id=current.id, records=await api('/api/manual/history?id='+encodeURIComponent(id));
  if(current?.id!==id)return;
  const history=$('history'),atBottom=history.scrollHeight-history.scrollTop-history.clientHeight<80;
  history.replaceChildren(...records.filter(r=>r.message||r.error||r.outcome?.changed?.length).map(record=>{
    const card=element('article',undefined,'message'+(record.sender==='Human'?' human':''));
    card.append(element('h3',record.sender+(record.round?` · Round ${record.round}`:'')));
    if(record.message)card.append(element('pre',record.message));
    if(record.error)card.append(element('p',record.error));
    if(record.outcome&&Object.keys(record.outcome).length){
      const details=element('details');details.append(element('summary','Changes / result'),element('pre',JSON.stringify(record.outcome,null,2)));card.append(details);
    }
    return card;
  }));
  if(atBottom)history.scrollTop=history.scrollHeight;
}
async function poll() {
  if(polling||working||!current)return;
  polling=true;const id=current.id;
  try {
    const next=await api('/api/manual/session?id='+encodeURIComponent(id));
    if(current?.id!==id)return;
    const changed=next.status!==current.status;current=next;renderCurrent();
    if(next.last_turn&&['running','pending'].includes(next.last_turn.status)){
      const turn=await api('/api/manual/turn?id='+encodeURIComponent(next.last_turn.id));
      if(current?.id!==id)return;
      const text=turn.events.filter(e=>['text','speaker'].includes(e.kind)).map(e=>e.data.text||e.data.message||'').join('');
      $('progress').textContent=text||'Agent is working…';
    }else{$('progress').textContent='';}
    if(changed){await renderHistory();await refreshSessions();}
  }catch(e){message(e.message);}finally{polling=false;}
}
async function action(fn) {
  if(working)return;
  working=true;renderCurrent();message('');
  try{await fn();await refreshSessions();if(current){current=await api('/api/manual/session?id='+encodeURIComponent(current.id));await renderHistory();}}
  catch(e){message(e.message);}finally{working=false;renderCurrent();}
}
function showCreate() {$('create-error').textContent='';$('create-dialog').showModal();}
$('new-session').onclick=showCreate;$('welcome-new').onclick=showCreate;
$('create-cancel').onclick=()=>{$('create-dialog').close();};
$('browse').onclick=async()=>{
  try{
    if(!window.pywebview?.api)throw new Error('Paste a full folder path, or use the installed desktop app to browse.');
    const folder=await window.pywebview.api.choose_folder();if(folder)$('source').value=folder;
  }catch(e){$('create-error').textContent=e.message;}
};
$('create-form').onsubmit=async event=>{
  event.preventDefault();$('create-submit').disabled=true;$('create-cancel').disabled=true;$('create-error').textContent='';
  try{
    const session=await api('/api/manual/session',{source:$('source').value,agent:$('agent').value,authorizeWrites:$('writable').checked,workspaceMode:'folder'});
    $('create-dialog').close();await refreshSessions();await selectSession(session.id);
  }catch(e){$('create-error').textContent=e.message;}
  finally{$('create-submit').disabled=false;$('create-cancel').disabled=false;}
};
$('composer').onsubmit=event=>{
  event.preventDefault();if(!current||current.status!=='ready'||!$('request').value.trim())return;
  const text=$('request').value;
  action(async()=>{await api('/api/manual/submit',{sessionId:current.id,text,requestId:crypto.randomUUID()});$('request').value='';drafts.delete(current.id);});
};
$('request').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('composer').requestSubmit();}});
$('stop').onclick=()=>action(()=>api('/api/manual/cancel',{sessionId:current.id}));
$('sync').onclick=()=>{
  if(confirm('Review the working copy and make sure any interrupted agent has stopped. Continue with its current files?'))
    action(()=>api('/api/manual/manage',{sessionId:current.id,action:'sync'}));
};
$('export').onclick=()=>action(async()=>{
  const result=await api('/api/manual/manage',{sessionId:current.id,action:'export'});
  message(`Export saved to:\n${result.directory}\n\n${result.artifacts.join(', ')}\nChanged files: ${result.files.length}`);
});
$('close-session').onclick=()=>{
  if(confirm('Archive this workspace? Its conversation and files will be kept.'))action(()=>api('/api/manual/manage',{sessionId:current.id,action:'close'}));
};
async function loadBootstrap() {
  boot=await api('/api/bootstrap');csrf=boot.csrf;
  $('version').textContent=`v${boot.version} · Desktop preview`;$('data-path').textContent=boot.data_directory;
  $('providers').replaceChildren(...Object.entries(labels).map(([name,label])=>{
    const available=boot.providers[name]?.installed;
    const card=element('div',undefined,'provider'+(available?' available':''));
    card.append(element('strong',label),element('small',available?'CLI detected':'Install CLI to connect'));return card;
  }));
}
$('refresh').onclick=()=>action(async()=>{await loadBootstrap();});
(async()=>{
  try{await loadBootstrap();await refreshSessions();document.body.dataset.ready='true';setInterval(poll,1000);}
  catch(e){message('Could not connect to the local Hub. '+e.message);document.body.dataset.ready='error';}
})();
