import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore, threadKey} from '../bundle/store.mjs';
import {defaultSettings, recordModel} from '../bundle/roles.mjs';

function memory(seed = {}) {
  const kv = structuredClone(seed), log = [];
  return {kv, log, storage: {
    async get({key}) { return Object.hasOwn(kv, key) ? {value: structuredClone(kv[key]), exists: true} : {value: null, exists: false}; },
    async set({key, value}) { log.push(key); kv[key] = structuredClone(value); return {etag: 'e'}; },
    async list({prefix = '', cursor, limit = 100}) {
      const keys = Object.keys(kv).filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? keys.indexOf(cursor) + 1 : 0, page = keys.slice(start, start + limit);
      return {items: page.map(key => ({key})), next_cursor: start + limit < keys.length ? page.at(-1) : null};
    },
    async delete({key}) { if (!Object.hasOwn(kv, key)) throw Object.assign(new Error('missing'), {code: 'not_found'}); delete kv[key]; return {deleted: true}; },
  }};
}
const thread = (id, updated, extra = {}) => ({id, title: `T${id}`, kind: 'discussion', status: 'running', updated, ...extra});

test('settings load as defaults and save normalized', async () => {
  const m = memory();
  const store = createStore(m.storage);
  assert.deepEqual(await store.loadSettings(), defaultSettings());
  const saved = await store.saveSettings({...defaultSettings(), language: 'en', roles: {critic: {temperament: 'deep', family: 'gpt', model: ''}}});
  assert.equal(m.kv.settings.language, 'en');
  assert.deepEqual(saved.roles.critic, {temperament: 'deep', family: 'gpt', model: ''});
  assert.deepEqual(saved.roles.analyst, {temperament: 'balanced', family: 'auto', model: ''});
});

test('a thread is written before its index entry, newest first', async () => {
  const m = memory();
  const store = createStore(m.storage);
  await store.saveThread(thread('a', 1));
  await store.saveThread(thread('b', 2, {title: 'x'.repeat(200)}));
  await store.saveThread(thread('a', 3, {status: 'done'}));
  assert.deepEqual(m.log, ['thread/a', 'threads', 'thread/b', 'threads', 'thread/a', 'threads']);
  const index = await store.listThreads();
  assert.deepEqual(index.map(t => [t.id, t.status]), [['a', 'done'], ['b', 'running']]);
  assert.equal(index[1].title.length, 80);
  assert.equal((await store.loadThread('a')).status, 'done');
  assert.equal(await store.loadThread('missing'), null);
});

test('deleting removes the thread and its index entry, even if already gone', async () => {
  const m = memory();
  const store = createStore(m.storage);
  await store.saveThread(thread('a', 1));
  await store.deleteThread('a');
  assert.equal(Object.hasOwn(m.kv, threadKey('a')), false);
  assert.deepEqual(await store.listThreads(), []);
  await store.deleteThread('a');
});

test('repair adds orphaned threads, drops missing ones and ignores chunks', async () => {
  const seed = {threads: [{id: 'gone', title: 'G', kind: 'vote', status: 'done', updated: 9, archived: false}]};
  for (let i = 0; i < 250; i++) seed[threadKey(`t${i}`)] = thread(`t${i}`, i);
  seed['thread/t1/0'] = {chunk: true};
  const m = memory(seed);
  const store = createStore(m.storage);
  const index = await store.repairIndex();
  assert.equal(index.length, 250);
  assert.equal(index.some(t => t.id === 'gone'), false);
  assert.equal(index[0].id, 't249');
  m.log.length = 0;
  await store.repairIndex();
  assert.deepEqual(m.log, [], 'a consistent index is not rewritten');
});

test('repair accepts the dev harness listing shape', async () => {
  const m = memory({[threadKey('a')]: thread('a', 1), [threadKey('b')]: thread('b', 2)});
  const list = m.storage.list;
  m.storage.list = async query => { const page = await list(query); return {entries: page.items, cursor: page.next_cursor}; };
  const index = await createStore(m.storage).repairIndex();
  assert.deepEqual(index.map(t => t.id), ['b', 'a']);
});

test('repair rejects an invalid listing and keeps the index', async () => {
  const threads = [{id: 'a', title: 'Ta', kind: 'discussion', status: 'running', updated: 1, archived: false}];
  const m = memory({threads, [threadKey('a')]: thread('a', 1)});
  m.storage.list = async () => ({});
  await assert.rejects(createStore(m.storage).repairIndex(), /Invalid storage listing/);
  assert.deepEqual(m.kv.threads, threads);
  assert.deepEqual(m.log, []);
});

const slow = m => {
  const get = m.storage.get;
  m.storage.get = async query => { const value = await get(query); await new Promise(r => setTimeout(r, 5)); return value; };
  return m;
};

test('concurrent thread saves keep every index entry', async () => {
  const m = slow(memory());
  const store = createStore(m.storage);
  await Promise.all([store.saveThread(thread('a', 1)), store.saveThread(thread('b', 2))]);
  assert.deepEqual(m.kv.threads.map(t => t.id), ['b', 'a']);
});

test('a failed write does not block later writes', async () => {
  const m = memory();
  const set = m.storage.set;
  let fail = true;
  m.storage.set = async query => { if (fail) { fail = false; throw new Error('down'); } return set(query); };
  const store = createStore(m.storage);
  const first = store.saveThread(thread('a', 1));
  const second = store.saveThread(thread('b', 2));
  await assert.rejects(first, /down/);
  assert.deepEqual((await second).map(t => t.id), ['b']);
});

test('thread ids are validated before writing', async () => {
  const m = memory();
  const store = createStore(m.storage);
  await assert.rejects(store.saveThread(thread('a/b', 1)), /Invalid thread id/);
  await assert.rejects(store.saveThread(thread('', 1)), /Invalid thread id/);
  assert.deepEqual(m.log, []);
});

test('index entries without a time sort last', async () => {
  const m = memory({threads: [{id: 'x', title: 'X', kind: 'vote', status: 'done', updated: undefined, archived: false}]});
  const store = createStore(m.storage);
  await store.saveThread(thread('a', 1));
  await store.saveThread(thread('b', 2));
  assert.deepEqual((await store.listThreads()).map(t => t.id), ['b', 'a', 'x']);
});

test('concurrent settings updates both survive', async () => {
  const m = slow(memory());
  const store = createStore(m.storage);
  const [, last] = await Promise.all([
    store.updateSettings(current => ({...current, language: 'en'})),
    store.updateSettings(current => recordModel(current, 'openai/gpt-5-mini')),
  ]);
  assert.equal(last.language, 'en');
  assert.deepEqual(last.seenModels, ['openai/gpt-5-mini']);
  assert.equal(m.kv.settings.language, 'en');
  assert.deepEqual(m.kv.settings.seenModels, ['openai/gpt-5-mini']);
});
