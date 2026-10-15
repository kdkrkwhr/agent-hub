import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {newChannel, noticeText, ready, setup} from './harness.mjs';

const MODEL = 'google/gemini-3-flash-preview';
const turn = (step, role, extra = {}) => ({step, role, status: 'done', text: `${role} ${step}`, model: MODEL, requested: '', error: '', ...extra});
const discussion = {
  id: 'd1', kind: 'discussion', title: '점심 메뉴', request: '점심 메뉴를 정해 줘', roles: ['analyst', 'critic', 'editor'],
  language: 'ko', detail: false, status: 'done', created: 1, updated: 2000, archived: false,
  turns: [
    turn('opinion', 'analyst'), turn('opinion', 'critic', {requested: 'claude'}), turn('opinion', 'editor'),
    turn('rebuttal', 'analyst'), turn('rebuttal', 'critic'), turn('rebuttal', 'editor'),
    turn('final', 'editor', {text: '최종안 본문'}), turn('review', 'analyst'), turn('review', 'critic'),
  ],
};
const ballotVote = {
  id: 'v1', kind: 'vote', title: '어느 쪽', passage: '어느 쪽', options: [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}],
  roles: ['analyst', 'critic'], language: 'ko', detail: false, status: 'failed', created: 2, updated: 1000, archived: false,
  turns: [
    turn('ballot', 'analyst', {text: '{"choice":"A","reason":"빠름","concern":"없음"}'}),
    turn('ballot', 'critic', {status: 'failed', error: 'quota', text: '', model: ''}),
  ],
};
const entry = thread => ({id: thread.id, title: thread.title, kind: thread.kind, status: thread.status, updated: thread.updated, archived: false});
const legacy = () => ({threads: [entry(discussion), entry(ballotVote)], 'thread/d1': discussion, 'thread/v1': ballotVote});
const channelNames = page => page.locator('#channel-list .channel strong').allTextContents();
const noAi = page => page.evaluate(() => !window.hostTest.calls.some(c => c.method.startsWith('llm')));

test('a first visit shows the welcome screen and creates a channel', async t => {
  const page = await setup(t);
  await ready(page);
  assert.match(await page.locator('#feed .empty h2').textContent(), /역할 팀과 대화를 시작하세요/);
  assert.equal(await page.locator('#send').isDisabled(), true);
  await newChannel(page);
  assert.deepEqual(await channelNames(page), ['새 채널 1']);
  assert.equal(await page.locator('#channel-title').textContent(), '새 채널 1');
  assert.match(await page.locator('#feed .empty').textContent(), /정리자가 최종안/);
  assert.deepEqual(await page.locator('#role-chips .chip[aria-pressed="true"]').allTextContents(), ['@분석가', '@비판자', '@정리자']);
  assert.equal(await page.evaluate(() => window.hostTest.state.kv.channels.length), 1);
  assert.ok(await noAi(page));
});

test('earlier records appear in their own channel with every turn and the actual model', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  assert.deepEqual(await channelNames(page), ['이전 기록']);
  assert.equal(await page.locator('#channel-title').textContent(), '이전 기록');
  assert.deepEqual(await page.locator('#feed .run').evaluateAll(runs => runs.map(run => run.dataset.id)), ['v1', 'd1']);
  const run = page.locator('#feed .run[data-id="d1"]');
  assert.equal(await run.locator('.message:not(.user)').count(), 9);
  for (const text of await run.locator('.message .model').allTextContents()) assert.match(text, /google\/gemini-3-flash-preview/);
  assert.equal(await run.locator('.mismatch').count(), 1);
  assert.match(await run.locator('.message[data-step="final"] .message-text').textContent(), /최종안 본문/);
  assert.equal(await page.evaluate(() => Object.hasOwn(window.hostTest.state.kv, 'channels')), false);
  assert.ok(await noAi(page));
});

test('an unfinished vote stays sealed and offers retry and skip', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  const ballots = page.locator('#feed .run[data-id="v1"] .ballot');
  assert.match(await ballots.nth(0).textContent(), /제출 완료/);
  assert.doesNotMatch(await ballots.nth(0).textContent(), /빠름/);
  assert.match(await ballots.nth(1).textContent(), /사용량이 부족해요/);
  assert.equal(await ballots.nth(1).locator('button.retry').count(), 1);
  assert.equal(await ballots.nth(1).locator('button.skip').count(), 1);
  assert.equal(await page.locator('#feed .run[data-id="v1"] .vote-result').count(), 0);
});

