import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEGACY, channelList, channelOf, channelThreads, createChannel, normalizeChannel} from '../bundle/channels.mjs';

test('a new channel has all roles and a trimmed title', () => {
  assert.deepEqual(createChannel({id: 'c1', title: '  제품   개선  ', now: 5}), {
    id: 'c1', title: '제품 개선', roles: ['analyst', 'critic', 'editor'], archived: false, created: 5, updated: 5,
  });
  assert.equal(createChannel({id: 'c2', title: 'x'.repeat(100), now: 1}).title.length, 60);
});

test('stored channels are cleaned and invalid ones dropped', () => {
  assert.equal(normalizeChannel(null), null);
  assert.equal(normalizeChannel({id: 'a/b', title: 'x'}), null);
  assert.deepEqual(normalizeChannel({id: 'c1', title: '', roles: ['critic', 'nobody', 'analyst'], archived: 'yes', updated: '7'}), {
    id: 'c1', title: 'c1', roles: ['analyst', 'critic'], archived: false, created: 0, updated: 7,
  });
  assert.deepEqual(normalizeChannel({id: 'c1', title: 't', roles: 'all'}).roles, ['analyst', 'critic', 'editor']);
});

test('threads without a channel belong to the legacy channel', () => {
  assert.equal(channelOf({channel: 'c1'}), 'c1');
  assert.equal(channelOf({}), LEGACY);
  assert.equal(channelOf({channel: ''}), LEGACY);
});

test('the channel list counts threads, adds the legacy channel and sorts by latest activity', () => {
  const stored = [createChannel({id: 'a', title: 'A', now: 10}), createChannel({id: 'b', title: 'B', now: 20})];
  const threads = [{id: 't1', channel: 'a', updated: 30}, {id: 't2', channel: 'a', updated: 5}, {id: 't3', updated: 15}];
  const list = channelList(stored, threads, '이전 기록');
  assert.deepEqual(list.map(item => [item.id, item.title, item.count, item.latest]), [['a', 'A', 2, 30], ['b', 'B', 0, 20], [LEGACY, '이전 기록', 1, 15]]);
  assert.equal(list[2].archived, false);
});

test('a stored legacy channel replaces the virtual one', () => {
  const stored = [{...createChannel({id: LEGACY, title: '옛 기록', now: 1}), archived: true}];
  const list = channelList(stored, [{id: 't', updated: 3}], '이전 기록');
  assert.deepEqual(list.map(item => [item.id, item.title, item.count, item.archived]), [[LEGACY, '옛 기록', 1, true]]);
  assert.deepEqual(channelList([], [], '이전 기록'), []);
});

test('channel threads are oldest first and capped', () => {
  const threads = Array.from({length: 35}, (_, i) => ({id: `t${i}`, channel: 'a', created: i + 1, updated: 100 - i}));
  threads.push({id: 'other', channel: 'b', created: 1});
  const picked = channelThreads(threads, 'a');
  assert.equal(picked.length, 30);
  assert.equal(picked[0].id, 't5');
  assert.equal(picked.at(-1).id, 't34');
  assert.deepEqual(channelThreads([{id: 'x', updated: 2}, {id: 'y', updated: 1}], LEGACY).map(item => item.id), ['y', 'x']);
});
