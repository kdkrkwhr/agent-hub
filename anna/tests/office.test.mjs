import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDiscussion} from '../bundle/discussion.mjs';
import {createVote} from '../bundle/voting.mjs';
import {pickThreads, voteActors, workActors} from '../bundle/office-model.mjs';
import {HEIGHT, WIDTH, findRoom, officeLayout, route, seat, voteLayout} from '../bundle/office-map.mjs';

const discussion = (roles = ['analyst', 'critic', 'editor']) => createDiscussion({id: 'd1', request: '점심 메뉴', roles, now: 1});
const vote = () => createVote({id: 'v1', passage: '점심은?', options: ['짜장', '짬뽕'], roles: ['analyst', 'critic', 'editor'], now: 2});
const byRole = actors => Object.fromEntries(actors.map(actor => [actor.role, actor]));

test('without a discussion every picked role waits in the lounge', () => {
  const actors = workActors(null, ['editor', 'analyst']);
  assert.deepEqual(actors.map(actor => [actor.role, actor.zone, actor.status]), [['analyst', 'lounge', 'pending'], ['editor', 'lounge', 'pending']]);
});

test('roles move to the room of their current or last step', () => {
  const thread = discussion();
  thread.status = 'running';
  Object.assign(thread.turns[0], {status: 'done', text: '분석 의견', model: 'm1'});
  Object.assign(thread.turns[1], {status: 'running', text: '반대'});
  let actors = byRole(workActors(thread));
  assert.equal(actors.analyst.zone, 'research');
  assert.equal(actors.analyst.status, 'done');
  assert.equal(actors.analyst.text, '분석 의견');
  assert.deepEqual([actors.critic.zone, actors.critic.status, actors.critic.speaking, actors.critic.text], ['research', 'running', true, '반대']);
  assert.deepEqual([actors.editor.zone, actors.editor.status], ['lounge', 'pending']);

  for (const turn of thread.turns.slice(1, 5)) Object.assign(turn, {status: 'done', text: turn.step});
  Object.assign(thread.turns[6], {status: 'running', text: ''});
  actors = byRole(workActors(thread));
  assert.equal(thread.turns[6].step, 'final');
  assert.deepEqual([actors.editor.zone, actors.editor.speaking], ['synthesis', true]);
  assert.equal(actors.analyst.zone, 'forum');
  assert.equal(actors.critic.zone, 'forum');
});

test('reviewers sit in the review room, stopped or skipped roles go back to the lounge, finished runs end in the lounge', () => {
  const thread = discussion(['analyst', 'critic']);
  thread.status = 'running';
  for (const turn of thread.turns) Object.assign(turn, {status: 'done', text: turn.step});
  const review = thread.turns.findIndex(turn => turn.step === 'review');
  Object.assign(thread.turns[review], {status: 'running', text: ''});
  assert.equal(byRole(workActors(thread))[thread.turns[review].role].zone, 'review');
  thread.turns[review].status = 'stopped';
  assert.equal(byRole(workActors(thread))[thread.turns[review].role].zone, 'lounge');
  thread.turns[review].status = 'skipped';
  assert.equal(byRole(workActors(thread))[thread.turns[review].role].status, 'skipped');
  thread.turns[review].status = 'failed';
  assert.equal(byRole(workActors(thread))[thread.turns[review].role].zone, 'review');
  thread.status = 'done';
  assert.ok(workActors(thread).every(actor => actor.zone === 'lounge' && actor.status === 'done'));
});

test('ballots stay sealed in booths until every vote is in', () => {
  const thread = vote();
  Object.assign(thread.turns[0], {status: 'done', text: '{"choice":"A","reason":"맛","concern":"없음"}'});
  Object.assign(thread.turns[1], {status: 'running', text: '{"choice":"B"'});
  const actors = byRole(voteActors(thread));
  assert.deepEqual([actors.analyst.zone, actors.analyst.status, actors.analyst.text, actors.analyst.choice], ['booth', 'submitted', '', '']);
  assert.deepEqual([actors.critic.status, actors.critic.speaking, actors.critic.text], ['thinking', true, '']);
  assert.equal(actors.editor.status, 'pending');
});

test('revealed ballots walk to their option, abstentions and invalid ballots to the abstain zone', () => {
  const thread = vote();
  Object.assign(thread.turns[0], {status: 'done', text: '{"choice":"B","reason":"국물","concern":"없음"}', model: 'm'});
  Object.assign(thread.turns[1], {status: 'done', text: '{"choice":"ABSTAIN","reason":"모름","concern":"없음"}'});
  Object.assign(thread.turns[2], {status: 'skipped'});
  const actors = byRole(voteActors(thread));
  assert.deepEqual([actors.analyst.zone, actors.analyst.status, actors.analyst.choice, actors.analyst.text, actors.analyst.model], ['option-B', 'chose', 'B', '국물', 'm']);
  assert.deepEqual([actors.critic.zone, actors.critic.status], ['abstain', 'abstain']);
  assert.deepEqual([actors.editor.zone, actors.editor.status], ['abstain', 'invalid']);
  assert.deepEqual(voteActors(discussion()), []);
});

test('the office shows the running request first, otherwise the latest of each kind', () => {
  const d = discussion();
  const v = vote();
  assert.deepEqual(pickThreads([], null), {work: null, vote: null, room: 'office'});
  assert.deepEqual(pickThreads([d, v], null), {work: d, vote: v, room: 'vote'});
  const d2 = {...discussion(), id: 'd2'};
  assert.deepEqual(pickThreads([d, v, d2], null), {work: d2, vote: v, room: 'office'});
  assert.deepEqual(pickThreads([d, v, d2], v), {work: d2, vote: v, room: 'vote'});
});

test('office rooms fit the map and every route walks through the corridor', () => {
  for (const layout of [officeLayout(), voteLayout([{id: 'A'}, {id: 'B'}, {id: 'C'}, {id: 'D'}, {id: 'E'}, {id: 'F'}], ['analyst', 'critic', 'editor'])]) {
    for (const area of layout.rooms) {
      assert.ok(area.x >= 0 && area.y >= 0 && area.x + area.w <= WIDTH && area.y + area.h <= HEIGHT, area.id);
      for (const role of ['analyst', 'critic', 'editor']) {
        const point = seat(area, role);
        assert.ok(point.x > area.x && point.x < area.x + area.w && point.y > area.y && point.y < area.y + area.h, `${area.id} ${role}`);
      }
    }
  }
  const layout = officeLayout();
  const path = route(layout, findRoom(layout, 'research'), findRoom(layout, 'review'), 'critic');
  assert.deepEqual(path.slice(1, 3).map(point => point.y), [layout.corridor, layout.corridor]);
  assert.deepEqual(path.at(-1), seat(findRoom(layout, 'review'), 'critic'));
  assert.deepEqual(route(layout, findRoom(layout, 'forum'), findRoom(layout, 'forum'), 'editor'), [seat(findRoom(layout, 'forum'), 'editor')]);
  assert.deepEqual(voteLayout([{id: 'A'}, {id: 'B'}], ['editor']).rooms.map(area => area.id), ['booth-editor', 'option-A', 'option-B', 'abstain']);
});
