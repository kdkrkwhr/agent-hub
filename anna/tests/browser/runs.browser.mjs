import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discuss, fault, lastRun, llm, newChannel, noticeText, openSettings, ready, runStatus, setup, vote} from './harness.mjs';

async function start(t, options) {
  const page = await setup(t, options);
  await ready(page);
  await newChannel(page);
  return page;
}

test('a discussion runs nine turns as role bubbles with the actual model', async t => {
  const page = await start(t);
  assert.equal(await page.locator('#estimate').textContent(), 'AI 호출 9회 예정');
  await discuss(page);
  await runStatus(page, 'done');
  assert.equal((await llm(page)).length, 9);
  const run = lastRun(page);
  assert.equal(await run.locator('.message.user .message-text').textContent(), '점심 메뉴를 정해 줘');
  assert.equal(await run.locator('.message[data-status="done"]').count(), 9);
  assert.deepEqual(await run.locator('.message[data-step="opinion"] .avatar').allTextContents(), ['AN', 'CR', 'ED']);
  for (const text of await run.locator('.message .model').allTextContents()) assert.match(text, /mock\/gemini-test/);
  assert.match(await run.locator('.pill').textContent(), /토론 · 완료/);
  assert.equal(await page.locator('#composer textarea[name="request"]').inputValue(), '');
  assert.deepEqual(await page.evaluate(() => window.hostTest.state.kv.settings.seenModels), ['mock/gemini-test']);
  assert.match(await page.locator('#channel-list .channel.active small').textContent(), /기록 1건/);
});

test('first-round opinions are independent', async t => {
  const page = await start(t);
  await discuss(page);
  await runStatus(page, 'done');
  const calls = await llm(page);
  assert.doesNotMatch(calls[1].text, /응답 1/);
  assert.doesNotMatch(calls[2].text, /응답 [12]/);
  assert.match(calls[3].text, /응답 1[\s\S]*응답 2[\s\S]*응답 3/);
  assert.match(calls[0].system, /분석가/);
});

test('a requested family that Anna did not use is flagged', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {critic: {temperament: 'deep', family: 'claude', model: ''}}, seenModels: []};
  const page = await start(t, {kv: {settings}});
  await discuss(page);
  await runStatus(page, 'done');
  const calls = await llm(page);
  assert.deepEqual(calls[1].hints, [{name: 'claude'}]);
  assert.deepEqual(calls[0].hints, []);
  assert.equal(await page.locator('.message.role-critic .mismatch').count(), 3);
  assert.equal(await page.locator('.message.role-analyst .mismatch').count(), 0);
  assert.match(await page.locator('.message.role-critic .model').first().textContent(), /요청: claude.*요청과 다름/);
});

test('a quota failure explains the problem and can be retried', async t => {
  const page = await start(t, {faults: {quota: true}});
  await discuss(page);
  await runStatus(page, 'failed');
  assert.match(await noticeText(page), /사용량이 부족해요/);
  const failed = lastRun(page).locator('.message[data-status="failed"]');
  assert.match(await failed.textContent(), /사용량이 부족해요/);
  await fault(page, {quota: false});
  await failed.locator('button.retry').click();
  await runStatus(page, 'done');
  assert.equal((await llm(page)).length, 10);
});

test('stopping keeps the partial reply and a reloaded channel resumes without repeating turns', async t => {
  const page = await start(t, {faults: {stallAt: 2}});
  await discuss(page);
  await page.waitForSelector('.message[data-status="running"] .message-text:not(.typing)');
  await page.click('.run-foot button.stop');
  await runStatus(page, 'stopped');
  const stopped = lastRun(page).locator('.message[data-status="stopped"]');
  assert.match(await stopped.locator('.message-text').textContent(), /응답/);
  await page.reload();
  await ready(page);
  await fault(page, {stallAt: 0});
  await runStatus(page, 'stopped');
  await page.click('.run-foot button.resume');
  await runStatus(page, 'done');
  assert.equal((await llm(page)).length, 8);
});

