import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canSkip, createDiscussion, discussionPlan, discussionSteps} from '../bundle/discussion.mjs';
import {newId, runThread, saveThreadOnly, settleInterrupted, skipTurn} from '../bundle/runner.mjs';
import {AiError} from '../bundle/ai.mjs';
import {defaultSettings} from '../bundle/roles.mjs';

const MODEL = 'google/gemini-3-flash-preview';

function fakeAi(script = () => null) {
  const calls = [];
  return {calls, async speak(args) {
    calls.push(args);
    const planned = script(calls.length, args);
    if (planned instanceof Error) throw planned;
    args.onToken?.('…');
    return planned || {text: `reply ${calls.length}`, model: MODEL};
  }};
}

function fakeStore({failSaves = 0, settings = defaultSettings()} = {}) {
  const saved = [];
  return {
    saved,
    get settings() { return settings; },
    async saveThread(thread) {
      if (failSaves > 0) { failSaves -= 1; throw new Error('storage down'); }
      saved.push(structuredClone(thread));
    },
    async updateSettings(change) { settings = change(settings); return settings; },
  };
}

const lunch = (roles = ['analyst', 'critic', 'editor']) => createDiscussion({id: 'd1', request: '점심 메뉴를 정해 줘\n근처에서', roles, language: 'ko', now: 1});
const run = (thread, ai, store, extra = {}) => runThread({thread, plan: discussionPlan, ai, store, settings: store.settings, now: () => 5, ...extra});

test('three roles take nine turns and the editor writes the final', () => {
  assert.deepEqual(discussionSteps(['analyst', 'critic', 'editor']).map(s => `${s.step}:${s.role}`), [
    'opinion:analyst', 'opinion:critic', 'opinion:editor',
    'rebuttal:analyst', 'rebuttal:critic', 'rebuttal:editor',
    'final:editor', 'review:analyst', 'review:critic',
  ]);
  assert.deepEqual(discussionSteps(['analyst', 'critic']).map(s => `${s.step}:${s.role}`), [
    'opinion:analyst', 'opinion:critic', 'rebuttal:analyst', 'rebuttal:critic', 'final:critic', 'review:analyst',
  ]);
});

test('a discussion needs a request and two roles, kept in role order', () => {
  assert.throws(() => createDiscussion({id: 'x', request: '  ', roles: ['analyst', 'critic']}), /Empty request/);
  assert.throws(() => createDiscussion({id: 'x', request: 'q', roles: ['critic']}), /Need two roles/);
  const thread = createDiscussion({id: 'x', request: `${'긴 제목'.repeat(40)}\n둘째 줄`, roles: ['editor', 'analyst'], now: 7});
  assert.deepEqual(thread.roles, ['analyst', 'editor']);
  assert.equal(thread.title.length, 80);
  assert.equal(thread.status, 'ready');
  assert.deepEqual(thread.turns[0], {step: 'opinion', role: 'analyst', status: 'pending', text: '', model: '', requested: '', error: ''});
});

test('first-round opinions never see other replies', async () => {
  const ai = fakeAi();
  await run(lunch(), ai, fakeStore());
  const user = i => ai.calls[i].messages[0].text;
  assert.equal(ai.calls.length, 9);
  for (const i of [0, 1, 2]) assert.doesNotMatch(user(i), /reply/);
  assert.match(ai.calls[0].system, /분석가/);
  for (const n of [1, 2, 3]) assert.match(user(3), new RegExp(`reply ${n}`));
  assert.match(user(6), /reply 6/);
  assert.match(user(7), /reply 7/);
  assert.doesNotMatch(user(7), /reply 1\b/);
  assert.deepEqual(ai.calls.map(c => c.maxTokens), [600, 600, 600, 600, 600, 600, 1200, 600, 600]);
});

test('each turn keeps the actual model and the seen-model list grows', async () => {
  const base = defaultSettings();
  const store = fakeStore({settings: {...base, roles: {...base.roles, critic: {temperament: 'deep', family: 'gpt', model: ''}}}});
  const ai = fakeAi();
  const {thread, settings} = await run(lunch(), ai, store);
  assert.equal(thread.status, 'done');
  assert.ok(thread.turns.every(t => t.status === 'done' && t.model === MODEL));
  assert.equal(thread.turns[1].requested, 'gpt');
  assert.deepEqual(ai.calls[1].preferences.hints, [{name: 'gpt'}]);
  assert.equal(ai.calls[0].preferences.hints, undefined);
  assert.deepEqual(settings.seenModels, [MODEL]);
  assert.equal(store.saved.at(-1).status, 'done');
  assert.equal(store.saved.at(-1).updated, 5);
});

