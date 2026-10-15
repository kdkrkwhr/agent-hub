import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVote, parseBallot, tally, votePlan} from '../bundle/voting.mjs';
import {runThread, skipTurn} from '../bundle/runner.mjs';
import {defaultSettings} from '../bundle/roles.mjs';

const lunch = (roles = ['analyst', 'critic', 'editor']) => createVote({id: 'v1', passage: '점심은 무엇으로?', options: [' 짜장 ', '', '짬뽕'], roles, now: 1});
const ballot = (choice, reason = '빠르다') => JSON.stringify({choice, reason, concern: '없음'});
function replies(...texts) {
  const calls = [];
  return {calls, async speak(args) { calls.push(args); return {text: texts[calls.length - 1], model: 'openai/gpt-5-mini'}; }};
}
function memoryStore() {
  let settings = defaultSettings();
  return {get settings() { return settings; }, async saveThread() {}, async updateSettings(change) { settings = change(settings); return settings; }};
}
const run = (thread, ai, store = memoryStore()) => runThread({thread, plan: votePlan, ai, store, settings: store.settings, now: () => 9});

test('a vote needs a passage, two options and a voter', () => {
  const thread = lunch();
  assert.deepEqual(thread.options, [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}]);
  assert.deepEqual(thread.turns.map(t => [t.step, t.role]), [['ballot', 'analyst'], ['ballot', 'critic'], ['ballot', 'editor']]);
  assert.throws(() => createVote({id: 'x', passage: ' ', options: ['a', 'b'], roles: ['analyst']}), /Empty passage/);
  assert.throws(() => createVote({id: 'x', passage: 'p', options: ['a'], roles: ['analyst']}), /Need two options/);
  assert.throws(() => createVote({id: 'x', passage: 'p', options: ['a', 'b'], roles: []}), /Need a voter/);
  assert.equal(createVote({id: 'x', passage: 'p', options: ['1', '2', '3', '4', '5', '6', '7'], roles: ['critic']}).options.at(-1).id, 'F');
});

test('ballot prompts hold only the passage and options', async () => {
  const ai = replies(ballot('A', '첫 번째 근거'), ballot('B'), ballot('A'));
  await run(lunch(), ai);
  const user = ai.calls[1].messages[0].text;
  assert.match(user, /점심은 무엇으로\?/);
  assert.match(user, /A\. 짜장/);
  assert.match(user, /B\. 짬뽕/);
  assert.doesNotMatch(user, /첫 번째 근거/);
  assert.match(ai.calls[0].system, /JSON/);
  assert.equal(ai.calls[0].maxTokens, 400);
});

test('ballots parse from plain or fenced JSON and reject unknown choices', () => {
  const options = [{id: 'A', text: 'x'}, {id: 'B', text: 'y'}];
  assert.deepEqual(parseBallot('{"choice":"b","reason":" r ","concern":"c"}', options), {choice: 'B', reason: 'r', concern: 'c'});
  assert.equal(parseBallot('```json\n{"choice":"ABSTAIN","reason":"r","concern":"c"}\n```', options).choice, 'ABSTAIN');
  assert.equal(parseBallot('{"choice":"C"}', options), null);
  assert.equal(parseBallot('I pick A', options), null);
  assert.equal(parseBallot('{bad json}', options), null);
});

test('ballots are found among other braces and keep only text fields', () => {
  const options = [{id: 'A', text: 'x'}, {id: 'B', text: 'y'}];
  assert.deepEqual(parseBallot('Options {A,B}. {"choice":"A","reason":"r","concern":"c"}', options), {choice: 'A', reason: 'r', concern: 'c'});
  assert.equal(parseBallot('{"choice":"Z","reason":"x"} then {"choice":"B","reason":"y"}', options).choice, 'B');
  assert.deepEqual(parseBallot('{"choice":"A","reason":{"why":"x"},"concern":3}', options), {choice: 'A', reason: '', concern: ''});
});

test('results stay hidden until every ballot is settled', async () => {
  const thread = lunch();
  assert.equal(tally(thread), null);
  await run(thread, replies(ballot('A'), ballot('B'), ballot('ABSTAIN')));
  assert.equal(thread.status, 'done');
  const result = tally(thread);
  assert.deepEqual(result.counts, {A: 1, B: 1, ABSTAIN: 1});
  assert.deepEqual(result.ballots.map(b => [b.role, b.choice, b.model]), [['analyst', 'A', 'openai/gpt-5-mini'], ['critic', 'B', 'openai/gpt-5-mini'], ['editor', 'ABSTAIN', 'openai/gpt-5-mini']]);
});

test('an unreadable ballot fails as a format error and can be skipped', async () => {
  const thread = lunch();
  const store = memoryStore();
  await run(thread, replies(ballot('A'), 'I pick B'), store);
  assert.equal(thread.status, 'failed');
  assert.deepEqual([thread.turns[1].status, thread.turns[1].error], ['failed', 'format']);
  assert.deepEqual(store.settings.seenModels, ['openai/gpt-5-mini']);
  assert.equal(tally(thread), null);
  skipTurn(thread, 1);
  await run(thread, replies(ballot('A')), store);
  assert.deepEqual(tally(thread).counts, {A: 2, B: 0, ABSTAIN: 0});
});
