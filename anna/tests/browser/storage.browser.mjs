import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDiscussion} from '../../bundle/discussion.mjs';
import {discuss, fault, llm, newChannel, noticeText, ready, runStatus, setup} from './harness.mjs';

test('a concurrent edit preserves the local response and reloads the newer record without AI', async t => {
  const page = await setup(t, {faults: {stallAt: 1}});
  await ready(page); await newChannel(page); await discuss(page);
  await page.waitForSelector('.message[data-status="running"] .message-text:not(.typing)');
  await page.evaluate(async () => {
    const key = Object.keys(window.hostTest.state.kv).find(key => key.startsWith('thread/'));
    const current = await window.hostTest.storage.get({key});
    const value = {...current.value, status: 'done', leaseUntil: 0, title: '다른 기기의 최신 기록', turns: current.value.turns.map(turn => ({...turn, text: '최신 답변', status: 'done'}))};
    await window.hostTest.storage.set({key, value, if_match: current.etag});
  });
  await page.click('.run-foot .stop'); await runStatus(page, 'unsaved');
  assert.match(await page.locator('.save-warning').textContent(), /다른 창/);
  assert.match(await page.locator('.message-text').last().textContent(), /응답/);
  assert.equal(await page.locator('.run-foot .remove').count(), 0);
  assert.equal(await page.locator('.retry-save').count(), 0);
  assert.equal((await llm(page)).length, 1);
  const reload = page.locator('.reload-record');
  await reload.click(); await reload.click();
  await runStatus(page, 'done');
  assert.match(await page.locator('#feed').textContent(), /최신 답변/);
  assert.equal((await llm(page)).length, 1);
});

test('opening an active lease does not stop another window; refresh enables resume after expiry', async t => {
  const thread = createDiscussion({id: 'active', request: '테스트', roles: ['analyst', 'critic', 'editor']});
  Object.assign(thread, {status: 'running', leaseUntil: Date.now() + 150000, runOwner: 'other'});
  thread.turns[0].status = 'running';
  const page = await setup(t, {kv: {'thread/active': thread}}); await ready(page);
  assert.equal(await page.locator('.run-foot .resume').count(), 0);
  assert.match(await page.locator('.save-warning').textContent(), /다른 창에서 진행/);
  assert.equal(await page.evaluate(() => window.hostTest.calls.filter(c => c.method === 'storage.set').length), 0);
  await page.evaluate(async () => {
    const current = await window.hostTest.storage.get({key: 'thread/active'});
    await window.hostTest.storage.set({key: 'thread/active', value: {...current.value, leaseUntil: 0}, if_match: current.etag});
  });
  await page.click('.refresh-run');
  await page.waitForSelector('.run-foot .resume');
  assert.equal((await llm(page)).length, 0);
});

test('capacity guidance keeps received content and save-only retry never spends AI', async t => {
  const page = await setup(t, {faults: {saveAfterReplyAt: 1}});
  await ready(page); await newChannel(page); await discuss(page); await runStatus(page, 'unsaved');
  await fault(page, {save: false, capacity: true}); await page.click('.retry-save');
  await page.waitForFunction(() => document.querySelector('.save-warning')?.textContent.includes('한도'));
  assert.match(await page.locator('#feed').textContent(), /응답 1/);
  assert.equal((await llm(page)).length, 1);
  await fault(page, {capacity: false}); await page.click('.retry-save');
  await runStatus(page, 'stopped'); assert.equal((await llm(page)).length, 1);
});

test('an export read failure does not download a partial history', async t => {
  const thread = createDiscussion({id: 'x', request: '검토', roles: ['analyst', 'critic', 'editor']});
  const page = await setup(t, {kv: {'thread/x': thread}}); await ready(page);
  const downloads = []; page.on('download', value => downloads.push(value));
  await fault(page, {load: true}); await page.click('#export');
  await page.waitForFunction(() => document.querySelector('#notice').textContent !== '');
  assert.match(await noticeText(page), /불러오지 못/);
  assert.equal(downloads.length, 0);
});
