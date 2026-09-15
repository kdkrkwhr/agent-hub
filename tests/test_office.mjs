import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context={window:{}};
vm.runInNewContext(readFileSync(new URL('../src/agent_hub/static/office.js',import.meta.url),'utf8'),context);
function fixture(){
 const view=Object.create(context.window.AgentOffice.prototype);
 const round={id:'r',tid:'channel',status:'active',team:['claude','codex'],version:1,digest:'candidate',votes:[],events:[]};
 view.selected='channel';view.offline=false;view.snapshot={connected:true,config:{agents:['claude','codex','cursor'],automatic:true,mode:'coral'},collaboration:[round],jobs:[]};return {view,round};
}
test('actual running phase selects work, review or meeting; no invented typing state',()=>{
 const {view}=fixture();const job={agent:'codex',round_id:'r',tid:'channel',status:'running'};view.snapshot.jobs=[job];
 for(const [phase,zone] of [['explore','work'],['plan','work'],['review','review'],['consult','meeting'],['resolve','meeting']]){job.stage=phase;assert.equal(view.stateFor('codex').zone,zone);}
});
test('only matching current vote shows approval, and unmentioned agents stay out',()=>{
 const {view,round}=fixture();round.votes=[{agent:'codex',version:1,proposal_hash:'old',decision:'APPROVE'}];assert.notEqual(view.stateFor('codex').label,'승인 완료');
 round.votes[0].proposal_hash='candidate';assert.equal(view.stateFor('codex').label,'승인 완료');assert.equal(view.stateFor('cursor').label,'미참여');
});
test('offline and demo never imply live work',()=>{
 const {view}=fixture();view.snapshot.jobs=[{agent:'codex',round_id:'r',tid:'channel',status:'running',stage:'explore'}];view.offline=true;assert.equal(view.stateFor('codex').unknown,true);assert.equal(view.stateFor('codex').job,null);
 view.offline=false;view.snapshot.config.mode='demo';assert.equal(view.stateFor('codex').label,'데모');assert.equal(view.stateFor('codex').job,null);
});
test('overview follows running work even if a newer request is queued elsewhere',()=>{
 const {view,round}=fixture();view.selected='';view.snapshot.collaboration=[{...round,id:'new',tid:'other'},round];view.snapshot.jobs=[{agent:'codex',round_id:'new',tid:'other',status:'pending'},{agent:'codex',round_id:'r',tid:'channel',status:'running',stage:'review'}];
 assert.equal(view.stateFor('codex').round.id,'r');assert.equal(view.stateFor('codex').zone,'review');
});
test('idle, queued and completed work are distinct',()=>{
 const {view,round}=fixture();view.snapshot.jobs=[{agent:'codex',round_id:'r',tid:'channel',status:'pending'}];assert.equal(view.stateFor('codex').label,'실행 대기');view.snapshot.jobs=[];round.status='agreed';assert.equal(view.stateFor('codex').zone,'lounge');assert.equal(view.stateFor('codex').label,'협업 완료');
});
