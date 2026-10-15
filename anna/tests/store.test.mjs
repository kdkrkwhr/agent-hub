import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore, threadKey} from '../bundle/store.mjs';
import {defaultSettings} from '../bundle/roles.mjs';

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