test('vote ballots stay sealed until every role has voted', async t => {
  const page = await start(t, {faults: {stallAt: 3}});
  await vote(page);
  await page.waitForSelector('.ballot:nth-child(3)[data-status="running"]');
  assert.equal(await page.locator('.ballot .sealed').count(), 2);
  assert.equal(await page.locator('.ballot .choice').count(), 0);
  assert.doesNotMatch(await page.locator('#feed').textContent(), /\{"c|가까워요/);
  assert.match(await page.locator('.ballot-head .count').textContent(), /2\/3 제출/);
  assert.equal(await page.locator('.vote-result').count(), 0);
  assert.match(await page.locator('.message.user').textContent(), /독립 비밀 투표[\s\S]*점심은 무엇으로\?[\s\S]*A\. 짜장/);
  await page.click('.run-foot button.stop');
  await runStatus(page, 'stopped');
  await fault(page, {stallAt: 0});
  await page.click('.run-foot button.resume');
  await runStatus(page, 'done');
  assert.match(await page.locator('.vote-result').textContent(), /A\. 짜장\s*3표/);
  assert.equal(await page.locator('.ballot .choice').count(), 3);
  assert.equal(await page.locator('.vote-result progress').first().evaluate(bar => [bar.value, bar.max].join('/')), '3/3');
});

test('a failed ballot can be skipped and the rest still count', async t => {
  const page = await start(t, {faults: {quota: true}});
  await vote(page);
  await runStatus(page, 'failed');
  await fault(page, {quota: false});
  await page.locator('.ballot button.skip').first().click();
  await runStatus(page, 'done');
  assert.equal(await page.locator('.ballot').first().getAttribute('data-status'), 'skipped');
  assert.match(await page.locator('.vote-result').textContent(), /A\. 짜장\s*2표/);
});

test('the ballot dialog adds, removes and checks options', async t => {
  const page = await start(t);
  await page.click('#open-ballot');
  assert.equal(await page.locator('#ballot-dialog').evaluate(dialog => dialog.open), true);
  assert.equal(await page.locator('#ballot-options li').count(), 2);
  assert.equal(await page.locator('#ballot-options .remove-option').first().isDisabled(), true);
  for (let i = 0; i < 4; i++) await page.click('#add-option');
  assert.deepEqual(await page.locator('#ballot-options .letter').allTextContents(), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.equal(await page.locator('#add-option').isDisabled(), true);
  await page.fill('#ballot-options li:nth-child(2) input', '둘째');
  await page.locator('#ballot-options .remove-option').first().click();
  assert.equal(await page.locator('#ballot-options li:first-child input').inputValue(), '둘째');
  await page.fill('#ballot-form textarea[name="passage"]', '지문');
  await page.click('#ballot-form button[type="submit"]');
  assert.equal(await page.locator('#ballot-form .notice').textContent(), '선택지를 두 개 이상 적어 주세요.');
  await page.fill('#ballot-options li:nth-child(2) input', '셋째');
  for (const box of await page.locator('#ballot-voters input').all()) await box.uncheck();
  assert.equal(await page.locator('#ballot-estimate').textContent(), '역할을 하나 이상 골라 주세요.');
  await page.click('#ballot-form button[type="submit"]');
  assert.equal(await page.locator('#ballot-form .notice').textContent(), '역할을 하나 이상 골라 주세요.');
  await page.click('#ballot-cancel');
  assert.equal(await page.locator('#ballot-dialog').evaluate(dialog => dialog.open), false);
  assert.deepEqual(await llm(page), []);
});

test('a double click and Enter during a run start only one discussion', async t => {
  const page = await start(t);
  await page.fill('#composer textarea[name="request"]', '점심 메뉴를 정해 줘');
  await page.evaluate(() => {
    const send = document.querySelector('#send');
    send.click();
    send.click();
  });
  await runStatus(page, 'done');
  assert.equal(await page.evaluate(() => window.hostTest.state.kv.threads.length), 1);
  assert.equal((await llm(page)).length, 9);
});

test('Enter sends and Shift+Enter adds a line', async t => {
  const page = await start(t);
  const box = page.locator('#composer textarea[name="request"]');
  await box.click();
  await page.keyboard.type('첫 줄');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('둘째 줄');
  assert.equal(await box.inputValue(), '첫 줄\n둘째 줄');
  await page.keyboard.press('Enter');
  await runStatus(page, 'done');
  assert.equal(await page.locator('.message.user .message-text').textContent(), '첫 줄\n둘째 줄');
});

test('streamed tokens update the text without replacing the stop button', async t => {
  const page = await start(t, {faults: {slowTokens: true, stallAt: 1}});
  await discuss(page);
  await page.waitForFunction(() => /토큰1/.test(document.querySelector('.message[data-status="running"] .message-text')?.textContent));
  const stop = await page.$('.run-foot button.stop');
  await page.waitForFunction(() => /토큰5/.test(document.querySelector('.message[data-status="running"] .message-text')?.textContent));
  assert.equal(await stop.evaluate(element => element.isConnected), true);
  await stop.click();
  await runStatus(page, 'stopped');
  assert.match(await page.locator('.message').nth(1).locator('.message-text').textContent(), /토큰1 토큰2 토큰3 토큰4 토큰5/);
});

test('unsaved settings edits survive a run', async t => {
  const page = await start(t);
  await openSettings(page);
  await page.selectOption('select[name="critic-temperament"]', 'deep');
  await page.click('#settings-close');
  await discuss(page);
  await runStatus(page, 'done');
  await openSettings(page);
  assert.equal(await page.locator('select[name="analyst-model"]').isDisabled(), false);
  assert.deepEqual(await page.locator('select[name="analyst-model"] option').evaluateAll(els => els.map(e => e.value)), ['', 'mock/gemini-test']);
});

test('sending checks the text and the roles', async t => {
  const page = await start(t);
  await page.click('#send');
  assert.equal(await noticeText(page), '내용을 입력해 주세요.');
  await page.fill('#composer textarea[name="request"]', '질문');
  await page.click('#role-chips .chip[data-role="critic"]');
  await page.click('#role-chips .chip[data-role="editor"]');
  assert.equal(await page.locator('#role-chips .chip[data-role="critic"]').getAttribute('aria-pressed'), 'false');
  assert.match(await page.locator('#estimate').textContent(), /두 개 이상/);
  await page.click('#send');
  assert.equal(await noticeText(page), '토론에는 역할이 두 개 이상 필요해요.');
  await page.click('#role-chips .chip[data-role="editor"]');
  assert.equal(await page.locator('#estimate').textContent(), 'AI 호출 6회 예정');
  assert.deepEqual(await llm(page), []);
});

test('the chosen roles are remembered for the channel', async t => {
  const page = await start(t);
  await page.click('#role-chips .chip[data-role="analyst"]');
  await discuss(page);
  await runStatus(page, 'done');
  assert.equal((await llm(page)).length, 6);
  await page.waitForFunction(() => window.hostTest.state.kv.channels?.[0]?.roles?.join() === 'critic,editor');
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('#role-chips .chip[data-role="analyst"]').getAttribute('aria-pressed'), 'false');
});

test('an English discussion asks the roles in English', async t => {
  const page = await start(t, {kv: {settings: {version: 1, language: 'en', detail: false, roles: {}, seenModels: []}}});
  assert.equal(await page.locator('#estimate').textContent(), '9 AI calls planned');
  await discuss(page, 'Pick lunch');
  await runStatus(page, 'done');
  assert.match((await llm(page))[0].system, /Answer in English/);
  assert.match(await lastRun(page).locator('.pill').textContent(), /Discussion · Done/);
});

test('a finished discussion and vote fit a 360px screen', async t => {
  const page = await start(t, {viewport: {width: 360, height: 740}});
  await discuss(page);
  await runStatus(page, 'done');
  await vote(page);
  await runStatus(page, 'done');
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
  assert.ok(await page.evaluate(() => document.querySelector('#feed').scrollWidth <= document.querySelector('#feed').clientWidth));
});
