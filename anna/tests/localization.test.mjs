import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings, normalizeSettings} from '../bundle/roles.mjs';
import {createDiscussion, discussionPrompt} from '../bundle/discussion.mjs';
import {createVote, votePrompt, parseBallot} from '../bundle/voting.mjs';
import {decisionSections} from '../bundle/decision.mjs';
import {toMarkdown} from '../bundle/export.mjs';
import {setLanguage} from '../bundle/i18n.mjs';

const cases = [
  ['en', /Answer in English/, /Write in English/, ['Build first','Defer','Reasons','Assumptions to check','Next action'], 'Analyst'],
  ['ko', /한국어로 답/, /한국어로 씁니다/, ['먼저 만들기','미루기','판단 근거','확인할 가정','다음 행동'], '분석가'],
  ['zh-CN', /简体中文回答/, /必须使用简体中文/, ['优先开发','暂缓开发','判断依据','待验证的假设','下一步行动'], '分析师'],
  ['ja', /必ず日本語で/, /日本語で書いて/, ['先に作るもの','見送るもの','判断の根拠','確認する仮定','次の行動'], '分析役'],
];
const roles = ['analyst','critic','editor'];

test('new or invalid settings use English while saved supported choices survive',()=>{
  assert.equal(defaultSettings().language,'en');
  for(const value of [undefined,null,{}, {language:'xx'}]) assert.equal(normalizeSettings(value).language,'en');
  for(const [language] of cases) assert.equal(normalizeSettings({language}).language,language);
  assert.equal(createDiscussion({request:'Question',roles}).language,'en');
  assert.equal(createVote({passage:'Question',options:['A','B'],roles}).language,'en');
});

for(const [language,discussionRule,voteRule,headings,analyst] of cases) {
  test(`${language}: saved run language controls every prompt, decisions and export`,()=>{
    const thread = createDiscussion({id:'locale',request:'Keep the original request 原文',roles,language,purpose:'priority'});
    setLanguage(language==='en'?'ja':'en');
    for(let i=0;i<thread.turns.length;i++) {
      const prompt=discussionPrompt(thread,i);
      assert.match(prompt.system,discussionRule);
      assert.ok(prompt.messages[0].text.includes('Keep the original request 原文'));
      if(thread.turns[i].step==='final') for(const h of headings)assert.ok(prompt.system.includes(`## ${h}`));
    }
    const text=headings.map(h=>`## ${h}\n- 原文 <script> stays plain`).join('\n\n');
    assert.deepEqual(decisionSections(text,language).map(s=>s.title),headings);
    const final=thread.turns.find(t=>t.step==='final');
    Object.assign(final,{text,status:'done'});
    Object.assign(thread.turns[0],{text:'Original response 原文',status:'done'});
    const md=toMarkdown(thread);
    assert.ok(md.includes(analyst));
    assert.ok(md.includes(text));
    assert.ok(md.includes('Original response 原文'));
    const vote=createVote({id:'vote',passage:'Which?',options:['One','Two'],roles,language});
    const prompt=votePrompt(vote,0);
    assert.match(prompt.system,voteRule);
    const ballot={choice:'A',reason:'原文の理由',concern:'不确定性'};
    Object.assign(vote.turns[0],{text:JSON.stringify(ballot),status:'done'});
    assert.deepEqual(parseBallot(vote.turns[0].text,vote.options),ballot);
    assert.ok(!votePrompt(vote,1).messages[0].text.includes(ballot.reason),'ballots remain independent');
    assert.ok(!toMarkdown(vote).includes(ballot.reason),'partial ballots remain sealed');
    for(const t of vote.turns)Object.assign(t,{text:JSON.stringify(ballot),status:'done'});
    assert.ok(toMarkdown(vote).includes(ballot.reason));
  });
}

test('pre-language legacy records retain Korean on resume and export',()=>{
  const thread=createDiscussion({id:'old',request:'기존 내용',roles});
  delete thread.language;
  assert.match(discussionPrompt(thread,0).system,/한국어로 답/);
  assert.match(toMarkdown(thread),/## 요청/);
});
