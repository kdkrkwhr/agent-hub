import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fault, llm, newChannel, ready, runStatus, setup} from './harness.mjs';
import {PRIORITY_HEADINGS} from '../../bundle/decision.mjs';

const priorityReply = PRIORITY_HEADINGS.ko.map((heading, i) => `## ${heading}\n- ${['메모와 필터를 먼저 만들기', '공동 편집은 미루기', '기록 시간을 줄이는 것이 목표', '테스터가 매일 기록하는지 확인', '메모 입력 프로토타입을 만들기'][i]}`).join('\n\n');

async function start(t, options) {
  const page = await setup(t, options);
  await ready(page);
  await newChannel(page);
  return page;
}
async function quick(page) {
  await page.click('#priority-example');
  await page.click('#send');
}

test('the default priority example is editable, runs four calls and displays a safe decision brief', async t => {
  const page = await start(t, {faults: {priorityReply}});
  assert.equal(await page.locator('#estimate').textContent(), 'AI 호출 4회 예정');
  await page.click('#priority-example');
  assert.match(await page.locator('#composer textarea').inputValue(), /개발 여력.*\n기능 후보/);
  assert.deepEqual(await llm(page), []);
  await page.click('#send');
  await runStatus(page, 'done');
  const calls = await llm(page);
  assert.equal(calls.length, 4);
  assert.doesNotMatch(calls[1].text, /응답 1/);
  assert.match(calls[3].text, /응답 1[\s\S]*응답 2[\s\S]*응답 3/);
  assert.deepEqual(await page.locator('.decision-section h3').allTextContents(), PRIORITY_HEADINGS.ko);
  assert.match(await page.locator('.decision-card').textContent(), /별도 반박·동료 검토 단계는 없/);
  assert.equal(await page.locator('.discussion-history').getAttribute('open'), null);
  await page.locator('.discussion-history summary').click();
  assert.equal(await page.locator('.message[data-step="opinion"]:visible').count(), 3);
  await page.click('#view-tabs [data-view="office"]');
  await page.click('#view-tabs [data-view="chat"]');
  assert.equal((await llm(page)).length, 4);
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('.decision-section').count(), 5);
  assert.deepEqual(await llm(page), []);
});

test('saving failure retains the reply across channel changes and save-only retries never call AI', async t => {
  const page = await start(t, {faults: {saveAfterReplyAt: 1}});
  await quick(page);
  await runStatus(page, 'unsaved');
  assert.equal((await llm(page)).length, 1);
  assert.match(await page.locator('.run').textContent(), /응답 1/);
  await page.click('.retry-save');
  assert.equal((await llm(page)).length, 1);
  await fault(page, {save: false, saveAfterReplyAt: 0});
  await newChannel(page);
  await page.click('#channel-list .channel:last-child');
  await runStatus(page, 'unsaved');
  assert.match(await page.locator('.run').textContent(), /응답 1/);
  await page.click('.retry-save');
  await runStatus(page, 'stopped');
  assert.equal((await llm(page)).length, 1);
  await page.click('.run-foot button.resume');
  await runStatus(page, 'done');
  assert.equal((await llm(page)).length, 4);
  assert.equal(await page.locator('.message[data-step="opinion"] .message-text').first().textContent(), '응답 1');
});

test('an empty result pauses after one call; manual retry resumes only unfinished work', async t => {
  const page = await start(t, {faults: {emptyAt: 2}});
  await quick(page);
  await runStatus(page, 'failed');
  assert.equal((await llm(page)).length, 2);
  assert.match(await page.locator('.error').textContent(), /빈 응답/);
  await fault(page, {emptyAt: 0});
  await page.click('button.retry');
  await runStatus(page, 'done');
  assert.equal((await llm(page)).length, 5);
});

test('unexpected model formatting is fully visible as text and cannot create executable HTML', async t => {
  const text = '<img src=x onerror=alert(1)>\nA nonstandard result with all its caveats.';
  const page = await start(t, {faults: {priorityReply: text}});
  await quick(page);
  await runStatus(page, 'done');
  assert.equal(await page.locator('.decision-card > .decision-text').textContent(), text);
  assert.equal(await page.locator('.decision-card img').count(), 0);
  assert.equal((await llm(page)).length, 4);
});

test('priority controls and a complete result fit 360px without losing an existing draft', async t => {
  const page = await start(t, {viewport: {width: 360, height: 640}, faults: {priorityReply}});
  await page.fill('#composer textarea', 'My own project');
  await page.click('#priority-example');
  assert.equal(await page.locator('#composer textarea').inputValue(), 'My own project');
  await page.click('#send');
  await runStatus(page, 'done');
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
  assert.ok(await page.evaluate(() => document.querySelector('#feed').scrollWidth <= document.querySelector('#feed').clientWidth));
  const send = await page.locator('#send').boundingBox();
  assert.ok(send.y >= 0 && send.y + send.height <= 640);
  assert.equal((await llm(page)).length, 4);
});