test('a failed turn stops the run and a retry skips finished turns', async () => {
  const store = fakeStore();
  const thread = lunch();
  const result = await run(thread, fakeAi(n => n === 4 ? new AiError('quota', 'quota') : null), store);
  assert.equal(result.thread.status, 'failed');
  assert.deepEqual([thread.turns[3].status, thread.turns[3].error], ['failed', 'quota']);
  assert.equal(store.saved.at(-1).status, 'failed');
  const second = fakeAi();
  await run(thread, second, store);
  assert.equal(second.calls.length, 6);
  assert.equal(thread.status, 'done');
});

test('stopping keeps the partial reply as stopped', async () => {
  const {thread} = await run(lunch(), fakeAi(n => n === 2 ? new AiError('aborted', 'aborted', '부분') : null), fakeStore());
  assert.equal(thread.status, 'stopped');
  assert.deepEqual([thread.turns[1].status, thread.turns[1].text, thread.turns[1].error], ['stopped', '부분', '']);
});

test('a skipped role is left out and the run continues; the final cannot be skipped', async () => {
  const thread = lunch();
  const store = fakeStore();
  await run(thread, fakeAi(n => n === 4 ? new AiError('provider', 'down') : null), store);
  skipTurn(thread, 3);
  const ai = fakeAi();
  await run(thread, ai, store);
  assert.equal(ai.calls.length, 5);
  assert.equal(thread.turns[3].status, 'skipped');
  assert.equal(thread.status, 'done');
  assert.equal(canSkip(thread.turns[6]), false);
  assert.equal(canSkip(thread.turns[3]), true);
});

test('a failed preflight save prevents every AI call until explicitly saved and resumed', async () => {
  const flags = [];
  const store = fakeStore({failSaves: 1});
  const thread = lunch(), ai = fakeAi();
  const result = await run(thread, ai, store, {onUpdate: (thread, {saveFailed}) => flags.push(saveFailed)});
  assert.ok(flags.includes(true));
  assert.equal(result.saveFailed, true);
  assert.equal(ai.calls.length, 0);
  assert.equal(thread.turns[0].status, 'pending');
  await run(thread, ai, store);
  assert.equal(ai.calls.length, 0, 'ordinary retry cannot bypass a pending save');
  assert.equal((await saveThreadOnly({thread, store})).saved, true);
  assert.equal(ai.calls.length, 0);
  await run(thread, ai, store);
  assert.equal(ai.calls.length, 9);
  assert.equal(store.saved.at(-1).status, 'done');
});

test('persistent storage failure after a response stops at one AI call and save-only recovery preserves it', async () => {
  const thread = lunch(), store = fakeStore(), ai = fakeAi();
  const original = store.saveThread;
  let writes = 0, fail = true;
  store.saveThread = async value => {
    if (++writes >= 2 && fail) throw new Error('persistent failure');
    return original(value);
  };
  const result = await run(thread, ai, store);
  assert.equal(result.saveFailed, true);
  assert.equal(ai.calls.length, 1);
  assert.equal(thread.turns[0].text, 'reply 1');
  assert.equal(thread.turns[0].status, 'done');
  assert.equal(thread.status, 'stopped');
  assert.equal((await saveThreadOnly({thread, store})).saved, false);
  assert.equal(ai.calls.length, 1);
  fail = false;
  await saveThreadOnly({thread, store});
  assert.equal(ai.calls.length, 1);
  assert.equal(store.saved.at(-1).turns[0].text, 'reply 1');
  await run(thread, ai, store);
  assert.equal(ai.calls.length, 9);
  assert.equal(thread.turns[0].text, 'reply 1');
});

