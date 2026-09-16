/* Independent ballot controls and public-only result rendering. */
'use strict';
const openBallotOpinions=new Set();
function pollMessages(thread){
 const out=[];
 for(const p of snapshot.polls||[]){if(p.tid!==thread.threadId)continue;
  out.push({sendingAgentName:snapshot.config.observer||'ops',messageText:'독립 비밀 투표 · '+p.passage,messageTimestamp:p.created,mentionAgentNames:p.team,eventKey:p.id+':open',poll:p,pollResult:false});
  if(p.status!=='active')out.push({sendingAgentName:'radio',messageText:'독립 투표 결과 · '+p.passage+' '+(p.ballots||[]).map(b=>[b.agent,b.choice,b.reply,b.reason,b.concern].filter(Boolean).join(' ')).join(' '),messageTimestamp:p.ended,eventKey:p.id+':end',poll:p,pollResult:true});
 }
 return out;
}
function openVotingRoom(id){officeView.room='vote';officeView.pollId=id;tab='office';lastKey='';render();}
function renderPollCard(p,result){
 const card=node('article','poll-card');card.dataset.poll=p.id;card.dataset.messageKey=p.id+(result?':end':':open');
 const heading=node('div','poll-card-heading');heading.append(node('span','eyebrow',p.demo?'DEMO · 예시 투표':'INDEPENDENT BALLOT'),node('time','',when(result?p.ended:p.created)));card.append(heading);
 if(!result){
  card.append(node('h3','',p.status==='active'?'비밀 투표 진행 중':'투표 지문'),renderMarkdown(node('div','poll-passage'),p.passage));
  const choices=node('div','poll-choice-list');for(const o of p.options){const row=node('div','poll-choice');row.append(node('b','poll-letter',o.id),node('span','',o.text));choices.append(row);}card.append(choices);
  const team=node('div','poll-team');for(const a of p.team){const b=p.ballots.find(b=>b.agent===a);const chip=node('span','mention-chip',a.toUpperCase()+' · '+(p.status==='active'?({done:'제출 완료 · 비공개',running:'판단 중',pending:'실행 대기',failed:'실패'}[b?.status]||'대기'):'참여'));chip.dataset.agent=a;team.append(chip);}card.append(team);
  if(p.status==='active'){
   card.append(node('p','poll-sealed',`선택·근거 비공개 · ${p.submitted}/${p.team.length}명 제출 · ${when(p.deadline)} 마감`));
   const stop=node('button','','투표 취소');stop.type='button';stop.onclick=async()=>{if(!confirm('투표를 취소할까요? 제출된 표는 공개하지 않습니다.'))return;try{await api('/api/poll/cancel',{id:p.id});await pollOnce();}catch(e){notify(e.message);}};card.append(stop);
  }
 }else if(p.status==='cancelled'){card.append(node('h3','','투표 취소'),node('p','',p.reason),node('p','hint','개별 선택과 근거는 공개하지 않습니다.'));}
 else {
  const leaders=p.leaders||[];card.append(node('h3','',!leaders.length?'유효한 선택표가 없습니다':leaders.length>1?'공동 최다 득표 · '+leaders.join(' / '):leaders[0]+'안 · 최다 득표'));
  card.append(node('p','hint',`${p.submitted}/${p.team.length}명 제출 · ${p.reason} · 다수 의견은 정답이나 실행 승인을 뜻하지 않습니다.`));
  for(const o of p.options){const row=node('div','poll-result-option');row.dataset.leading=String(leaders.includes(o.id));const title=node('div','');title.append(node('b','poll-letter',o.id),node('span','',o.text),node('strong','',`${p.counts[o.id]}표`));const meter=node('progress');meter.max=p.team.length;meter.value=p.counts[o.id];meter.setAttribute('aria-label',`${o.id} ${p.counts[o.id]}표 / 참여자 ${p.team.length}명`);row.append(title,meter);card.append(row);}
  const opinions=node('div','poll-opinions');for(const b of p.ballots){const d=node('details','poll-opinion');d.dataset.agent=b.agent;const key=p.id+':'+b.agent;d.open=openBallotOpinions.has(key);d.ontoggle=()=>{if(!d.isConnected)return;if(d.open)openBallotOpinions.add(key);else openBallotOpinions.delete(key);};const choice=b.choice==='ABSTAIN'?'기권':b.choice?b.choice+'안 선택':{failed:'실패',missing:'미응답',cancelled:'취소'}[b.status]||'미응답';d.append(node('summary','',b.agent.toUpperCase()+' · '+choice));if(b.reply){d.append(renderMarkdown(node('div'),b.reply),node('h4','','판단 근거'),renderMarkdown(node('div'),b.reason),node('h4','','우려 · 불확실성'),renderMarkdown(node('div'),b.concern));}else d.append(node('p','',b.error||'마감까지 표를 제출하지 않았습니다.'));opinions.append(d);}card.append(opinions);
 }
 if(result&&p.status==='revealed'){const next=node('button','poll-room-link','이 결과로 작업 준비 →');next.onclick=()=>{selected=p.tid;openPipeline(p.passage+'\n\n투표 참고 의견:\n'+p.ballots.filter(b=>b.reply).map(b=>b.agent.toUpperCase()+': '+b.choice+' / '+b.reason).join('\n')+'\n\n구현할 최종 방향과 필요한 결과물을 여기에 명시해 주세요.');};card.append(next);}
 const room=node('button','poll-room-link','투표실에서 보기 →');room.type='button';room.onclick=()=>{selected=p.tid;openVotingRoom(p.id);};card.append(room);return card;
}
function initVoting(){
 const options=$('poll-options');
 function option(value=''){if(options.children.length>=4)return;const row=node('div','poll-option-input'),input=node('input'),label=node('label'),remove=node('button','','삭제');input.required=true;input.maxLength=300;input.value=value;remove.type='button';label.append(node('span'),input);row.append(label,remove);remove.onclick=()=>{row.remove();renumber();};options.append(row);renumber();}
 function renumber(){[...options.children].forEach((row,i)=>{row.querySelector('span').textContent=String.fromCharCode(65+i);const input=row.querySelector('input');input.setAttribute('aria-label',String.fromCharCode(65+i)+' 선택지');input.placeholder='선택할 대안을 입력하세요';row.querySelector('button').disabled=options.children.length<=2;});$('add-poll-option').disabled=options.children.length>=4;}
 $('add-poll-option').onclick=()=>option();$('dismiss-poll').onclick=()=>$('poll-dialog').close();
 $('new-poll').onclick=()=>{
  $('poll-error').textContent='';options.replaceChildren();option();option();$('poll-passage').value=$('message').value;const picked=[...document.querySelectorAll('[data-mention]:checked')].map(e=>e.dataset.mention);$('poll-team').replaceChildren();
  for(const a of snapshot.config.agents){const label=node('label','inline mention-choice');label.dataset.agent=a;const check=node('input');check.type='checkbox';check.dataset.pollAgent=a;check.checked=picked.includes(a);label.append(check,node('span','',a.toUpperCase()));$('poll-team').append(label);} $('poll-dialog').dataset.tid=selected;$('poll-dialog').showModal();
 };
 $('poll-form').onsubmit=async e=>{e.preventDefault();$('start-poll').disabled=true;try{const r=await api('/api/poll',{threadId:$('poll-dialog').dataset.tid,passage:$('poll-passage').value,options:[...options.querySelectorAll('input')].map(i=>i.value),mentions:[...document.querySelectorAll('[data-poll-agent]:checked')].map(i=>i.dataset.pollAgent),minutes:Number($('poll-minutes').value)});$('poll-dialog').close();agent='';$('search').value='';await pollOnce();notify('비밀 투표를 시작했습니다. 기존 입력창의 초안은 유지됩니다.');}catch(e){$('poll-error').textContent=e.message;}finally{$('start-poll').disabled=false;}};
}
