import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup, ready, openTab} from './harness.mjs';

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
const vote = {
  id: 'v1', kind: 'vote', title: '어느 쪽', passage: '어느 쪽', options: [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}],
  roles: ['analyst', 'critic'], language: 'ko', detail: false, status: 'failed', created: 1, updated: 1000, archived: false,
  turns: [
    turn('ballot', 'analyst', {text: '{"choice":"A","reason":"빠름","concern":"없음"}'}),
    turn('ballot', 'critic', {status: 'failed', error: 'quota', text: '', model: ''}),
  ],
};
const entry = thread => ({id: thread.id, title: thread.title, kind: thread.kind, status: thread.status, updated: thread.updated, archived: false});
const seeded = () => ({threads: [entry(discussion), entry(vote)], 'thread/d1': discussion, 'thread/v1': vote});
const titles = page => page.locator('#thread-list .thread-item strong').allTextContents();
const visible = page => page.evaluate(() => [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id));
async function open(page, id) {
  await openTab(page, 'history');
  await page.click(`.thread-item[data-id="${id}"]`);
}

test('tabs switch views and the history lists newest first', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  assert.deepEqual(await visible(page), ['view-discussion']);
  await openTab(page, 'history');
  assert.deepEqual(await visible(page), ['view-history']);
  assert.deepEqual(await titles(page), ['점심 메뉴', '어느 쪽']);
  assert.match(await page.locator('.thread-item[data-id="v1"] .meta').textContent(), /투표 · 실패/);
  await openTab(page, 'settings');
  assert.deepEqual(await visible(page), ['view-settings']);
  assert.equal(await page.locator('#tabs [data-view="settings"]').getAttribute('aria-pressed'), 'true');
});

test('an opened discussion shows every turn with the actual model', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  assert.deepEqual(await visible(page), ['view-thread']);
  assert.equal(await page.locator('#thread-title').textContent(), '점심 메뉴');
  assert.equal(await page.locator('#turns .turn').count(), 9);
  for (const text of await page.locator('#turns .turn .model').allTextContents()) assert.match(text, /실제 모델: google\/gemini-3-flash-preview/);
  assert.equal(await page.locator('#turns .turn .mismatch').count(), 1);
  assert.match(await page.locator('#turns .turn[data-step="opinion"]').nth(1).textContent(), /요청: claude.*요청과 다름/);
  assert.match(await page.locator('#turns .turn[data-step="final"] .text').textContent(), /최종안 본문/);
  assert.equal(await page.evaluate(() => window.hostTest.calls.some(c => c.method.startsWith('llm'))), false);
});

test('vote ballots stay sealed while a ballot is unfinished', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'v1');
  const first = page.locator('#turns .turn').nth(0);
  assert.match(await first.textContent(), /제출 완료/);
  assert.doesNotMatch(await first.textContent(), /빠름/);
  const failed = page.locator('#turns .turn').nth(1);
  assert.match(await failed.textContent(), /사용량이 부족해요/);
  assert.equal(await failed.locator('button.retry').count(), 1);
  assert.equal(await failed.locator('button.skip').count(), 1);
  assert.equal(await page.locator('#vote-result').isHidden(), true);
});

test('a thread exports as a Markdown file', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#thread-actions button.export')]);
  assert.equal(download.suggestedFilename(), 'agent-hub-discussion-d1.md');
  const text = await readFile(await download.path(), 'utf8');
  assert.match(text, /^# 점심 메뉴/);
  assert.match(text, /## 최종안/);
  assert.match(text, /최종안 본문/);
});

test('when the clipboard is blocked the Markdown is shown to copy by hand', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => Promise.reject(new Error('blocked'))}}));
  await open(page, 'd1');
  await page.click('#thread-actions button.copy');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('직접 복사'));
  assert.equal(await page.locator('#export-text').isVisible(), true);
  assert.match(await page.locator('#export-text').inputValue(), /^# 점심 메뉴/);
});

test('archived threads move to the archived list', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  await page.click('#thread-actions button.archive');
  await page.waitForFunction(() => window.hostTest.state.kv['thread/d1'].archived === true);
  await page.click('#back');
  await page.waitForFunction(() => !document.querySelector('.thread-item[data-id="d1"]'));
  assert.deepEqual(await titles(page), ['어느 쪽']);
  await page.check('#show-archived');
  assert.deepEqual(await titles(page), ['점심 메뉴']);
});

test('deleting needs a second click', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  await page.click('#thread-actions button.remove');
  assert.equal(await page.locator('#thread-actions button.remove').textContent(), '한 번 더 누르면 삭제');
  assert.equal(await page.evaluate(() => Boolean(window.hostTest.state.kv['thread/d1'])), true);
  await page.click('#thread-actions button.remove');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '삭제했어요');
  assert.deepEqual(await visible(page), ['view-history']);
  assert.equal(await page.evaluate(() => Boolean(window.hostTest.state.kv['thread/d1'])), false);
  assert.deepEqual(await titles(page), ['어느 쪽']);
});

test('threads missing from the index are recovered on start', async t => {
  const page = await setup(t, {kv: {'thread/d1': discussion}});
  await ready(page);
  await openTab(page, 'history');
  assert.deepEqual(await titles(page), ['점심 메뉴']);
});

test('thread view fits a 360px screen', async t => {
  const page = await setup(t, {kv: seeded(), viewport: {width: 360, height: 740}});
  await ready(page);
  await open(page, 'd1');
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