test('an empty or overlong reply stops instead of completing the discussion', async () => {
  for (const [text, expected] of [['  \n', 'empty'], ['x'.repeat(8001), 'incomplete']]) {
    const ai = fakeAi(() => ({text, model: MODEL}));
    const {thread} = await run(lunch(), ai, fakeStore());
    assert.equal(ai.calls.length, 1);
    assert.equal(thread.status, 'failed');
    assert.equal(thread.turns[0].error, expected);
    assert.ok(thread.turns[0].text.length <= 8000);
  }
});

test('every AI call has a persisted in-flight marker and no call begins after abort', async () => {
  const store = fakeStore(), thread = lunch(), controller = new AbortController();
  const ai = fakeAi((n) => {
    const saved = store.saved.at(-1);
    assert.equal(saved.status, 'running');
    assert.equal(saved.turns[n - 1].status, 'running');
    controller.abort();
  });
  await run(thread, ai, store, {signal: controller.signal});
  assert.equal(ai.calls.length, 1);
  assert.equal(thread.status, 'stopped');
});

test('quick priority review gathers independent opinions then synthesises in four calls', async () => {
  const thread = createDiscussion({id: 'quick', request: 'Build notes before themes?', roles: ['analyst', 'critic', 'editor'], mode: 'quick', purpose: 'priority', language: 'en'});
  const ai = fakeAi();
  await run(thread, ai, fakeStore());
  assert.equal(ai.calls.length, 4);
  assert.deepEqual(thread.turns.map(turn => turn.step), ['opinion', 'opinion', 'opinion', 'final']);
  for (const call of ai.calls.slice(0, 3)) assert.doesNotMatch(call.messages[0].text, /reply/);
  assert.match(ai.calls[3].messages[0].text, /reply 1[\s\S]*reply 2[\s\S]*reply 3/);
  assert.match(ai.calls[3].system, /## Build first[\s\S]*## Defer[\s\S]*## Next action/);
  assert.match(ai.calls[3].system, /Do not invent/);
  assert.equal(discussionSteps(['analyst', 'critic'], 'quick').length, 3);
});

test('unexpected errors become unavailable failures', async () => {
  const {thread} = await run(lunch(), fakeAi(() => new Error('weird')), fakeStore());
  assert.deepEqual([thread.status, thread.turns[0].error], ['failed', 'unavailable']);
});

test('a throwing update listener does not stop the run', async () => {
  const store = fakeStore();
  const result = await run(lunch(), fakeAi(), store, {onUpdate: () => { throw new Error('render failed'); }});
  assert.equal(result.thread.status, 'done');
  assert.equal(store.saved.at(-1).status, 'done');
});

test('settings missing a role run that role with defaults', async () => {
  const base = defaultSettings();
  const store = fakeStore({settings: {...base, roles: {analyst: base.roles.analyst}}});
  const ai = fakeAi();
  const {thread} = await run(lunch(), ai, store);
  assert.equal(thread.status, 'done');
  assert.equal(ai.calls.length, 9);
  assert.equal(thread.turns[1].requested, '');
});

test('skipping clears the partial text and never skips the final', () => {
  const thread = lunch();
  Object.assign(thread.turns[3], {status: 'failed', error: 'quota', text: '부분'});
  Object.assign(thread.turns[6], {status: 'failed', error: 'quota', text: '초안'});
  skipTurn(thread, 3);
  assert.deepEqual([thread.turns[3].status, thread.turns[3].text], ['skipped', '']);
  skipTurn(thread, 6);
  assert.deepEqual([thread.turns[6].status, thread.turns[6].text], ['failed', '초안']);
});

test('a thread left running by a closed app settles as stopped', () => {
  const thread = lunch();
  thread.status = 'running';
  thread.turns[0].status = 'done';
  Object.assign(thread.turns[1], {status: 'running', text: '부분'});
  assert.equal(settleInterrupted(thread), thread);
  assert.equal(thread.status, 'stopped');
  assert.deepEqual(thread.turns.slice(0, 3).map(t => t.status), ['done', 'stopped', 'pending']);
  assert.equal(thread.turns[1].text, '부분');
  const done = {...lunch(), status: 'done'};
  assert.equal(settleInterrupted(done).status, 'done');
});

test('thread ids are storage-safe and unique', () => {
  const a = newId(1760000000000, () => 0.1), b = newId(1760000000000, () => 0.2);
  assert.match(a, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(a, b);
});
