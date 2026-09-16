/* Role assignments and artifact views; existing discussion and ballot inputs stay intact. */
'use strict';
const pipelineLabels={inspect:'개별 질의',prepare:'준비',plan:'계획',implement:'구현',verify:'테스트·검토',consult:'질문 답변',completed:'작업 완료',blocked:'작업 보류',cancelled:'작업 취소',rework:'수정 재시도'};
let pipelineRoles={};const pipelineExpanded=new Set();
let commandLookup=0;
function openPipeline(request,options={}){
 if(!selected){notify('작업할 채널을 선택하세요.');return;}
 $('pipeline-dialog').dataset.tid=selected;$('pipeline-request').value=request??$('message').value;$('pipeline-source').value=snapshot.config.workspace||'';$('pipeline-authorize').checked=false;$('pipeline-error').textContent='';
 const agents=snapshot.config.agents||[];
 $('pipeline-agent').replaceChildren();for(const a of agents){const o=node('option','',a.toUpperCase());o.value=a;$('pipeline-agent').append(o);}$('pipeline-agent').value=options.agent||agents[0]||'';
 $('pipeline-parent').replaceChildren();const fresh=node('option','','새 작업 사본 만들기');fresh.value='';$('pipeline-parent').append(fresh);for(const p of snapshot.pipelines||[]){if(p.tid!==selected||!p.can_followup)continue;const o=node('option','',when(p.ended)+' · '+p.request.slice(0,65));o.value=p.id;$('pipeline-parent').append(o);}
 $('pipeline-mode').value=options.mode||'team';$('pipeline-parent').value=options.parentId||'';
 pipelineRoles={plan:[agents.includes('claude')?'claude':agents[0]],implement:[agents.includes('codex')?'codex':agents[0]],verify:[agents.includes('cursor')?'cursor':agents[0]]};renderPipelineRoles();tab='jobs';render();$('pipeline-dialog').showModal();$('pipeline-command').value='';updatePipelineMode();updatePipelineTarget();
}
function updatePipelineMode(){
 const mode=$('pipeline-mode').value,inspect=mode==='inspect';$('pipeline-check-options').hidden=inspect;$('pipeline-repairs').closest('label').hidden=inspect;$('pipeline-mode-description').textContent={team:'계획 → 구현 → 테스트·검토. 역할별 담당자와 순서를 지정합니다.',single:'한 명이 수정한 뒤 자체 검토합니다. 다른 에이전트의 독립 검토는 포함하지 않습니다.',inspect:'선택한 에이전트가 파일을 읽고 답합니다. 파일 수정과 테스트 실행은 하지 않습니다.'}[mode];$('pipeline-agent-label').hidden=mode==='team';$('pipeline-roles').hidden=mode!=='team';
 $('pipeline-authorize').required=!inspect;$('pipeline-authorize').closest('label').hidden=inspect;$('pipeline-command').disabled=inspect;$('detect-commands').disabled=inspect;$('pipeline-repairs').disabled=inspect;
 $('start-pipeline').textContent=inspect?'읽기 전용 질문 실행':'작업 시작';
}
function updatePipelineTarget(){
 const p=(snapshot.pipelines||[]).find(p=>p.id===$('pipeline-parent').value);$('pipeline-source').readOnly=!!p;$('pipeline-source').value=p?p.source:(snapshot.config.workspace||'');
 $('pipeline-target-hint').textContent=p?'이어서 작업: '+p.request+' · 사본: '+p.workspace+' · 기존 변경을 유지합니다. 이전 결과물은 보존되며 새 패치는 최초 기준 커밋 대비 누적 변경입니다.':'새 사본에서 실행합니다. 원본 저장소는 변경하지 않습니다.';
 if($('pipeline-mode').value!=='inspect')findPipelineCommands();else{commandLookup++;$('command-suggestions').replaceChildren();}
}
function openAgentWork(tid,name){
 if(!tid){notify('먼저 채널을 선택하세요.');return;}selected=tid;
 const prior=(snapshot.pipelines||[]).find(p=>p.tid===tid&&p.can_followup);
 openPipeline('',{agent:name,mode:'single',parentId:prior?.id||''});
}
function renderPipelineRoles(){
 $('pipeline-roles').replaceChildren();
 for(const role of ['plan','implement','verify']){const box=node('fieldset','pipeline-role'),legend=node('legend','',pipelineLabels[role]);box.append(legend);const choices=node('div','poll-team');
  for(const a of snapshot.config.agents){const label=node('label','inline mention-choice'),check=node('input');label.dataset.agent=a;check.type='checkbox';check.checked=pipelineRoles[role].includes(a);check.setAttribute('aria-label',pipelineLabels[role]+' 담당 '+a.toUpperCase());check.onchange=()=>{pipelineRoles[role]=check.checked?[...pipelineRoles[role],a]:pipelineRoles[role].filter(n=>n!==a);renderPipelineRoles();};label.append(check,node('span','',a.toUpperCase()));choices.append(label);}box.append(choices);
  const order=node('div','pipeline-order');pipelineRoles[role].forEach((a,i)=>{const item=node('span','pipeline-assignee');item.dataset.agent=a;item.append(node('span','',`${i+1}. ${a.toUpperCase()}`));if(i){const up=node('button','','←');up.type='button';up.setAttribute('aria-label',a.toUpperCase()+' 실행 순서 앞으로');up.onclick=()=>{[pipelineRoles[role][i-1],pipelineRoles[role][i]]=[pipelineRoles[role][i],pipelineRoles[role][i-1]];renderPipelineRoles();};item.append(up);}order.append(item);});if(!pipelineRoles[role].length)order.append(node('small','','담당자를 한 명 이상 선택하세요.'));box.append(order);$('pipeline-roles').append(box);
 }
}
function pipelineMessages(thread){
 const out=[];
 for(const p of snapshot.pipelines||[]){if(p.tid!==thread.threadId)continue;
  out.push({sendingAgentName:snapshot.config.observer||'ops',messageText:p.request,messageTimestamp:p.created,eventKey:p.id+':start',pipeline:p,pipelineResult:false});
  for(const e of p.events){if(e.kind==='request')continue;const terminal=['completed','blocked','cancelled'].includes(e.kind);out.push({sendingAgentName:e.sender,messageText:e.content,messageTimestamp:e.created,eventKey:p.id+':'+e.id,phase:e.kind==='question'?'question':null,pipelinePhase:pipelineLabels[e.kind]||e.kind,mentionAgentNames:e.target?[e.target]:[],pipeline:terminal?p:null,pipelineResult:terminal});}
 }
 return out;
}
function pipelineDisclosure(key,title){const d=node('details','pipeline-details');d.append(node('summary','',title));d.open=pipelineExpanded.has(key);d.ontoggle=()=>{if(!d.isConnected)return;if(d.open)pipelineExpanded.add(key);else pipelineExpanded.delete(key);};return d;}
function renderPipelineCard(p,result){
 const card=node('article','poll-card pipeline-card');card.dataset.messageKey=p.id+(result?':end':':start');
 const head=node('div','poll-card-heading');head.append(node('span','eyebrow','ROLE WORKFLOW'),node('time','',when(result?p.ended:p.created)));card.append(head,node('h3','',result?pipelineLabels[p.status]:p.mode==='inspect'?'개별 질문':p.mode==='single'?'개별 작업':'역할 분담 작업'));
 if(p.parent_id)card.append(node('small','','후속 작업 · '+p.parent_id));
 if(p.mode==='single')card.append(node('p','hint','한 명이 구현하고 자체 검토합니다. 독립 교차 검토는 포함하지 않습니다.'));
 if(!result){
  const request=pipelineDisclosure(p.id+':request',p.request.slice(0,100)+(p.request.length>100?'…':''));request.append(renderMarkdown(node('div'),p.request));card.append(request);
  const steps=node('ol','pipeline-steps');for(const phase of (p.mode==='inspect'?['prepare','inspect']:p.mode==='single'?['prepare','implement','verify']:['prepare','plan','implement','verify'])){const step=node('li','');step.dataset.current=String(p.status==='active'&&p.phase===phase);const tasks=p.tasks.filter(t=>t.phase===phase&&(['prepare','plan'].includes(phase)||t.iteration===p.iteration)),done=tasks.length&&tasks.every(t=>t.status==='done');step.dataset.done=String(!!done);step.append(node('b','',pipelineLabels[phase]),node('small','',phase==='prepare'?(p.parent_id?'기존 사본 이어 쓰기':'분리된 사본 생성'):(p.roles[phase]||p.roles.plan).map(a=>a.toUpperCase()).join(' → ')));steps.append(step);}card.append(steps);
  const running=p.tasks.find(t=>t.status==='running');card.append(node('p','pipeline-progress',p.status==='active'?(running?running.agent.toUpperCase()+' · '+pipelineLabels[running.phase]+' 진행 중':'담당 에이전트 실행 대기'):(p.reason||pipelineLabels[p.status])));
  card.append(node('small','',`수정 ${p.iteration-1}/${p.max_repairs}회 · 원본 자동 반영 없음`));
  if(p.status==='active'){const stop=node('button','','작업 중지');stop.type='button';stop.onclick=async()=>{if(!confirm('역할 작업을 중지할까요? 작업 사본과 로그는 보존됩니다.'))return;try{await api('/api/pipeline/cancel',{id:p.id});await pollOnce();}catch(e){notify(e.message);}};card.append(stop);}
 }else{
  card.append(node('p','',p.reason));
  if(p.checks){const d=pipelineDisclosure(p.id+':checks',p.checks.status==='skipped'?'테스트 미실행 · 에이전트 결과물 검토':`호스트 검증 · 종료 코드 ${p.checks.exit_code}${p.checks.exit_code===0?' · 명령 통과':' · 실패'}`);d.append(node('pre','',p.checks.argv.join(' ')+'\n\n'+p.checks.output));card.append(d);}
  if(p.artifacts){card.append(node('p','',`변경 파일 ${p.artifacts.files.length}개 · 검토된 결과물`));const files=pipelineDisclosure(p.id+':files','변경 파일 보기');for(const f of p.artifacts.files)files.append(node('div','',f));card.append(files);const links=node('div','pipeline-downloads');for(const [file,label] of [['changes.patch','변경 패치'],['changed-files.zip','변경 파일 ZIP'],['report.md','작업 보고서']]){const a=node('a','',label+' ↓');a.href='/api/pipeline/artifact?id='+encodeURIComponent(p.id)+'&name='+encodeURIComponent(file);a.download=file;links.append(a);}card.append(links);}
 }
 if(p.can_followup){const follow=node('button','poll-room-link','후속 작업 요청 →');follow.dataset.followup=p.id;follow.onclick=()=>{selected=p.tid;openPipeline('',{parentId:p.id});};card.append(follow);}
 const paths=pipelineDisclosure(p.id+':paths','작업 공간 정보');paths.append(node('p','','원본: '+p.source),node('p','','작업 사본: '+p.workspace),node('p','','기준 커밋: '+p.base));card.append(paths);
 if(p.status!=='active'){const ask=node('button','poll-room-link','이 작업에 대해 대화하기 →');ask.onclick=()=>{selected=p.tid;tab='chat';lastKey='';render();const reference='작업 ID: '+p.id;$('message').value=reference+'\n'+($('message').value||'이 작업 결과를 설명해 줘.');$('message').focus();};card.append(ask);}
 const room=node('button','poll-room-link','사무실에서 보기 →');room.onclick=()=>{selected=p.tid;officeView.room='work';tab='office';lastKey='';render();};card.append(room);return card;
}
async function findPipelineCommands(){
 const generation=++commandLookup,source=$('pipeline-source').value.trim(),box=$('command-suggestions');box.replaceChildren();
 if(!source){box.append(node('p','hint','저장소 경로를 입력하면 검증 명령을 찾을 수 있습니다.'));return;}
 box.append(node('p','hint','프로젝트 설정을 읽는 중…'));
 try{const result=await api('/api/pipeline/commands',{source});if(generation!==commandLookup||source!==$('pipeline-source').value.trim())return;box.replaceChildren();
  for(const item of result.suggestions){const card=node('div','command-candidate'),b=node('button','',item.label+' · 선택');b.type='button';b.disabled=!item.available;b.onclick=()=>{$('pipeline-command').value=item.command;$('pipeline-command').focus();};card.append(b,node('code','',item.command),node('small','',item.evidence));if(item.reason)card.append(node('small','error',item.reason));box.append(card);}
  for(const warning of result.warnings)box.append(node('p','hint',warning));box.append(node('p','hint',result.note));
 }catch(e){if(generation===commandLookup)box.replaceChildren(node('p','error',e.message));}
}
function renderPipelinePage(){
 const list=$('pipeline-list'),position=$('jobs').scrollTop;list.replaceChildren();
 const items=(snapshot.pipelines||[]).filter(p=>!selected||p.tid===selected).sort((a,b)=>(b.status==='active')-(a.status==='active')||b.created-a.created);
 $('job-count').textContent=items.length||'';
 const current=snapshot.threads.find(t=>t.threadId===selected);
 $('pipeline-page-hint').textContent=!selected?'왼쪽에서 채널을 선택하면 새 역할 작업을 시작할 수 있습니다.':current?.state==='closed'?'닫힌 채널입니다. 기존 작업 결과를 확인할 수 있습니다.':$('new-pipeline').disabled?(snapshot.config.mode==='demo'?'Coral 연결 후 역할 작업을 실행할 수 있습니다.':'진행 중인 토론·투표·역할 작업이 끝나면 새 작업을 시작할 수 있습니다.'):'이 채널의 작업입니다. 역할은 중복 지정할 수 있으며 작업 사본에서 순서대로 실행됩니다.';
 if(!items.length)list.append(node('div','empty','아직 역할 작업이 없습니다. 새 역할 작업에서 목표와 담당자를 정하세요.'));
 for(const p of items){const section=node('section','workflow-run');if(!selected)section.append(node('h3','',snapshot.threads.find(t=>t.threadId===p.tid)?.threadName||p.tid));section.append(renderPipelineCard(p,false));
 const history=pipelineDisclosure(p.id+':history','단계별 인계 기록 · '+p.events.filter(e=>e.kind!=='request').length+'건');
 for(const e of p.events){if(e.kind==='request')continue;const row=node('article','workflow-event');row.dataset.sender=e.sender;row.append(node('strong','',e.sender.toUpperCase()+' · '+(pipelineLabels[e.kind]||e.kind)),node('small','',when(e.created)));row.append(renderMarkdown(node('div'),e.content));history.append(row);}section.append(history);
 if(p.status!=='active')section.append(renderPipelineCard(p,true));list.append(section);}
 $('jobs').scrollTop=position;
}
function initPipeline(){
 $('pipeline-mode').onchange=()=>{updatePipelineMode();if($('pipeline-mode').value==='inspect'){commandLookup++;$('command-suggestions').replaceChildren();}};
 $('pipeline-parent').onchange=updatePipelineTarget;
 $('detect-commands').onclick=findPipelineCommands;
 $('pipeline-source').addEventListener('input',()=>{commandLookup++;$('command-suggestions').replaceChildren(node('p','hint','저장소가 변경되었습니다. 프로젝트에서 찾기를 눌러 다시 조회하세요.'));});
 $('pipeline-source').addEventListener('change',findPipelineCommands);
 $('new-pipeline').onclick=()=>openPipeline();$('dismiss-pipeline').onclick=()=>$('pipeline-dialog').close();
 $('pipeline-form').onsubmit=async e=>{e.preventDefault();$('start-pipeline').disabled=true;try{await api('/api/pipeline',{threadId:$('pipeline-dialog').dataset.tid,request:$('pipeline-request').value,source:$('pipeline-source').value,roles:pipelineRoles,mode:$('pipeline-mode').value,agent:$('pipeline-agent').value,parentId:$('pipeline-parent').value||null,testCommand:$('pipeline-mode').value==='inspect'?'':$('pipeline-command').value,maxRepairs:Number($('pipeline-repairs').value),authorizeWrites:$('pipeline-authorize').checked});$('pipeline-dialog').close();agent='';$('search').value='';await pollOnce();notify('역할 작업을 시작했습니다. 원본 대신 분리된 작업 사본에서 실행합니다.');}catch(e){$('pipeline-error').textContent=e.message;}finally{$('start-pipeline').disabled=false;}};
}
