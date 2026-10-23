import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore, jsonBytes, MAX_RECORD_BYTES, storageErrorKind} from '../bundle/store.mjs';
import {memory} from './memory-storage.mjs';
import {createDiscussion, discussionPlan} from '../bundle/discussion.mjs';
import {runThread} from '../bundle/runner.mjs';
import {defaultSettings, recordModel} from '../bundle/roles.mjs';
const draft = id => createDiscussion({id, request: '검토', roles: ['analyst', 'critic', 'editor']});

test('two store instances keep independent records and channels, including first use', async () => {
  const m = memory(), a = createStore(m.storage), b = createStore(m.storage);
  await Promise.all([a.saveThread(draft('a')), b.saveThread(draft('b')),
    a.saveChannel({id: 'a', title: 'A'}), b.saveChannel({id: 'b', title: 'B'})]);
  assert.deepEqual((await a.listThreads()).map(x => x.id).sort(), ['a', 'b']);
  assert.deepEqual((await a.listChannels()).map(x => x.id).sort(), ['a', 'b']);
  assert.equal(m.kv.threads, undefined);
  assert.equal(m.kv.channels, undefined);
});

test('stale edits and deletes cannot overwrite another device or resurrect a deletion', async () => {
  const m = memory(), a = createStore(m.storage), b = createStore(m.storage);
  await a.saveThread(draft('x'));
  const first = await a.loadThread('x'), stale = await b.loadThread('x');
  first.title = 'new'; await a.saveThread(first);
  stale.title = 'old';
  await assert.rejects(b.saveThread(stale), error => storageErrorKind(error) === 'conflict');
  await assert.rejects(b.deleteThread('x', stale._etag), error => storageErrorKind(error) === 'conflict');
  assert.equal((await a.loadThread('x')).title, 'new');
  await a.deleteThread('x', first._etag);
  await assert.rejects(b.saveThread(stale), error => storageErrorKind(error) === 'conflict');
  assert.equal(await a.loadThread('x'), null);
});

test('competing starts reserve one run before any AI request; opening an active run cannot steal it', async () => {
  const m = memory(), a = createStore(m.storage), b = createStore(m.storage);
  await a.saveThread(draft('x'));
  const left = await a.loadThread('x'), right = await b.loadThread('x');
  let calls = 0, unblock;
  const gate = new Promise(resolve => { unblock = resolve; });
  const ai = {async speak() { calls++; await gate; return {text: 'response', model: 'test'}; }};
  const run = (thread, store) => runThread({thread, store, plan: discussionPlan, ai, settings: defaultSettings()});
  const first = run(left, a);
  while (!calls) await new Promise(resolve => setImmediate(resolve));
  await run(right, b);
  assert.equal(calls, 1);
  assert.equal(right.savePending, true);
  const reopened = await b.loadThread('x');
  await run(reopened, b);
  assert.equal(calls, 1);
  assert.equal(reopened.saveError, 'busy');
  unblock(); await first;
  assert.equal(calls, 9);
  assert.equal((await b.loadThread('x')).status, 'done');
});

test('legacy channel CAS merges independent edits but rejects stale edits of the same channel', async () => {
  const m = memory({channels: [{id: 'a', title: 'A'}, {id: 'b', title: 'B'}]});
  const a = createStore(m.storage), b = createStore(m.storage);
  const [left, right] = await Promise.all([a.listChannels(), b.listChannels()]);
  await Promise.all([a.saveChannel({...left[0], title: 'A2'}), b.saveChannel({...right[1], title: 'B2'})]);
  assert.deepEqual((await a.listChannels()).map(x => x.title), ['A2', 'B2']);
  await assert.rejects(b.saveChannel({...right[0], title: 'stale'}), error => storageErrorKind(error) === 'conflict');
});

test('new channel edits use conditional writes', async () => {
  const m = memory(), a = createStore(m.storage), b = createStore(m.storage);
  await a.saveChannel({id: 'a', title: 'A'});
  const [left] = await a.listChannels(), [right] = await b.listChannels();
  await a.saveChannel({...left, title: 'latest'});
  await assert.rejects(b.saveChannel({...right, title: 'stale'}), error => storageErrorKind(error) === 'conflict');
  assert.equal((await a.listChannels())[0].title, 'latest');
});

test('concurrent first-time settings preserve language, roles and both observed models', async () => {
  const m = memory(), a = createStore(m.storage), b = createStore(m.storage);
  await Promise.all([
    a.updateSettings(current => ({...recordModel(current, 'A'), language: 'ja'})),
    b.updateSettings(current => ({...recordModel(current, 'B'), roles: {...current.roles, critic: {...current.roles.critic, family: 'gpt'}}})),
  ]);
  const settings = await a.loadSettings();
  assert.equal(settings.language, 'ja');
  assert.equal(settings.roles.critic.family, 'gpt');
  assert.deepEqual(settings.seenModels.sort(), ['A', 'B']);
});

test('maximum Korean deep discussion round trips; oversized record never overwrites it', async () => {
  const m = memory(), store = createStore(m.storage), thread = draft('long');
  thread.request = '한'.repeat(4000);
  for (const turn of thread.turns) Object.assign(turn, {text: '한'.repeat(8000), status: 'done'});
  thread.status = 'done';
  assert.ok(jsonBytes(thread) < MAX_RECORD_BYTES);
  await store.saveThread(thread);
  assert.equal((await store.loadThread('long')).turns[8].text.length, 8000);
  const before = structuredClone(m.kv['thread/long']);
  thread.request += '한'.repeat(MAX_RECORD_BYTES);
  await assert.rejects(store.saveThread(thread), error => storageErrorKind(error) === 'capacity');
  assert.deepEqual(m.kv['thread/long'], before);
});

test('thousands of records paginate without a growing aggregate row or rewriting history', async () => {
  const m = memory(), store = createStore(m.storage);
  for (let i = 0; i < 1500; i++) {
    const value = {...draft(`t${i}`), title: '한'.repeat(80), updated: i};
    await store.saveThread(value);
  }
  const logLength = m.log.length;
  assert.equal((await createStore(m.storage).listThreads()).length, 1500);
  assert.equal(m.log.length, logLength);
  assert.equal(m.kv.threads, undefined);
});

test('a missing concurrency token fails closed', async () => {
  const m = memory({'thread/x': draft('x')});
  m.storage.get = async () => ({value: draft('x'), exists: true});
  await assert.rejects(createStore(m.storage).loadThread('x'), error => storageErrorKind(error) === 'concurrency');
});