test('channels switch, rename and close', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  await newChannel(page);
  assert.deepEqual(await channelNames(page), ['새 채널 2', '이전 기록']);
  assert.equal(await page.locator('#feed .run').count(), 0);
  await page.click('#channel-list .channel[data-id="legacy"]');
  await page.waitForSelector('#feed .run[data-id="d1"]');
  assert.equal(await page.locator('#channel-list .channel.active').getAttribute('data-id'), 'legacy');
  await page.click('#rename');
  await page.fill('#rename-form input[name="title"]', '  점심 회의  ');
  await page.click('#rename-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#channel-title').textContent === '점심 회의');
  assert.equal(await page.evaluate(() => window.hostTest.state.kv.channels.find(c => c.id === 'legacy').title), '점심 회의');
  await page.click('#close-channel');
  await page.waitForFunction(() => document.querySelector('#close-channel').textContent === '다시 열기');
  assert.equal(await page.locator('#composer-closed').isVisible(), true);
  assert.equal(await page.locator('#send').isDisabled(), true);
  await page.click('#channel-list .channel:not([data-id="legacy"])');
  await page.waitForFunction(() => !document.querySelector('#channel-list .channel[data-id="legacy"]'));
  await page.check('#show-closed');
  assert.match(await page.locator('#channel-list .channel[data-id="legacy"]').textContent(), /닫힘/);
  await page.click('#channel-list .channel[data-id="legacy"]');
  await page.click('#close-channel');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
});

test('a channel exports as one Markdown file', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  assert.equal(download.suggestedFilename(), 'agent-hub-channel-legacy.md');
  const text = await readFile(await download.path(), 'utf8');
  assert.match(text, /^# 이전 기록\n\n## 어느 쪽/);
  assert.match(text, /### 최종안/);
  assert.match(text, /최종안 본문/);
  assert.match(text, /\n---\n\n## 점심 메뉴/);
});

test('when the clipboard is blocked the Markdown is shown to copy by hand', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => Promise.reject(new Error('blocked'))}}));
  await page.click('#feed .run[data-id="d1"] .run-foot button.copy');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('직접 복사'));
  assert.equal(await page.locator('#export-text').isVisible(), true);
  assert.match(await page.locator('#export-text').inputValue(), /^# 점심 메뉴/);
});

test('deleting a record needs a second click', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  const remove = page.locator('#feed .run[data-id="d1"] .run-foot button.remove');
  await remove.click();
  assert.equal(await remove.textContent(), '한 번 더 누르면 삭제');
  assert.equal(await page.evaluate(() => Boolean(window.hostTest.state.kv['thread/d1'])), true);
  await remove.click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '삭제했어요');
  assert.equal(await page.evaluate(() => Boolean(window.hostTest.state.kv['thread/d1'])), false);
  assert.deepEqual(await page.locator('#feed .run').evaluateAll(runs => runs.map(run => run.dataset.id)), ['v1']);
});

test('an armed delete button resets after four seconds', async t => {
  const page = await setup(t, {kv: legacy()});
  await ready(page);
  const remove = page.locator('#feed .run[data-id="d1"] .run-foot button.remove');
  await remove.click();
  await page.waitForTimeout(4200);
  assert.equal(await remove.textContent(), '삭제');
});

test('a record left running by a closed window opens as stopped', async t => {
  const running = {...discussion, status: 'running', turns: discussion.turns.map((item, index) => index === 3 ? {...item, status: 'running', text: '부분'} : index > 3 ? {...item, status: 'pending', text: '', model: ''} : item)};
  const page = await setup(t, {kv: {threads: [entry(running)], 'thread/d1': running}});
  await ready(page);
  await page.waitForSelector('#feed .run[data-status="stopped"]');
  assert.equal(await page.locator('#feed .message[data-step="rebuttal"]').first().getAttribute('data-status'), 'stopped');
  assert.equal(await page.locator('#feed .run-foot button.resume').count(), 1);
  await page.waitForFunction(() => window.hostTest.state.kv['thread/d1'].status === 'stopped');
});

test('records missing from the index are recovered on start', async t => {
  const page = await setup(t, {kv: {'thread/d1': discussion}});
  await ready(page);
  assert.deepEqual(await channelNames(page), ['이전 기록']);
  await page.waitForSelector('#feed .run[data-id="d1"]');
});

test('a narrow window opens the channel list as a drawer', async t => {
  const page = await setup(t, {kv: legacy(), viewport: {width: 360, height: 740}});
  await ready(page);
  assert.equal(await page.locator('#menu').isVisible(), true);
  const inView = () => page.locator('#sidebar').evaluate(element => element.getBoundingClientRect().right > 0);
  assert.equal(await inView(), false);
  await page.click('#menu');
  await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().left >= 0);
  await page.click('#scrim', {position: {x: 340, y: 400}});
  await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().right <= 0);
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});

test('connection failure shows a reopen notice', async t => {
  const page = await setup(t, {faults: {connect: true}});
  await page.waitForFunction(() => document.querySelector('#notice').textContent !== '');
  assert.match(await noticeText(page), /Anna에 연결하지 못했어요/);
  assert.equal(await page.locator('#new-channel').isDisabled(), true);
  assert.equal(await page.locator('#send').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.body.dataset.ready), undefined);
});
