/* Original SVG office scene. No game engine, remote assets, or model calls. */
'use strict';
window.AgentOffice=class AgentOffice {
 constructor(root,openChat,requestWork,getMessages=()=>[]){
  this.getMessages=getMessages;this.speechQueue=[];this.speechSeen=new Set();this.speechScope=null;this.speechUntil=0;
  this.root=root;this.openChat=openChat;this.requestWork=requestWork;this.actors=new Map();this.chosen='';this.layoutKey='';this.visible=false;this.raf=0;this.panelOpen=false;
  this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};this.el=el;
  const heading=el('div','office-heading');const title=el('div','');title.append(el('small','office-eyebrow','YOUR TEAM, IN PLACE'),el('h2','','에이전트 스튜디오'));
  this.connection=el('span','office-connection');heading.append(title,this.connection);
  this.caption=el('p','office-caption');
  this.phaseBar=el('div','office-phases');this.phaseBar.setAttribute('aria-label','토론 진행 단계');
  for(const [zone,label] of [['work','1 · 공용 연구실'],['meeting','2 · 토론실'],['synthesis','3 · 조율실'],['review','4 · 검토실']]){const step=el('span','office-phase',label);step.dataset.zone=zone;this.phaseBar.append(step);}
  const body=el('div','office-body');this.viewport=el('div','office-viewport');this.svg=this.s('svg',{viewBox:'0 0 1120 700','aria-label':'에이전트 가상사무실',role:'group'});this.viewport.append(this.svg);
  const legend=el('div','office-legend');for(const [color,text] of [['#84c9df','① 독립 의견 준비'],['#deb989','② 토론·반론'],['#b3a6eb','③ 최종 검토'],['#8abaaa','대기']]){const item=el('span','');const dot=el('i','');dot.style.background=color;item.append(dot,document.createTextNode(text));legend.append(item);}this.viewport.append(legend);
  this.bubble=el('button','office-speech');this.bubble.type='button';this.bubble.hidden=true;this.bubble.setAttribute('aria-label','최근 발언 · 대화에서 전체 보기');this.bubble.onclick=()=>{if(this.speaking)this.openChat(this.speaking.tid,'');};this.viewport.append(this.bubble);
  this.chat=el('section','office-chat');this.chat.setAttribute('aria-label','사무실 대화창');
  const chatHead=el('div','office-chat-heading');chatHead.append(el('strong','','팀 대화'));
  this.chatToggle=el('button','','접기');this.chatToggle.type='button';this.chatToggle.setAttribute('aria-expanded','true');chatHead.append(this.chatToggle);
  this.chatLog=el('div','office-chat-log');this.chatLog.setAttribute('aria-label','최근 공개 메시지 50개');this.chatLog.tabIndex=0;
  this.chatLatest=el('button','office-chat-latest','새 메시지 · 아래로');this.chatLatest.type='button';this.chatLatest.hidden=true;this.chatLatest.onclick=()=>{this.chatLog.scrollTop=this.chatLog.scrollHeight;this.chatLatest.hidden=true;};
  this.chatLog.onscroll=()=>{if(this.chatLog.scrollHeight-this.chatLog.scrollTop-this.chatLog.clientHeight<30)this.chatLatest.hidden=true;};
  this.chatToggle.onclick=()=>{const folded=!this.chatLog.hidden;this.chatLog.hidden=folded;this.chatLatest.hidden=true;this.chatToggle.textContent=folded?'펼치기':'접기';this.chatToggle.setAttribute('aria-expanded',String(!folded));this.chat.classList.toggle('folded',folded);this.clampChat();};
  this.chat.append(chatHead,this.chatLog,this.chatLatest);this.viewport.append(this.chat);
  this.enableChatLayout(chatHead);
  this.initMapControls();
  this.resizeObserver=new ResizeObserver(()=>{if(this.room!=='vote'&&this.camera&&!this.cameraOverview){const c=this.camera;this.camera=this.cameraAround(c.x+c.w/2,c.y+c.h/2,c.w);this.applyCamera();}this.positionSpeech();this.clampChat();});this.resizeObserver.observe(this.viewport);
  this.panel=el('div','office-panel');this.panel.setAttribute('aria-label','에이전트 상세');this.panel.hidden=true;this.panel.tabIndex=-1;body.append(this.viewport,this.panel);
  this.roster=el('div','office-roster');this.roster.setAttribute('aria-label','사무실 에이전트');
  const foot=el('p','office-footnote','실제 작업 상태를 공간으로 표현합니다. 위치는 시각화이며 캐릭터를 눌러 공유 내용을 확인할 수 있습니다.');
  root.append(heading,this.caption,this.phaseBar,body,this.roster,foot);
  this.room='work';this.pollId='';this.rooms=el('div','office-rooms');this.workRoom=el('button','','업무 사무실');this.voteRoom=el('button','','투표실');this.pollSelect=el('select','');this.pollSelect.setAttribute('aria-label','투표실에서 볼 투표');
  for(const [button,room] of [[this.workRoom,'work'],[this.voteRoom,'vote']]){button.type='button';button.onclick=()=>{this.room=room;this.panelOpen=false;this.update(this.snapshot,this.selected,this.offline,this.visible);};}
  this.pollSelect.onchange=()=>{this.pollId=this.pollSelect.value;this.update(this.snapshot,this.selected,this.offline,this.visible);};this.rooms.append(this.workRoom,this.voteRoom,this.pollSelect);root.prepend(this.rooms);
  this.expandButton=el('button','office-expand','⛶ 전체화면');this.expandButton.type='button';this.expandButton.setAttribute('aria-pressed','false');this.expandButton.onclick=()=>this.expandOffice(!this.expanded);this.rooms.append(this.expandButton);

  root.addEventListener('keydown',e=>{if(e.key==='Escape'){if(this.panelOpen){e.preventDefault();this.closePanel();}else if(this.expanded){e.preventDefault();this.expandOffice(false);}}});
  document.addEventListener('visibilitychange',()=>{this.root.classList.toggle('office-paused',document.hidden||!this.visible);if(document.hidden)this.stop();else if(this.visible)this.animate();});
 }
 s(tag,attrs={},text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
 point(x,y,z=0){return this.room!=='vote'&&this.mapRooms?[x,y-z]:[520+(x-y)*.87,92+(x+y)*.43-z];}
 poly(parent,points,fill,stroke){parent.append(this.s('polygon',{points:points.map(p=>this.point(...p).join(',')).join(' '),fill,stroke:stroke||fill,'stroke-width':1}));}
 box(g,x,y,w,d,h,top='#6d8091',left='#405463',right='#526877',base=0){
  this.poly(g,[[x,y+d,base],[x+w,y+d,base],[x+w,y+d,h+base],[x,y+d,h+base]],left);
  this.poly(g,[[x+w,y,base],[x+w,y+d,base],[x+w,y+d,h+base],[x+w,y,h+base]],right);
  this.poly(g,[[x,y,h+base],[x+w,y,h+base],[x+w,y+d,h+base],[x,y+d,h+base]],top);
 }
 text(g,x,y,z,text,color='#b0c2d0',size=12){const [px,py]=this.point(x,y,z);g.append(this.s('text',{x:px,y:py,fill:color,'font-size':size,'font-family':'Segoe UI, Malgun Gothic, sans-serif','letter-spacing':1},text));}
 plant(g,x,y){this.box(g,x,y,15,15,18,'#718b85','#3c5657','#526c67');const [px,py]=this.point(x+7,y+7,18);for(const [dx,dy,rot] of [[-6,-12,-35],[6,-18,30],[-2,-24,-10]])g.append(this.s('ellipse',{cx:px+dx,cy:py+dy,rx:6,ry:15,fill:dy===-24?'#79aa92':'#4c826d',transform:`rotate(${rot} ${px+dx} ${py+dy})`}));}
 desk(g,x,y){
  this.box(g,x+4,y+3,5,36,30,'#657a86','#344b59','#405969');this.box(g,x+75,y+3,5,36,30,'#657a86','#344b59','#405969');
  this.box(g,x,y,86,44,5,'#a5aaa6','#6f8182','#829393',30);
  this.box(g,x+32,y+10,20,10,2,'#384f62','#263a4c','#304659',35);
  this.box(g,x+40,y+6,4,6,15,'#566c78','#354b5a','#496373',35);
  this.box(g,x+24,y+5,35,3,23,'#506b7e','#314d62','#486880',48);
  this.poly(g,[[x+27,y+8,51],[x+57,y+8,51],[x+57,y+8,69],[x+27,y+8,69]],'#86cce3');
  this.box(g,x+28,y+27,29,9,1,'#546c7b','#405461','#405461',35);
  this.box(g,x+68,y+23,7,7,9,'#e0c9a4','#ab9b83','#c8b28d',35);
  this.box(g,x+28,y+54,27,22,23,'#476777','#2a4557','#37576b');this.box(g,x+28,y+73,27,5,21,'#557b8b','#395667','#426474',20);
 }
 build(names){this.buildMap(names);}
 color(name,i){return {claude:'#efb491',codex:'#8edcff',cursor:'#c2aeff'}[name]||['#94d2b5','#e7ca81','#d4a6c3','#99bddf'][i%4];}
 createActor(name,i){
  const color=this.color(name,i),g=this.s('g',{class:'office-actor',role:'button',tabindex:0,'data-agent':name,'aria-label':name.toUpperCase()});
  g.append(this.s('ellipse',{cx:0,cy:3,rx:15,ry:7,fill:'#071726',opacity:.55}));const figure=this.s('g',{class:'office-figure'});
  figure.append(this.s('path',{d:'M-9 -7 L-10 1 L-3 1 L-1 -8 M3 -8 L4 1 L11 1 L10 -8',stroke:'#adc1cc','stroke-width':5,'stroke-linecap':'round',fill:'none'}));
  figure.append(this.s('rect',{x:-14,y:-28,width:28,height:24,rx:10,fill:color,stroke:'#d9ebef','stroke-width':.7}));
  figure.append(this.s('path',{d:'M-13 -22 L-19 -11 M13 -22 L19 -11',stroke:color,'stroke-width':6,'stroke-linecap':'round'}));
  figure.append(this.s('rect',{x:-16,y:-51,width:32,height:27,rx:12,fill:'#e4ebea',stroke:'#8299a8'}));
  figure.append(this.s('rect',{x:-12,y:-45,width:24,height:13,rx:6,fill:'#233c50'}));
  figure.append(this.s('circle',{cx:-5,cy:-39,r:2,fill:color}),this.s('circle',{cx:5,cy:-39,r:2,fill:color}));
  if(i%3===0)figure.append(this.s('path',{d:'M-19 -39 Q-23 -58 0 -58 Q23 -58 19 -39',fill:'none',stroke:color,'stroke-width':4}));
  else if(i%3===1)figure.append(this.s('path',{d:'M0 -52 L0 -59',stroke:color,'stroke-width':2}),this.s('circle',{cx:0,cy:-61,r:3,fill:color}));
  else figure.append(this.s('path',{d:'M-11 -51 L-15 -59 L-2 -52 M4 -52 L15 -59 L12 -50',fill:color}));
  g.append(figure);const activity=this.s('g',{class:'office-activity','aria-hidden':'true'});for(let n=0;n<3;n++)activity.append(this.s('circle',{cx:-7+n*7,cy:-70,r:2,fill:color,class:'office-activity-dot'}));g.append(activity);const label=this.s('g',{class:'office-nameplate'});label.append(this.s('rect',{x:-52,y:9,width:104,height:33,rx:8,fill:'#102537',stroke:'#36556a'}));label.append(this.s('text',{x:0,y:23,'text-anchor':'middle',fill:color,'font-size':10,'font-weight':700},name.toUpperCase()));const status=this.s('text',{x:0,y:35,'text-anchor':'middle',fill:'#b0c4d2','font-size':8});label.append(status);g.append(label);
  const pick=()=>{this.chosen=name;this.followAgent=name;this.mapFollow=true;this.followMap();this.panelOpen=true;this.details();this.selectActor();this.panel.focus({preventScroll:true});};g.addEventListener('click',pick);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});this.actorLayer.append(g);
  this.actors.set(name,{name,i,color,g,status,position:null,path:[],state:null});
 }
 ballotState(name){
  const p=this.poll,base={poll:p,round:null,job:null,zone:'lounge',label:'미참여',description:'이 투표에 참여하지 않은 에이전트입니다.'};
  if(!p)return {...base,label:'투표 없음',description:'대화의 독립 비밀 투표 버튼으로 시작해 주세요.'};
  const b=p.ballots.find(b=>b.agent===name);if(!b)return base;
  if(p.status==='cancelled')return {...base,label:'투표 취소',description:'취소된 투표의 선택과 근거는 공개하지 않습니다.'};
  if(p.status==='active')return {...base,zone:'work',label:this.offline?'상태 미확인':({done:'제출 · 비공개',running:'판단 중',pending:'실행 대기',failed:'실패'}[b.status]||'대기'),description:'서로의 답을 보지 않고 판단합니다. 마감 후 선택과 근거를 함께 공개합니다.',unknown:this.offline,job:!this.offline&&b.status==='running'?b:null};
  const index=p.options.findIndex(o=>o.id===b.choice);
  return {...base,zone:index<0?'vote-other':'vote-'+index,label:b.choice==='ABSTAIN'?'기권':index>=0?b.choice+'안 선택':b.status==='failed'?'실패':'미응답',description:b.reply||b.error||'마감까지 표를 제출하지 않았습니다.',ballot:b};
 }
 buildVote(names){
  this.svg.replaceChildren();this.actors.clear();this.corridor=245;this.svg.setAttribute('viewBox','-55 0 1190 750');
  const floor=this.s('g');this.svg.append(floor);this.box(floor,0,0,620,570,18,'#273c4c','#101d2c','#1a2d3c',-18);
  this.box(floor,0,0,620,7,80,'#587789','#2b4558','#3b596b');this.box(floor,0,7,7,563,80,'#4d7181','#293f51','#355464');
  this.text(floor,225,9,36,'INDEPENDENT BALLOT','#a5dfed',19);
  for(let x=25;x<620;x+=50)this.poly(floor,[[x,9,0],[x+1,9,0],[x+1,570,0],[x,570,0]],'#324958');
  for(let y=30;y<570;y+=50)this.poly(floor,[[8,y,0],[620,y,0],[620,y+1,0],[8,y+1,0]],'#324958');
  const options=this.poll?.options||[{id:'A'},{id:'B'}];
  this.voteLabels=[];options.forEach((o,i)=>{const x=36+(i%2)*290,y=280+Math.floor(i/2)*130,color=['#375f69','#564b70','#5b5840','#405e58'][i];this.box(floor,x,y,255,115,2,color,color,color);this.text(floor,x+12,y+15,4,o.id+' / 선택 구역','#e0edf5',15);const [px,py]=this.point(x+155,y+15,4);const label=this.s('text',{x:px,y:py,fill:'#e0edf5','font-size':12});floor.append(label);this.voteLabels.push(label);});
  names.forEach((name,i)=>{const x=60+i*175;this.desk(floor,x,60);this.box(floor,x-8,52,4,115,43,'#607b8c','#334f63','#446277');this.text(floor,x+3,197,2,'PRIVATE','#97c8d9',10);});
  this.text(floor,42,556,3,'기권 · 미응답 · 미참여','#b0c9d9',11);this.plant(floor,590,60);
  this.actorLayer=this.s('g');this.svg.append(this.actorLayer);names.forEach((name,i)=>this.createActor(name,i));
 }
 pipelineState(name){
  const s=this.snapshot,p=(s.pipelines||[]).find(p=>(!this.selected||p.tid===this.selected)&&p.status==='active')||(s.pipelines||[]).find(p=>p.tid===this.selected);
  if(!p)return null;const newer=(s.collaboration||[]).some(r=>r.tid===p.tid&&r.created>p.created);if(newer&&p.status!=='active')return null;
  const base={pipeline:p,round:null,job:null,zone:'lounge',label:'역할 작업 대기',description:'지정된 순서로 다음 단계를 기다립니다.'};
  if(this.offline)return {...base,label:'상태 미확인',unknown:true};
  if(!Object.values(p.roles).flat().includes(name))return {...base,label:'미참여',description:'이번 역할 작업의 담당자가 아닙니다.'};
  const task=p.tasks.find(t=>t.agent===name&&t.status==='running');
  if(task)return {...base,job:task,zone:task.phase==='verify'?'review':['plan','consult'].includes(task.phase)?'meeting':'work',label:({prepare:'작업 준비',plan:'계획 중',implement:'구현 중',verify:'검증 중',inspect:'읽기 전용 질의 중',consult:'질문 답변 중'})[task.phase],description:'분리된 작업 사본에서 담당 단계를 진행합니다.'};
  if(p.status!=='active')return {...base,label:{completed:'작업 완료',blocked:'작업 보류',cancelled:'작업 취소'}[p.status],description:p.reason};
  return base;
 }
 stateFor(name){
  if(this.room==='vote')return this.ballotState(name);
  const pipelineState=this.pipelineState(name);if(pipelineState)return pipelineState;
  const s=this.snapshot,rounds=(s.collaboration||[]).filter(r=>!this.selected||r.tid===this.selected),running=(s.jobs||[]).find(j=>j.agent===name&&j.status==='running'&&(!this.selected||j.tid===this.selected)),r=this.selected?rounds[0]:rounds.find(r=>r.id===running?.round_id)||rounds.find(r=>r.status==='active'&&r.team.includes(name))||rounds.find(r=>r.team.includes(name));
  const jobs=(s.jobs||[]).filter(j=>j.agent===name&&(!this.selected||j.tid===this.selected)&&(!r||j.round_id===r.id));
  const base={round:r,job:null,zone:'lounge',label:'대기',description:'현재 실행 중인 작업이 없습니다.'};
  if(this.offline||!s.connected)return {...base,label:'상태 미확인',description:'연결이 끊겨 최신 작업 상태를 확인할 수 없습니다.',unknown:true};
  if(s.config?.mode==='demo')return {...base,label:'데모',description:'데모 화면입니다. 실제 에이전트를 실행하지 않습니다.'};
  if(this.selected&&r&&!r.team.includes(name))return {...base,label:'미참여',description:'이 요청에 멘션되지 않은 에이전트입니다.'};
  const job=jobs.find(j=>j.status==='running');
  if(job){const zone=this.stageZone(job.stage);return {...base,job,zone,label:zone==='review'?'검토 중':zone==='synthesis'?'통합안 조율 중':zone==='meeting'?'쟁점 확인 중':'작업 중',description:zone==='review'?'같은 후보안을 검토하고 있습니다.':zone==='meeting'?'전달된 질문 또는 반대 쟁점을 확인하고 있습니다.':'CLI를 실행해 요청을 분석하고 있습니다. 응답 생성을 기다리는 시간을 포함합니다.'};}
  const vote=r?.votes?.find(v=>v.agent===name&&v.version===r.version&&v.proposal_hash===r.digest);
  if(r?.status==='active'&&vote)return {...base,zone:'review',label:vote.decision==='APPROVE'?'승인 완료':'수정 요청',description:vote.decision==='APPROVE'?'현재 후보를 승인했습니다. 동료의 검토 완료를 기다립니다.':'후보에 반대 의견을 제출했습니다. 수정안이 필요합니다.'};
  if(!s.config?.automatic)return {...base,label:'관찰 모드',description:'자동 실행이 꺼져 있습니다.'};
  if(jobs.some(j=>j.status==='pending'))return {...base,zone:this.stageZone(jobs.find(j=>j.status==='pending').stage),label:'실행 대기',description:'작업이 예약되어 있습니다. 아직 실행을 시작하지 않았습니다.'};
  if(r?.status==='active')return {...base,zone:this.stageZone(r.stage),label:'동료 대기',description:'자신의 단계를 마치고 동료의 결과를 기다립니다.'};
  if(r?.status==='agreed')return {...base,label:'협업 완료',description:'결과가 작성되었습니다. 교차 검토 여부는 최종 결과에 표시됩니다.'};
  if(r?.status==='blocked')return {...base,label:'협업 보류',description:'실패 또는 미해결 쟁점으로 요청이 보류되었습니다.'};
  return base;
 }
 target(actor,zone){const i=actor.i;
  if(this.room==='vote'){
   if(zone==='work')return {x:102+i*175,y:164};
   if(zone.startsWith('vote-')&&zone!=='vote-other'){const n=Number(zone.slice(5));const peers=[...this.actors.values()].filter(a=>this.ballotState(a.name).zone===zone),slot=peers.findIndex(a=>a.name===actor.name);return {x:72+(n%2)*290+slot*72,y:350+Math.floor(n/2)*130};}
   return {x:165+i*95,y:560};
  }
  if(this.mapRooms)return this.mapTarget(actor,zone);
  if(zone==='work')return {x:90+(i%2)*133,y:160+Math.floor(i/2)*115};
  if(zone==='meeting')return {x:415+(i%3)*56,y:199+Math.floor(i/3)*46};
  if(zone==='review')return {x:420+(i%3)*54,y:this.corridor+152+Math.floor(i/3)*35};
  return {x:74+(i%3)*71,y:this.corridor+145+Math.floor(i/3)*35};
 }
 update(snapshot,selected,offline,visible){
  this.snapshot=snapshot;this.selected=selected;this.offline=offline;this.visible=visible;this.root.classList.toggle('office-paused',!visible||document.hidden);
  this.updateSpeech();
  if(!visible){if(this.expanded)this.expandOffice(false);this.stop();return;}
  const polls=(snapshot.polls||[]).filter(p=>!selected||p.tid===selected);this.poll=polls.find(p=>p.id===this.pollId)||polls[0];this.pollId=this.poll?.id||'';
  if(document.activeElement!==this.pollSelect){this.pollSelect.replaceChildren();for(const p of polls){const option=this.el('option','',p.passage.slice(0,45)+(p.status==='active'?' · 진행 중':' · 종료'));option.value=p.id;option.selected=p.id===this.pollId;this.pollSelect.append(option);}}this.pollSelect.hidden=this.room!=='vote'||!polls.length;
  this.workRoom.setAttribute('aria-pressed',String(this.room==='work'));this.voteRoom.setAttribute('aria-pressed',String(this.room==='vote'));
  const names=[...new Set(snapshot.config?.agents||[])],key=JSON.stringify([names,this.room,this.room==='vote'?this.poll?.id:null]);
  if(key!==this.layoutKey){if(this.room==='vote')this.buildVote(names);else this.build(names);this.layoutKey=key;}
  if(!names.includes(this.chosen))this.chosen=names[0]||'';
  this.connection.textContent=offline||!snapshot.connected?'● 연결 확인 필요':snapshot.config?.mode==='demo'?'○ DEMO':'● LIVE';
  this.connection.dataset.live=String(!offline&&!!snapshot.connected);
  const t=(snapshot.threads||[]).find(t=>t.threadId===selected);this.caption.textContent=(t?'현재 채널 · '+t.threadName:'전체 채널의 활동')+' / '+names.length+'명의 에이전트';
  this.root.classList.toggle('voting-room',this.room==='vote');this.root.querySelector('.office-heading h2').textContent=this.room==='vote'?'독립 투표실':'에이전트 캠퍼스';
  this.root.querySelector('.office-legend').hidden=this.room==='vote';
  this.root.querySelector('.office-footnote').textContent=this.room==='vote'?'공개 전에는 선택이 숨겨집니다. 공개 후 캐릭터를 선택하면 주장과 근거를 볼 수 있습니다.':'실제 작업 상태를 공간으로 표현합니다. 위치는 시각화이며 캐릭터를 눌러 공유 내용을 확인할 수 있습니다.';
  if(this.room==='vote'){
   this.caption.textContent=this.poll?(this.poll.demo?'데모 · ':'')+(this.poll.status==='active'?'비밀 투표 · 선택은 공개 전까지 숨겨집니다.':this.poll.status==='revealed'?'투표 공개 · 선택 구역의 캐릭터를 눌러 근거를 확인하세요.':'취소 · 선택 비공개'):'투표실 · 대화에서 비밀 투표를 시작해 주세요.';
   this.voteLabels.forEach((label,i)=>{label.textContent=this.poll?.status==='revealed'?(this.poll.counts[this.poll.options[i].id]+'표'):'비공개';});
  }
  for(const actor of this.actors.values()){
   const state=this.stateFor(actor.name),old=actor.state;actor.state=state;actor.status.textContent=state.label;actor.g.setAttribute('aria-label',actor.name.toUpperCase()+' · '+state.label);actor.g.classList.toggle('unknown',!!state.unknown);actor.g.classList.toggle('working',!!state.job&&!state.unknown);actor.g.dataset.activity=state.job?state.zone:'idle';
   const target=this.target(actor,state.zone);
   if(!actor.position){actor.position=target;this.place(actor);}
   else if(state.unknown){actor.path=[];actor.g.classList.remove('moving');}
   else if(old?.zone!==state.zone||old?.unknown){
    if(this.room!=='vote'&&this.mapRooms)actor.path=this.mapRoute(actor.position,target);
    else actor.path=[target];
    if(this.reduced.matches){actor.position=target;actor.path=[];this.place(actor);}
   }
  }
  this.roster.replaceChildren();for(const actor of this.actors.values()){
   const b=this.el('button','office-person');b.type='button';b.style.setProperty('--person',actor.color);b.append(this.el('span','office-person-dot','●'),this.el('strong','',actor.name.toUpperCase()),this.el('small','',actor.state.label));b.onclick=()=>{this.chosen=actor.name;this.followAgent=actor.name;this.mapFollow=true;this.followMap();this.panelOpen=true;this.details();this.selectActor();this.panel.focus({preventScroll:true});};b.dataset.agent=actor.name;this.roster.append(b);
  }
  if(!names.length)this.caption.textContent='연결 설정에서 에이전트를 선택하면 사무실에 입장합니다.';
  this.mapControls.hidden=this.room==='vote';this.mini.hidden=this.room==='vote';this.updateZones();this.followMap();this.selectActor();this.details();this.advanceSpeech();this.animate();
 }
 place(actor){const [x,y]=this.point(actor.position.x,actor.position.y);actor.g.setAttribute('transform',`translate(${x} ${y})`);if(this.speaking?.sendingAgentName===actor.name)this.positionSpeech();this.updateMiniActors();}
 selectActor(){for(const a of this.actors.values())a.g.classList.toggle('selected',a.name===this.chosen);for(const b of this.roster.children)b.setAttribute('aria-pressed',String(b.dataset.agent===this.chosen));}
 details(){
  this.panel.hidden=!this.panelOpen;if(!this.panelOpen)return;
  this.panel.replaceChildren();const close=this.el('button','office-detail-close','닫기 ×');close.type='button';close.onclick=()=>this.closePanel();this.panel.append(close);const actor=this.actors.get(this.chosen);if(!actor){this.panel.append(this.el('p','','등록된 에이전트가 없습니다.'));return;}
  const state=actor.state;this.panel.style.setProperty('--person',actor.color);
  this.panel.append(this.el('small','office-eyebrow','AGENT FOCUS'),this.el('h3','',actor.name.toUpperCase()),this.el('span','office-state',state.label),this.el('p','office-description',state.description));
  if(this.requestWork&&this.room!=='vote'){const tid=this.selected||state.pipeline?.tid||state.round?.tid;const work=this.el('button','office-open-chat','이 에이전트에게 작업 요청');work.type='button';work.disabled=!tid||this.offline||this.snapshot.config.mode==='demo';work.onclick=()=>this.requestWork(tid,actor.name);this.panel.append(work);}
  if(state.job?.started){const elapsed=this.el('p','office-elapsed');elapsed.dataset.start=state.job.started;this.panel.append(elapsed);this.elapsed();}
  if(state.pipeline){
   const p=state.pipeline;this.panel.append(this.el('p','office-excerpt','역할: '+(p.mode==='inspect'?'읽기 전용 질의':p.mode==='single'?'구현 · 자체 검토':Object.entries(p.roles).filter(([k,v])=>v.includes(actor.name)).map(([k])=>({plan:'계획',implement:'구현',verify:'검증'})[k]).join(' · '))));
   const event=[...p.events].reverse().find(e=>e.sender===actor.name);this.panel.append(this.el('p','office-excerpt',event?.content||'아직 공유된 작업 결과가 없습니다.'));const button=this.el('button','office-open-chat','대화에서 작업 보기 →');button.onclick=()=>this.openChat(p.tid,'');this.panel.append(button);return;
  }
  if(this.room==='vote'){
   if(this.poll){for(const o of this.poll.options){const line=this.el('p','office-poll-option');line.append(this.el('strong','',o.id),document.createTextNode(o.text));this.panel.append(line);}}
   if(state.ballot?.reason){this.panel.append(this.el('h4','','판단 근거'),this.el('p','',state.ballot.reason),this.el('h4','','우려 · 불확실성'),this.el('p','',state.ballot.concern));}
   else this.panel.append(this.el('p','office-ballot-help',this.poll?.status==='active'?'중간 선택·근거는 모두에게 비공개입니다.':'득표수는 정답이나 실행 승인이 아닙니다.'));
   const button=this.el('button','office-open-chat','대화에서 전체 투표 보기 →');button.type='button';button.onclick=()=>this.openChat(this.poll?.tid||this.selected,'');button.disabled=!this.poll;this.panel.append(button);return;
  }
  this.panel.append(this.el('div','office-rule'),this.el('small','office-eyebrow','최근 공유 내용'));
  const events=state.round?.events||[],event=[...events].reverse().find(e=>e.sender===actor.name);
  const text=event?.content||'이 요청에서 아직 공유한 내용이 없습니다.';this.panel.append(this.el('p','office-excerpt',text.length>440?text.slice(0,440)+'…':text));
  const button=this.el('button','office-open-chat','대화에서 자세히 보기 →');button.type='button';button.onclick=()=>this.openChat(state.round?.tid||this.selected,actor.name);button.disabled=!state.round?.tid&&!this.selected;this.panel.append(button);
 }
 showWholeMap(){if(!this.world||this.room==='vote')return;this.mapFollow=false;this.cameraOverview=true;this.camera={x:0,y:0,w:this.world.w,h:this.world.h};this.roomJump.value='';this.applyCamera();}
 expandOffice(expanded){this.expanded=expanded;this.root.classList.toggle('office-expanded',expanded);this.expandButton.textContent=expanded?'전체화면 닫기 · Esc':'⛶ 전체화면';this.expandButton.setAttribute('aria-pressed',String(expanded));if(expanded){if(this.mapFollow)this.followMap();else this.showWholeMap();this.expandButton.focus({preventScroll:true});}this.positionSpeech();this.clampChat();}
 initMapControls(){
  this.mapControls=this.el('div','office-map-controls');this.mapControls.setAttribute('aria-label','맵 이동과 확대');
  for(const [label,action] of [['−',()=>this.zoomMap(.8)],['+',()=>this.zoomMap(1.25)],['전체 맵',()=>this.showWholeMap()]]){const b=this.el('button','',label);b.type='button';b.setAttribute('aria-label',label==='−'?'맵 축소':label==='+'?'맵 확대':label);b.onclick=action;this.mapControls.append(b);}
  this.followButton=this.el('button','','에이전트 따라가기');this.followButton.type='button';this.mapFollow=true;this.followButton.onclick=()=>{this.mapFollow=!this.mapFollow;this.followAgent='';this.followMap();this.applyCamera();};
  this.roomJump=this.el('select','');this.roomJump.setAttribute('aria-label','이동할 방');this.roomJump.onchange=()=>{this.mapFollow=false;this.focusRoom(this.roomJump.value);};this.mapControls.append(this.followButton,this.roomJump);this.viewport.prepend(this.mapControls);
  this.mini=this.s('svg',{class:'office-minimap',viewBox:'0 0 2350 1180',role:'img','aria-label':'전체 맵 · 클릭하면 해당 위치로 이동'});this.viewport.append(this.mini);
  this.mini.addEventListener('pointerdown',e=>{const r=this.mini.getBoundingClientRect();this.mapFollow=false;this.camera.x=(e.clientX-r.left)/r.width*this.world.w-this.camera.w/2;this.camera.y=(e.clientY-r.top)/r.height*this.world.h-this.camera.h/2;this.applyCamera();});
  this.svg.setAttribute('tabindex','0');this.svg.setAttribute('aria-label','에이전트 캠퍼스 · 드래그 또는 방향키 이동, 더하기 빼기로 확대 축소');
  this.svg.addEventListener('wheel',e=>{if(this.room==='vote')return;e.preventDefault();this.mapFollow=false;this.zoomMap(e.deltaY<0?1.12:.89);},{passive:false});
  this.svg.addEventListener('pointerdown',e=>{
   if(this.room==='vote'||e.target.closest('.office-actor')||e.button!==0)return;
   e.preventDefault();this.mapFollow=false;this.svg.setPointerCapture(e.pointerId);const start={x:e.clientX,y:e.clientY,cx:this.camera.x,cy:this.camera.y},scale=this.svg.getScreenCTM().a;
   const move=ev=>{this.camera.x=start.cx-(ev.clientX-start.x)/scale;this.camera.y=start.cy-(ev.clientY-start.y)/scale;this.applyCamera();};
   const end=()=>{this.svg.removeEventListener('pointermove',move);this.svg.removeEventListener('pointerup',end);this.svg.removeEventListener('pointercancel',end);this.svg.removeEventListener('lostpointercapture',end);};this.svg.addEventListener('pointermove',move);this.svg.addEventListener('pointerup',end);this.svg.addEventListener('pointercancel',end);this.svg.addEventListener('lostpointercapture',end);
  });
  this.svg.addEventListener('keydown',e=>{if(e.target!==this.svg||this.room==='vote')return;if(['+','=','-'].includes(e.key)){e.preventDefault();this.mapFollow=false;this.zoomMap(e.key==='-'?.8:1.25);}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();this.mapFollow=false;this.camera.x+=(e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0)*80;this.camera.y+=(e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0)*80;this.applyCamera();}});
 }
 mapRect(g,x,y,w,h,fill,extra={}){const r=this.s('rect',{x,y,width:w,height:h,fill,rx:6,...extra});g.append(r);return r;}
 buildMap(names){
  this.svg.replaceChildren();this.actors.clear();this.mapRooms=new Map();this.zoneLayers=new Map();this.world={w:1680,h:1680};this.followRoom='';
  this.mini.setAttribute('viewBox','0 0 1680 1680');
  const g=this.s('g');this.svg.append(g);
  this.mapRect(g,20,20,1640,1640,'#77958a',{rx:140});
  this.mapRect(g,58,60,1560,1550,'#e8e2d4',{rx:110});
  // An open atrium with circulation on both sides, rather than a grid of rooms.
  this.mapRect(g,492,85,100,1470,'#f4eee2',{rx:35});this.mapRect(g,976,85,95,1470,'#f4eee2',{rx:35});
  this.mapRect(g,510,503,540,95,'#f4eee2',{rx:40});this.mapRect(g,510,1053,540,95,'#f4eee2',{rx:40});
  const center=this.s('path',{d:'M650 625 Q590 625 590 690 L590 915 Q590 1000 680 1000 L888 1000 Q957 1000 957 920 L957 690 Q957 625 880 625 Z',fill:'#d4ddd1'});g.append(center);
  g.append(this.s('ellipse',{cx:772,cy:810,rx:130,ry:105,fill:'#b1c5b1'}));
  this.mapRect(g,689,765,164,75,'#efe8d5',{rx:37});this.mapRect(g,681,689,180,35,'#7faaa0',{rx:16});this.mapRect(g,681,875,180,35,'#7faaa0',{rx:16});
  g.append(this.s('text',{x:773,y:960,'text-anchor':'middle','font-size':19,'letter-spacing':3,fill:'#52766b'},'COMMON GROUND'));
  this.mapRooms.set('work',{id:'work',label:'RESEARCH STUDIO',subtitle:'공용 연구실',x:100,y:140,w:360,h:1330,side:'right',color:'#dce6dd',accent:'#799d8c'});
  for(const r of [
   {id:'lobby',label:'WELCOME',subtitle:'리셉션 · 로비',x:630,y:160,w:290,h:290,side:'bottom',color:'#e9deca',accent:'#b29c77'},
   {id:'meeting',label:'THE FORUM',subtitle:'토론 회의실',x:1100,y:150,w:445,h:440,side:'left',color:'#e9dfd0',accent:'#b29577'},
   {id:'synthesis',label:'IDEA LAB',subtitle:'조율 · 아이디어 룸',x:1110,y:710,w:435,h:330,side:'left',color:'#dce8e4',accent:'#719f97'},
   {id:'review',label:'REVIEW SUITE',subtitle:'최종 검토실',x:1100,y:1160,w:450,h:355,side:'left',color:'#e5e1ed',accent:'#9c95b5'},
   {id:'lounge',label:'COFFEE & REST',subtitle:'카페 · 라운지',x:620,y:1200,w:300,h:330,side:'top',color:'#e4dece',accent:'#91a186'}])this.mapRooms.set(r.id,r);
  const plant=(x,y,size=1)=>{g.append(this.s('ellipse',{cx:x,cy:y+5,rx:16*size,ry:9*size,fill:'#718a77',opacity:.3}));this.mapRect(g,x-12*size,y-8*size,24*size,25*size,'#bda98f',{rx:7});for(const [dx,dy,c] of [[-10,-16,'#668d71'],[10,-20,'#80a184'],[0,-32,'#9fbb95']])g.append(this.s('ellipse',{cx:x+dx*size,cy:y+dy*size,rx:13*size,ry:20*size,fill:c}));};
  const desk=(parent,x,y,w=130)=>{this.mapRect(parent,x+4,y+12,w,63,'#a7b3ac',{rx:12});this.mapRect(parent,x,y,w,60,'#faf8ee',{rx:12,stroke:'#c0c7be','stroke-width':2});this.mapRect(parent,x+w/2-27,y-17,54,37,'#445e69',{rx:5});this.mapRect(parent,x+w/2-22,y-13,44,26,'#a8cbd3',{rx:3});this.mapRect(parent,x+w/2-20,y+30,40,10,'#bbc8c8',{rx:3});};
  const chair=(parent,x,y,c)=>{parent.append(this.s('ellipse',{cx:x,cy:y+16,rx:22,ry:12,fill:'#70837b',opacity:.24}));this.mapRect(parent,x-19,y-5,38,35,c,{rx:14});this.mapRect(parent,x-20,y-16,40,18,c,{rx:8});};
  for(const r of this.mapRooms.values()){
   const room=this.s('g',{'data-room':r.id});g.append(room);const floor=this.s('g',{class:'office-zone'});room.append(floor);this.zoneLayers.set(r.id,floor);
   const round=r.id==='meeting'?65:r.id==='lounge'?46:22;
   this.mapRect(floor,r.x+5,r.y+15,r.w,r.h,'#a9b5ad',{rx:round});
   if(r.id==='synthesis')floor.append(this.s('path',{d:`M${r.x+45} ${r.y} H${r.x+r.w-20} Q${r.x+r.w} ${r.y} ${r.x+r.w} ${r.y+20} V${r.y+r.h-20} Q${r.x+r.w} ${r.y+r.h} ${r.x+r.w-20} ${r.y+r.h} H${r.x+20} Q${r.x} ${r.y+r.h} ${r.x} ${r.y+r.h-20} V${r.y+70} H${r.x+45} Z`,fill:r.color,stroke:'#a7bcb5','stroke-width':5}));
   else this.mapRect(floor,r.x,r.y,r.w,r.h,r.color,{rx:round,stroke:'#a7bcb5','stroke-width':5});
   // Back wall, side partitions and an open portal, with the front cut away.
   this.mapRect(room,r.x+round/2,r.y-22,r.w-round,24,'#adbbb7',{rx:6});this.mapRect(room,r.x+round/2,r.y-28,r.w-round,9,'#f9f6e9',{rx:4});
   if(['left','right'].includes(r.side)){
    const x=r.side==='left'?r.x:r.x+r.w;r.entry={x,y:r.y+r.h*.56};r.gate={x:r.side==='left'?1020:540,y:r.entry.y};
    this.mapRect(room,x-6,r.y+12,12,r.h*.56-49,'#a4b8b3',{rx:5});this.mapRect(room,x-6,r.entry.y+37,12,r.h*.44-49,'#a4b8b3',{rx:5});
    this.mapRect(g,Math.min(x,r.gate.x)-6,r.entry.y-37,Math.abs(x-r.gate.x)+12,74,'#f4eee2',{rx:10});
   }else{r.entry={x:r.x+r.w/2,y:r.side==='top'?r.y:r.y+r.h};r.gate={x:r.entry.x,y:r.side==='top'?1100:550};this.mapRect(g,r.entry.x-37,Math.min(r.entry.y,r.gate.y),74,Math.abs(r.entry.y-r.gate.y),'#f4eee2',{rx:12});}
   if(r.id==='work'){for(let row=0;row<6;row++){desk(room,r.x+25,r.y+85+row*200,140);chair(room,r.x+95,r.y+170+row*200,r.accent);}this.mapRect(room,r.x+r.w-105,r.y+55,65,60,'#9fb9a8',{rx:20});}
   else if(r.id==='meeting'){
    room.append(this.s('ellipse',{cx:r.x+r.w*.62,cy:r.y+r.h*.57,rx:116,ry:134,fill:'#cfbfa9'}));
    for(const dy of [130,220,310]){chair(room,r.x+180,r.y+dy,'#9c8a7c');chair(room,r.x+365,r.y+dy,'#9c8a7c');}
    this.mapRect(room,r.x+210,r.y+95,125,270,'#f7ecd9',{rx:55});this.mapRect(room,r.x+243,r.y+210,56,60,'#a1b8a8',{rx:20});
   }else if(r.id==='synthesis'){
    this.mapRect(room,r.x+210,r.y+55,170,115,'#f6f4e9',{rx:32});this.mapRect(room,r.x+240,r.y+30,108,62,'#94b9b5',{rx:6,stroke:'#e9efdf','stroke-width':5});chair(room,r.x+270,r.y+210,r.accent);chair(room,r.x+365,r.y+215,r.accent);
   }else if(r.id==='review'){
    desk(room,r.x+210,r.y+65,175);desk(room,r.x+210,r.y+205,175);chair(room,r.x+290,r.y+145,r.accent);chair(room,r.x+290,r.y+290,r.accent);
   }else if(r.id==='lobby'){
    this.mapRect(room,r.x+35,r.y+65,r.w-70,85,'#f5efe0',{rx:40});this.mapRect(room,r.x+55,r.y+77,r.w-110,30,'#8daa99',{rx:15});
   }else{
    this.mapRect(room,r.x+30,r.y+90,65,120,'#78978a',{rx:25});this.mapRect(room,r.x+190,r.y+90,65,120,'#78978a',{rx:25});room.append(this.s('ellipse',{cx:r.x+147,cy:r.y+180,rx:34,ry:44,fill:'#efe9d8'}));this.mapRect(room,r.x+28,r.y+270,245,35,'#b19e83',{rx:8});
   }
   room.append(this.s('text',{x:r.x+28,y:r.y+25,fill:'#38545a','font-size':19,'font-weight':700,'letter-spacing':1},r.label),this.s('text',{x:r.x+28,y:r.y+45,fill:'#5e7975','font-size':13},r.subtitle));
   plant(r.x+r.w-30,r.y+r.h-30,1.2);
  }
  for(const [x,y,z] of [[602,640,1.3],[945,640,1.4],[603,1010,1.4],[945,1010,1.2],[570,85,1.5],[1000,80,1.5],[770,1570,1.6]])plant(x,y,z);
  this.actorLayer=this.s('g');this.svg.append(this.actorLayer);names.forEach((name,i)=>this.createActor(name,i));
  this.roomJump.replaceChildren();const all=this.el('option','','방으로 이동');all.value='';this.roomJump.append(all);for(const r of this.mapRooms.values()){const o=this.el('option','',r.subtitle+' · '+r.label);o.value=r.id;this.roomJump.append(o);}
  this.buildMini();if(!this.camera)this.camera=this.cameraAround(400,850,900);this.applyCamera();
 }
 cameraAround(x,y,w){this.cameraOverview=false;const bounds=this.svg.getBoundingClientRect(),aspect=bounds.height/Math.max(1,bounds.width);w=Math.min(this.world.w,w);const h=Math.min(this.world.h,w*aspect);return {x:x-w/2,y:y-h/2,w,h};}
 mapTarget(actor,zone){const r=this.mapRooms.get(zone)||this.mapRooms.get('lobby'),offset=zone==='work'?(actor.i-(this.actors.size-1)/2)*72:((actor.i%3)-1)*42;if(r.side==='right')return {x:r.entry.x-92,y:r.entry.y+offset};if(r.side==='left')return {x:r.entry.x+90,y:r.entry.y+offset};return {x:r.entry.x+offset,y:r.entry.y+(r.side==='top'?72:-70)};}
 mapRoute(start,target){
  const rooms=[...this.mapRooms.values()],inside=p=>rooms.find(r=>p.x>r.x&&p.x<r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h),from=inside(start),to=inside(target);if(!to)return [target];
  const path=[],align=(r,p)=>['left','right'].includes(r.side)?{x:p.x,y:r.entry.y}:{x:r.entry.x,y:p.y};
  let source;
  if(from){path.push(align(from,start),from.entry,from.gate);source=from.gate;}
  else{const choices=[{x:540,y:Math.max(85,Math.min(1555,start.y))},{x:1020,y:Math.max(85,Math.min(1555,start.y))},{x:Math.max(540,Math.min(1020,start.x)),y:550},{x:Math.max(540,Math.min(1020,start.x)),y:1100}];source=choices.sort((a,b)=>Math.hypot(start.x-a.x,start.y-a.y)-Math.hypot(start.x-b.x,start.y-b.y))[0];path.push(source);}
  const nodes=[source,to.gate,{x:540,y:550},{x:540,y:1100},{x:1020,y:550},{x:1020,y:1100}],dist=nodes.map(()=>Infinity),prev=[],done=new Set();dist[0]=0;
  for(let k=0;k<nodes.length;k++){let u=-1;for(let i=0;i<nodes.length;i++)if(!done.has(i)&&(u<0||dist[i]<dist[u]))u=i;if(u<0||!Number.isFinite(dist[u]))break;done.add(u);for(let v=0;v<nodes.length;v++){const a=nodes[u],b=nodes[v],edge=(a.x===b.x&&[540,1020].includes(a.x))||(a.y===b.y&&[550,1100].includes(a.y));if(!edge)continue;const d=dist[u]+Math.abs(a.x-b.x)+Math.abs(a.y-b.y);if(d<dist[v]){dist[v]=d;prev[v]=u;}}}
  const route=[];for(let i=1;i!==undefined&&i!==0;i=prev[i])route.unshift(nodes[i]);path.push(...route,to.entry,align(to,target),target);return path;
 }
 applyCamera(){if(!this.camera||this.room==='vote')return;const c=this.camera;c.x=Math.max(0,Math.min(this.world.w-c.w,c.x));c.y=Math.max(0,Math.min(this.world.h-c.h,c.y));this.svg.setAttribute('viewBox',`${c.x} ${c.y} ${c.w} ${c.h}`);this.followButton.setAttribute('aria-pressed',String(this.mapFollow));if(this.miniView)for(const [k,v] of Object.entries({x:c.x,y:c.y,width:c.w,height:c.h}))this.miniView.setAttribute(k,v);this.positionSpeech();}
 zoomMap(factor){if(!this.camera)return;const c=this.camera,w=Math.max(650,Math.min(this.world.w,c.w/factor));this.camera=this.cameraAround(c.x+c.w/2,c.y+c.h/2,w);this.applyCamera();}
 focusRoom(id){const r=this.mapRooms?.get(id);if(!r)return;this.camera=this.cameraAround(r.x+r.w/2,r.y+r.h/2,Math.max(800,r.w+350));this.roomJump.value=id;this.applyCamera();}
 followMap(){
  if(this.room==='vote'||!this.mapFollow||this.offline||!this.snapshot.connected)return;
  const actor=this.actors.get(this.followAgent)||[...this.actors.values()].find(a=>a.state?.job)||this.actors.get(this.chosen)||this.actors.values().next().value;
  if(!actor?.position)return;
  const changed=this.followAgent!==actor.name;this.followAgent=actor.name;
  this.followButton.textContent=actor.name.toUpperCase()+' 따라가기';
  const [x,y]=this.point(actor.position.x,actor.position.y,25);
  this.camera=this.cameraAround(x,y,changed||this.cameraOverview?900:this.camera?.w||900);this.applyCamera();
 }
 buildMini(){this.mini.replaceChildren();this.mapRect(this.mini,0,0,this.world.w,this.world.h,'#132b34');for(const r of this.mapRooms.values())this.poly(this.mini,[[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]],r.accent,'#acc7bd');this.miniDots=new Map();for(const a of this.actors.values()){const dot=this.s('circle',{r:15,fill:a.color,stroke:'#18313c','stroke-width':5});this.mini.append(dot);this.miniDots.set(a.name,dot);}this.miniView=this.s('rect',{fill:'none',stroke:'#d8f4e0','stroke-width':9,'pointer-events':'none'});this.mini.append(this.miniView);}
 updateMiniActors(){if(this.room==='vote')return;for(const a of this.actors.values()){if(!a.position)continue;const d=this.miniDots?.get(a.name);if(d){const [x,y]=this.point(a.position.x,a.position.y);d.setAttribute('cx',x);d.setAttribute('cy',y);}}}
 stageZone(stage){if(stage==='synthesize')return 'synthesis';return stage==='review'||stage==='verify'?'review':['debate','respond','consult','resolve'].includes(stage)?'meeting':'work';}
 updateZones(){
  this.phaseBar.hidden=this.room==='vote';const zones=new Set();
  if(!this.offline&&this.snapshot.connected&&this.snapshot.config?.mode!=='demo'){
   for(const r of this.snapshot.collaboration||[])if(r.status==='active'&&(!this.selected||r.tid===this.selected))zones.add(this.stageZone(r.stage));
   for(const a of this.actors.values())if(a.state.job&&!a.state.unknown)zones.add(a.state.zone);
  }
  for(const step of this.phaseBar.children){const active=zones.has(step.dataset.zone);step.classList.toggle('active',active);if(active)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');}
  if(this.room!=='vote')for(const [zone,layer] of this.zoneLayers||[])layer.classList.toggle('active',zones.has(zone));
 }
 closePanel(){this.panelOpen=false;this.panel.hidden=true;this.actors.get(this.chosen)?.g.focus({preventScroll:true});}
 enableChatLayout(handle){
  handle.tabIndex=0;handle.title='드래그 또는 방향키로 이동';handle.setAttribute('aria-label','팀 대화창 이동 · 방향키 사용 가능');
  const reset=this.el('button','office-chat-reset','원위치');reset.type='button';reset.onclick=()=>{this.chat.style.removeProperty('left');this.chat.style.removeProperty('top');this.chat.style.removeProperty('bottom');this.chat.style.removeProperty('width');this.chat.style.removeProperty('height');};handle.insertBefore(reset,this.chatToggle);
  const drag=(target,resize=false)=>{
   target.addEventListener('pointerdown',e=>{
    if(e.button!==0||(!resize&&e.target.closest('button'))||matchMedia('(max-width:650px)').matches)return;
    e.preventDefault();target.setPointerCapture(e.pointerId);const box=this.chat.getBoundingClientRect(),bounds=this.viewport.getBoundingClientRect(),x=e.clientX,y=e.clientY;
    const left=box.left-bounds.left+this.viewport.scrollLeft,top=box.top-bounds.top;
    if(resize){this.chat.style.left=left+'px';this.chat.style.top=top+'px';this.chat.style.bottom='auto';}
    const move=ev=>{if(resize){this.chat.style.width=Math.max(240,Math.min(this.viewport.clientWidth-left-4,box.width+ev.clientX-x))+'px';this.chat.style.height=Math.max(120,Math.min(this.viewport.clientHeight-top-4,box.height+ev.clientY-y))+'px';}else{this.chat.style.left=Math.max(4,Math.min(this.viewport.clientWidth-this.chat.offsetWidth-4,left+ev.clientX-x))+'px';this.chat.style.top=Math.max(4,Math.min(this.viewport.clientHeight-this.chat.offsetHeight-4,top+ev.clientY-y))+'px';this.chat.style.bottom='auto';}};
    const done=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',done);target.removeEventListener('pointercancel',done);target.removeEventListener('lostpointercapture',done);};target.addEventListener('pointermove',move);target.addEventListener('pointerup',done);target.addEventListener('pointercancel',done);target.addEventListener('lostpointercapture',done);
   });
  };drag(handle);
  const grip=this.el('button','office-chat-resize','◢');grip.type='button';grip.setAttribute('aria-label','대화창 크기 조절 · 방향키 사용 가능');this.chat.append(grip);drag(grip,true);
  const keys=(e,resize)=>{if(e.target!==e.currentTarget||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||matchMedia('(max-width:650px)').matches)return;e.preventDefault();const step=e.shiftKey?40:12,dx=e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0,dy=e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0,box=this.chat.getBoundingClientRect(),bounds=this.viewport.getBoundingClientRect();if(resize){this.chat.style.left=(box.left-bounds.left)+'px';this.chat.style.top=(box.top-bounds.top)+'px';this.chat.style.bottom='auto';this.chat.style.width=Math.max(240,Math.min(this.viewport.clientWidth-8,box.width+dx))+'px';this.chat.style.height=Math.max(120,Math.min(this.viewport.clientHeight-8,box.height+dy))+'px';}else{this.chat.style.left=(box.left-bounds.left+dx)+'px';this.chat.style.top=(box.top-bounds.top+dy)+'px';this.chat.style.bottom='auto';}this.clampChat();};handle.onkeydown=e=>keys(e,false);grip.onkeydown=e=>keys(e,true);
 }
 clampChat(){
  if(!this.chat||!this.viewport.clientWidth)return;
  if(matchMedia('(max-width:650px)').matches){for(const k of ['left','top','bottom','width','height'])this.chat.style.removeProperty(k);return;}
  if(this.chat.style.width)this.chat.style.width=Math.min(parseFloat(this.chat.style.width),this.viewport.clientWidth-8)+'px';
  if(this.chat.style.height)this.chat.style.height=Math.min(parseFloat(this.chat.style.height),this.viewport.clientHeight-8)+'px';
  if(this.chat.style.left)this.chat.style.left=Math.max(4,Math.min(parseFloat(this.chat.style.left),this.viewport.clientWidth-this.chat.offsetWidth-4))+'px';
  if(this.chat.style.top)this.chat.style.top=Math.max(4,Math.min(parseFloat(this.chat.style.top),this.viewport.clientHeight-this.chat.offsetHeight-4))+'px';
 }
 speechKey(m){return m.tid+':'+(m.eventKey||JSON.stringify([m.sendingAgentName,m.messageTimestamp,m.messageText]));}
 speechText(m){return String(m.messageText||'').replace(/\s+/g,' ').trim();}
 updateSpeech(){
  const scope=JSON.stringify([this.snapshot.notification_scope,this.selected,this.room]);
  const messages=this.room==='vote'?[]:this.getMessages().slice(-50);
  const keys=new Set(messages.map(m=>this.speechKey(m))),reset=scope!==this.speechScope;
  const fresh=reset?[]:messages.filter(m=>!this.speechSeen.has(this.speechKey(m)));
  this.speechScope=scope;this.speechSeen=keys;
  const live=this.visible&&!document.hidden&&!this.offline&&this.snapshot.connected&&this.snapshot.config?.mode!=='demo';
  if(reset||!live){this.speechQueue=[];this.speaking=null;this.bubble.hidden=true;}
  else this.speechQueue.push(...fresh.filter(m=>(this.snapshot.config?.agents||[]).includes(m.sendingAgentName)));
  this.speechQueue=this.speechQueue.slice(-12);
  this.chat.hidden=this.room==='vote';
  if(!this.visible)return;
  const logKey=JSON.stringify([scope,...keys]);if(logKey===this.chatKey)return;this.chatKey=logKey;
  const bottom=reset||this.chatLog.scrollHeight-this.chatLog.scrollTop-this.chatLog.clientHeight<30,oldTop=this.chatLog.scrollTop;
  this.chatLog.replaceChildren();
  for(const m of messages){
   const row=this.el('button','office-chat-line');row.type='button';
   const time=new Date(typeof m.messageTimestamp==='number'?m.messageTimestamp*1000:m.messageTimestamp);
   const header=this.el('span','office-chat-meta');header.append(this.el('time','',Number.isNaN(time.getTime())?'':time.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',hour12:false})),this.el('strong','',String(m.sendingAgentName||'HUB').toUpperCase()));
   const targets=m.mentionAgentNames||[];if(targets.length)header.append(this.el('span','','→ '+targets.join(', ')));
   if(!this.selected)header.append(this.el('span','office-chat-channel',m.thread||m.tid));
   const actorIndex=(this.snapshot.config?.agents||[]).indexOf(m.sendingAgentName);row.style.setProperty('--speaker',actorIndex<0?'#a6baca':this.color(m.sendingAgentName,actorIndex));
   const text=this.speechText(m);row.append(header,this.el('span','office-chat-text',text.length>260?text.slice(0,260)+'…':text));row.title='대화에서 전체 내용 보기';row.onclick=()=>this.openChat(m.tid,'');this.chatLog.append(row);
  }
  if(!messages.length)this.chatLog.append(this.el('p','office-chat-empty','공개된 메시지가 여기에 표시됩니다.'));
  if(bottom){this.chatLog.scrollTop=this.chatLog.scrollHeight;this.chatLatest.hidden=true;}else{this.chatLog.scrollTop=oldTop;if(fresh.length)this.chatLatest.hidden=false;}
 }
 advanceSpeech(){
  if(!this.visible||document.hidden||this.offline||!this.snapshot?.connected){if(this.bubble)this.bubble.hidden=true;this.speechQueue=[];this.speaking=null;return;}
  if(this.speaking&&Date.now()<this.speechUntil){this.positionSpeech();return;}
  this.speaking=this.speechQueue.shift()||null;
  if(!this.speaking){this.bubble.hidden=true;return;}
  const m=this.speaking,actor=this.actors.get(m.sendingAgentName);if(!actor){this.speaking=null;return;}
  const targets=m.mentionAgentNames||[],text=this.speechText(m);
  this.bubble.replaceChildren(this.el('strong','',m.sendingAgentName.toUpperCase()+(targets.length?' → '+targets.join(', '):'')),this.el('span','',text.length>110?text.slice(0,110)+'…':text));
  this.bubble.style.setProperty('--speaker',actor.color);this.bubble.hidden=false;this.speechUntil=Date.now()+8000;this.positionSpeech();
 }
 positionSpeech(){
  if(!this.speaking||this.bubble.hidden)return;const actor=this.actors.get(this.speaking.sendingAgentName);if(!actor?.position)return;
  const matrix=this.svg.getScreenCTM();if(!matrix)return;const [x,y]=this.point(actor.position.x,actor.position.y,65),point=this.svg.createSVGPoint();point.x=x;point.y=y;const p=point.matrixTransform(matrix),rect=this.viewport.getBoundingClientRect();
  if(p.x<rect.left||p.x>rect.right||p.y<rect.top||p.y>this.svg.getBoundingClientRect().bottom){this.bubble.style.visibility='hidden';return;}this.bubble.style.visibility='visible';
  const left=Math.max(4,Math.min(this.viewport.clientWidth-this.bubble.offsetWidth-4,p.x-rect.left-this.bubble.offsetWidth/2));
  this.bubble.style.left=(left+this.viewport.scrollLeft)+'px';this.bubble.style.top=Math.max(0,p.y-rect.top-this.bubble.offsetHeight-10)+'px';
  this.bubble.style.setProperty('--tail',Math.max(12,Math.min(this.bubble.offsetWidth-12,p.x-rect.left-left))+'px');
 }
 elapsed(){this.advanceSpeech();const e=this.panel.querySelector('[data-start]');if(e){const seconds=Math.max(0,Math.floor(Date.now()/1000-Number(e.dataset.start)));e.textContent=`현재 실행 ${Math.floor(seconds/60)}분 ${seconds%60}초`;}}
 stop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.lastFrame=0;}
 animate(){
  if(this.raf||!this.visible||document.hidden)return;
  const frame=now=>{this.raf=0;if(!this.visible||document.hidden)return;const dt=Math.min(.08,(now-(this.lastFrame||now))/1000);this.lastFrame=now;let moving=false;
   for(const actor of this.actors.values()){
    const target=actor.path[0];if(target){moving=true;const dx=target.x-actor.position.x,dy=target.y-actor.position.y,dist=Math.hypot(dx,dy),step=180*dt;if(dist<=step){actor.position={...target};actor.path.shift();}else{actor.position.x+=dx/dist*step;actor.position.y+=dy/dist*step;}this.place(actor);}actor.g.classList.toggle('moving',actor.path.length>0&&!this.reduced.matches);
   }
   this.followMap();this.elapsed();if(moving)this.raf=requestAnimationFrame(frame);else this.lastFrame=0;
  };this.raf=requestAnimationFrame(frame);
 }
};
