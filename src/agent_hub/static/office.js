/* Original SVG office scene. No game engine, remote assets, or model calls. */
'use strict';
window.AgentOffice=class AgentOffice {
 constructor(root,openChat,requestWork){
  this.root=root;this.openChat=openChat;this.requestWork=requestWork;this.actors=new Map();this.chosen='';this.layoutKey='';this.visible=false;this.raf=0;
  this.reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};this.el=el;
  const heading=el('div','office-heading');const title=el('div','');title.append(el('small','office-eyebrow','YOUR TEAM, IN PLACE'),el('h2','','에이전트 스튜디오'));
  this.connection=el('span','office-connection');heading.append(title,this.connection);
  this.caption=el('p','office-caption');
  const body=el('div','office-body');this.viewport=el('div','office-viewport');this.svg=this.s('svg',{viewBox:'0 0 1120 700','aria-label':'에이전트 가상사무실',role:'group'});this.viewport.append(this.svg);
  const legend=el('div','office-legend');for(const [color,text] of [['#84c9df','작업석'],['#b3a6eb','리뷰룸'],['#deb989','회의 공간'],['#8abaaa','라운지']]){const item=el('span','');const dot=el('i','');dot.style.background=color;item.append(dot,document.createTextNode(text));legend.append(item);}this.viewport.append(legend);
  this.panel=el('div','office-panel');this.panel.setAttribute('aria-label','에이전트 상세');body.append(this.viewport,this.panel);
  this.roster=el('div','office-roster');this.roster.setAttribute('aria-label','사무실 에이전트');
  const foot=el('p','office-footnote','실제 작업 상태를 공간으로 표현합니다. 위치는 시각화이며 캐릭터를 눌러 공유 내용을 확인할 수 있습니다.');
  root.append(heading,this.caption,body,this.roster,foot);
  this.room='work';this.pollId='';this.rooms=el('div','office-rooms');this.workRoom=el('button','','업무 사무실');this.voteRoom=el('button','','투표실');this.pollSelect=el('select','');this.pollSelect.setAttribute('aria-label','투표실에서 볼 투표');
  for(const [button,room] of [[this.workRoom,'work'],[this.voteRoom,'vote']]){button.type='button';button.onclick=()=>{this.room=room;this.update(this.snapshot,this.selected,this.offline,this.visible);};}
  this.pollSelect.onchange=()=>{this.pollId=this.pollSelect.value;this.update(this.snapshot,this.selected,this.offline,this.visible);};this.rooms.append(this.workRoom,this.voteRoom,this.pollSelect);root.prepend(this.rooms);
  document.addEventListener('visibilitychange',()=>{this.root.classList.toggle('office-paused',document.hidden||!this.visible);if(document.hidden)this.stop();else if(this.visible)this.animate();});
 }
 s(tag,attrs={},text){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
 point(x,y,z=0){return [520+(x-y)*.87,92+(x+y)*.43-z];}
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
 build(names){
  this.svg.replaceChildren();this.actors.clear();this.rowCount=Math.max(1,Math.ceil(names.length/2));this.workDepth=Math.max(195,this.rowCount*115+35);this.corridor=this.workDepth+35;const depth=this.workDepth+Math.max(215,155+Math.ceil(names.length/3)*35);
  const height=Math.max(620,92+(620+depth)*.43+90);const left=Math.min(0,520-depth*.87-45);this.svg.setAttribute('viewBox',`${left} 0 ${1120-left} ${height}`);
  const floor=this.s('g');this.svg.append(floor);
  this.box(floor,0,0,620,depth,18,'#263948','#101c2a','#182b3a',-18);
  // Two cutaway walls, glazing and architectural trim.
  this.box(floor,0,0,620,7,83,'#547081','#263e51','#344e61');this.box(floor,0,7,7,depth-7,83,'#476474','#233b4b','#2b4555');
  for(let x=30;x<580;x+=100){this.poly(floor,[[x,8,18],[x+76,8,18],[x+76,8,70],[x,8,70]],'#496b80');this.poly(floor,[[x+3,8,22],[x+36,8,22],[x+36,8,66],[x+3,8,66]],'#6d94a8');}
  for(let y=50;y<depth;y+=110){this.poly(floor,[[8,y,20],[8,y+65,20],[8,y+65,65],[8,y,65]],'#365665');}
  for(let x=20;x<620;x+=40)this.poly(floor,[[x,9,0],[x+.5,9,0],[x+.5,depth,0],[x,depth,0]],'#2d4252');
  for(let y=25;y<depth;y+=40)this.poly(floor,[[8,y,0],[620,y,0],[620,y+.5,0],[8,y+.5,0]],'#2d4252');
  this.box(floor,28,25,280,this.workDepth-20,1,'#324b5a','#324b5a','#324b5a');
  this.box(floor,382,25,210,this.workDepth-20,1,'#403f58','#403f58','#403f58');
  this.box(floor,28,this.corridor+30,280,125,1,'#344f4d','#344f4d','#344f4d');
  this.box(floor,382,this.corridor+30,210,125,1,'#554e45','#554e45','#554e45');
  this.text(floor,55,42,3,'FOCUS / 작업석','#94b9ca',11);this.text(floor,401,42,3,'REVIEW / 리뷰룸','#c1b5df',11);
  this.text(floor,46,this.corridor+46,3,'LOUNGE / 라운지','#a5cabc',11);this.text(floor,398,this.corridor+46,3,'SYNC / 회의','#ddc7a7',11);
  const items=[];const add=(x,y,draw)=>items.push({depth:x+y,draw});
  names.forEach((name,i)=>{const x=48+(i%2)*133,y=65+Math.floor(i/2)*115;add(x,y,()=>this.desk(floor,x,y));});
  // Review table and transparent board.
  add(422,95,()=>{this.box(floor,435,105,10,60,27);this.box(floor,520,105,10,60,27);this.box(floor,412,90,140,90,5,'#8a82a1','#514f6b','#67617d',27);this.box(floor,410,43,142,5,62,'#8b9da9','#405366','#576c7d',12);this.poly(floor,[[419,49,29],[544,49,29],[544,49,64],[419,49,64]],'#8eb2b6');this.text(floor,429,50,43,'CHECK · AGREE','#234854',10);});
  const fy=this.corridor+75;
  add(70,fy,()=>{this.box(floor,50,fy,115,40,22,'#628d88','#345b5c','#456e6b');this.box(floor,50,fy,115,8,18,'#7ba29a','#476e6d','#5c8680',22);this.box(floor,50,fy,10,40,13,'#789c94','#476d67','#5c8278',22);this.box(floor,155,fy,10,40,13,'#789c94','#476d67','#5c8278',22);this.box(floor,185,fy+6,60,44,17,'#b6a58c','#746f65','#928875');});
  add(430,fy,()=>{this.box(floor,464,fy+10,18,40,26,'#8c847a','#535b5c','#6b7270');this.box(floor,419,fy,128,64,5,'#c4ab87','#877c6b','#ab9479',26);this.box(floor,451,fy+18,28,18,2,'#ddd5bf','#a6a290','#c4bfa7',31);this.box(floor,489,fy+27,7,7,8,'#c7d8d5','#6e918f','#96b4ae',31);});
  add(280,fy+38,()=>this.plant(floor,280,fy+38));add(590,depth-25,()=>this.plant(floor,590,depth-25));add(335,28,()=>this.plant(floor,335,28));
  items.sort((a,b)=>a.depth-b.depth).forEach(i=>i.draw());
  this.text(floor,160,depth+18,-18,'A G E N T   H U B   /   S T U D I O','#5e8298',12);
  this.actorLayer=this.s('g');this.svg.append(this.actorLayer);
  names.forEach((name,i)=>this.createActor(name,i));
 }
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
  const pick=()=>{this.chosen=name;this.details();this.selectActor();};g.addEventListener('click',pick);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});this.actorLayer.append(g);
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
  if(job){const zone=job.stage==='review'?'review':['consult','resolve'].includes(job.stage)?'meeting':'work';return {...base,job,zone,label:zone==='review'?'검토 중':zone==='meeting'?'쟁점 확인 중':'작업 중',description:zone==='review'?'같은 후보안을 검토하고 있습니다.':zone==='meeting'?'전달된 질문 또는 반대 쟁점을 확인하고 있습니다.':'CLI를 실행해 요청을 분석하고 있습니다. 응답 생성을 기다리는 시간을 포함합니다.'};}
  const vote=r?.votes?.find(v=>v.agent===name&&v.version===r.version&&v.proposal_hash===r.digest);
  if(r?.status==='active'&&vote)return {...base,zone:'review',label:vote.decision==='APPROVE'?'승인 완료':'수정 요청',description:vote.decision==='APPROVE'?'현재 후보를 승인했습니다. 동료의 검토 완료를 기다립니다.':'후보에 반대 의견을 제출했습니다. 수정안이 필요합니다.'};
  if(!s.config?.automatic)return {...base,label:'관찰 모드',description:'자동 실행이 꺼져 있습니다.'};
  if(jobs.some(j=>j.status==='pending'))return {...base,zone:'work',label:'실행 대기',description:'작업이 예약되어 있습니다. 아직 실행을 시작하지 않았습니다.'};
  if(r?.status==='active')return {...base,label:'동료 대기',description:'자신의 단계를 마치고 동료의 결과를 기다립니다.'};
  if(r?.status==='agreed')return {...base,label:'협업 완료',description:'참여자 전원이 동일한 후보를 승인했습니다.'};
  if(r?.status==='blocked')return {...base,label:'협업 보류',description:'실패 또는 미해결 쟁점으로 요청이 보류되었습니다.'};
  return base;
 }
 target(actor,zone){const i=actor.i;
  if(this.room==='vote'){
   if(zone==='work')return {x:102+i*175,y:164};
   if(zone.startsWith('vote-')&&zone!=='vote-other'){const n=Number(zone.slice(5));const peers=[...this.actors.values()].filter(a=>this.ballotState(a.name).zone===zone),slot=peers.findIndex(a=>a.name===actor.name);return {x:72+(n%2)*290+slot*72,y:350+Math.floor(n/2)*130};}
   return {x:165+i*95,y:560};
  }
  if(zone==='work')return {x:90+(i%2)*133,y:160+Math.floor(i/2)*115};
  if(zone==='review')return {x:415+(i%3)*56,y:199+Math.floor(i/3)*46};
  if(zone==='meeting')return {x:420+(i%3)*54,y:this.corridor+152+Math.floor(i/3)*35};
  return {x:74+(i%3)*71,y:this.corridor+145+Math.floor(i/3)*35};
 }
 update(snapshot,selected,offline,visible){
  this.snapshot=snapshot;this.selected=selected;this.offline=offline;this.visible=visible;this.root.classList.toggle('office-paused',!visible||document.hidden);
  if(!visible){this.stop();return;}
  const polls=(snapshot.polls||[]).filter(p=>!selected||p.tid===selected);this.poll=polls.find(p=>p.id===this.pollId)||polls[0];this.pollId=this.poll?.id||'';
  if(document.activeElement!==this.pollSelect){this.pollSelect.replaceChildren();for(const p of polls){const option=this.el('option','',p.passage.slice(0,45)+(p.status==='active'?' · 진행 중':' · 종료'));option.value=p.id;option.selected=p.id===this.pollId;this.pollSelect.append(option);}}this.pollSelect.hidden=this.room!=='vote'||!polls.length;
  this.workRoom.setAttribute('aria-pressed',String(this.room==='work'));this.voteRoom.setAttribute('aria-pressed',String(this.room==='vote'));
  const names=[...new Set(snapshot.config?.agents||[])],key=JSON.stringify([names,this.room,this.room==='vote'?this.poll?.id:null]);
  if(key!==this.layoutKey){if(this.room==='vote')this.buildVote(names);else this.build(names);this.layoutKey=key;}
  if(!names.includes(this.chosen))this.chosen=names[0]||'';
  this.connection.textContent=offline||!snapshot.connected?'● 연결 확인 필요':snapshot.config?.mode==='demo'?'○ DEMO':'● LIVE';
  this.connection.dataset.live=String(!offline&&!!snapshot.connected);
  const t=(snapshot.threads||[]).find(t=>t.threadId===selected);this.caption.textContent=(t?'현재 채널 · '+t.threadName:'전체 채널의 활동')+' / '+names.length+'명의 에이전트';
  this.root.classList.toggle('voting-room',this.room==='vote');this.root.querySelector('.office-heading h2').textContent=this.room==='vote'?'독립 투표실':'에이전트 스튜디오';
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
   else if(old?.zone!==state.zone||old?.unknown){const front=actor.position.y>this.corridor;actor.path=front?[{x:340,y:actor.position.y},{x:340,y:this.corridor}]:[{x:actor.position.x,y:this.corridor},{x:340,y:this.corridor}];actor.path.push(...(target.y>this.corridor?[{x:340,y:target.y},target]:[{x:target.x,y:this.corridor},target]));if(this.reduced.matches){actor.position=target;actor.path=[];this.place(actor);}}
  }
  this.roster.replaceChildren();for(const actor of this.actors.values()){
   const b=this.el('button','office-person');b.type='button';b.style.setProperty('--person',actor.color);b.append(this.el('span','office-person-dot','●'),this.el('strong','',actor.name.toUpperCase()),this.el('small','',actor.state.label));b.onclick=()=>{this.chosen=actor.name;this.details();this.selectActor();};b.dataset.agent=actor.name;this.roster.append(b);
  }
  if(!names.length)this.caption.textContent='연결 설정에서 에이전트를 선택하면 사무실에 입장합니다.';
  this.selectActor();this.details();this.animate();
 }
 place(actor){const [x,y]=this.point(actor.position.x,actor.position.y);actor.g.setAttribute('transform',`translate(${x} ${y})`);}
 selectActor(){for(const a of this.actors.values())a.g.classList.toggle('selected',a.name===this.chosen);for(const b of this.roster.children)b.setAttribute('aria-pressed',String(b.dataset.agent===this.chosen));}
 details(){
  this.panel.replaceChildren();const actor=this.actors.get(this.chosen);if(!actor){this.panel.append(this.el('p','','등록된 에이전트가 없습니다.'));return;}
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
 elapsed(){const e=this.panel.querySelector('[data-start]');if(e){const seconds=Math.max(0,Math.floor(Date.now()/1000-Number(e.dataset.start)));e.textContent=`현재 실행 ${Math.floor(seconds/60)}분 ${seconds%60}초`;}}
 stop(){if(this.raf)cancelAnimationFrame(this.raf);this.raf=0;this.lastFrame=0;}
 animate(){
  if(this.raf||!this.visible||document.hidden)return;
  const frame=now=>{this.raf=0;if(!this.visible||document.hidden)return;const dt=Math.min(.08,(now-(this.lastFrame||now))/1000);this.lastFrame=now;let moving=false;
   for(const actor of this.actors.values()){
    const target=actor.path[0];if(target){moving=true;const dx=target.x-actor.position.x,dy=target.y-actor.position.y,dist=Math.hypot(dx,dy),step=180*dt;if(dist<=step){actor.position={...target};actor.path.shift();}else{actor.position.x+=dx/dist*step;actor.position.y+=dy/dist*step;}this.place(actor);}actor.g.classList.toggle('moving',actor.path.length>0&&!this.reduced.matches);
   }
   this.elapsed();if(moving)this.raf=requestAnimationFrame(frame);else this.lastFrame=0;
  };this.raf=requestAnimationFrame(frame);
 }
};
