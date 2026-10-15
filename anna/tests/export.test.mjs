import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportName, toMarkdown} from '../bundle/export.mjs';

const turn = (step, role, extra = {}) => ({step, role, status: 'done', text: `${role} ${step} 본문`, model: 'google/gemini-3-flash-preview', requested: '', error: '', ...extra});
const discussion = {
  id: 'd1', kind: 'discussion', title: '점심\n메뉴', request: '점심 메뉴를 정해 줘', roles: ['analyst', 'critic', 'editor'],
  language: 'ko', status: 'failed', updated: Date.UTC(2026, 9, 15),
  turns: [
    turn('opinion', 'analyst'), turn('opinion', 'critic', {requested: 'claude'}), turn('opinion', 'editor'),
    turn('rebuttal', 'analyst', {status: 'failed', error: 'quota', text: '부분', model: ''}),
    turn('rebuttal', 'critic', {status: 'pending', text: '', model: ''}),
  ],
};

test('a discussion exports by step with actual models and failures', () => {
  const md = toMarkdown(discussion);
  assert.match(md, /^# 점심 메뉴\n/);
  assert.match(md, /- 상태: 실패/);
  assert.match(md, /- 수정 시각: 2026-10-15T00:00:00.000Z/);
  assert.match(md, /## 요청\n\n점심 메뉴를 정해 줘/);
  assert.match(md, /## 1회차 독립 의견\n\n### 분석가 · 완료\n\n실제 모델: `google\/gemini-3-flash-preview`\n\nanalyst opinion 본문/);
  assert.match(md, /실제 모델: `google\/gemini-3-flash-preview` · 요청: `claude` \(요청과 다름\)/);
  assert.match(md, /### 분석가 · 실패\n\n실제 모델: 확인 안 됨\n\n_Anna AI 사용량이 부족해요\./);
  assert.match(md, /부분/);
  assert.doesNotMatch(md, /비판자 · 대기/);
  assert.doesNotMatch(md, /## 최종안/);
});

test('English export uses English labels', () => {
  const md = toMarkdown(discussion, 'en');
  assert.match(md, /## First-round independent opinions/);
  assert.match(md, /### Analyst · Done/);
  assert.match(md, /Actual model:/);
});

const ballot = (role, choice, extra = {}) => turn('ballot', role, {text: JSON.stringify({choice, reason: `${role} 근거`, concern: '없음'}), ...extra});
const vote = turns => ({id: 'v1', kind: 'vote', title: '점심은?', passage: '점심은?', options: [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}], roles: ['analyst', 'critic'], language: 'ko', status: 'done', updated: 0, turns});

test('vote ballots stay sealed in exports until every role has voted', () => {
  const md = toMarkdown(vote([ballot('analyst', 'A'), ballot('critic', 'B', {status: 'running', text: ''})]));
  assert.match(md, /모든 투표가 끝나면 공개됩니다/);
  assert.doesNotMatch(md, /analyst 근거/);
  assert.doesNotMatch(md, /— \d+표/);
});

test('a finished vote exports counts, choices and reasons', () => {
  const md = toMarkdown(vote([ballot('analyst', 'A'), ballot('critic', 'ABSTAIN')]));
  assert.match(md, /- A\. 짜장 — 1표/);
  assert.match(md, /- B\. 짬뽕 — 0표/);
  assert.match(md, /- 기권 — 1표/);
  assert.match(md, /### 분석가 · A\n\n실제 모델: `google\/gemini-3-flash-preview`\n\n- 근거: analyst 근거\n- 우려: 없음/);
  assert.match(md, /### 비판자 · 기권/);
});

test('backticks in model names cannot break the code span', () => {
  const md = toMarkdown({...discussion, turns: [turn('opinion', 'analyst', {model: 'a`b', requested: 'c``d'})]});
  assert.match(md, /실제 모델: `ab` · 요청: `cd`/);
});

test('export file names are stable', () => {
  assert.equal(exportName({kind: 'vote', id: 'abc-1'}), 'agent-hub-vote-abc-1.md');
});
