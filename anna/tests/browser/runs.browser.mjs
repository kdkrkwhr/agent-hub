import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, ready, openTab} from './harness.mjs';

const llm = page => page.evaluate(() => window.hostTest.calls.filter(c => c.method === 'llm.stream'));
const meta = (page, pattern) => page.waitForFunction(source => new RegExp(source).test(document.querySelector('#thread-meta').textContent), pattern.source);
const fault = (page, values) => page.evaluate(values => Object.assign(window.hostTest.faults, values), values);

async function discuss(page, text = '점심 메뉴를 정해 줘') {
  await page.fill('#discussion-form textarea[name="request"]', text);
  await page.click('#discussion-form button[type="submit"]');
}

async function vote(page) {
  await openTab(page, 'vote');
  await page.fill('#vote-form textarea[name="passage"]', '점심은 무엇으로?');
  await page.fill('#vote-form textarea[name="options"]', '짜장\n짬뽕');
  await page.click('#vote-form button[type="submit"]');
}

test('a discussion runs nine turns and records the actual model', async t => {
  const page = await setup(t);
  await ready(page);
  assert.equal(await page.locator('#discussion-form [data-estimate]').textContent(), 'AI 호출 9회 예정');
  await discuss(page);
  await meta(page, /완료/);
  assert.equal((await llm(page)).length, 9);
  assert.equal(await page.locator('#turns .turn[data-status="done"]').count(), 9);
  for (const text of await page.locator('#turns .turn .model').allTextContents()) assert.match(text, /mock\/gemini-test/);
  assert.deepEqual(await page.evaluate(() => window.hostTest.state.kv.settings.seenModels), ['mock/gemini-test']);
  await openTab(page, 'settings');
  assert.equal(await page.locator('select[name="analyst-model"]').isDisabled(), false);
  await openTab(page, 'history');
  assert.match(await page.locator('.thread-item').first().textContent(), /점심 메뉴를 정해 줘.*토론 · 완료/);
});

test('first-round opinions are independent', async t => {
  const page = await setup(t);
  await ready(page);
  await discuss(page);
  await meta(page, /완료/);
  const calls = await llm(page);
  assert.doesNotMatch(calls[1].text, /응답 1/);
  assert.doesNotMatch(calls[2].text, /응답 [12]/);
  assert.match(calls[3].text, /응답 1[\s\S]*응답 2[\s\S]*응답 3/);
  assert.match(calls[0].system, /분석가/);
});

test('a requested family that Anna did not use is flagged', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {critic: {temperament: 'deep', family: 'claude', model: ''}}, seenModels: []};
  const page = await setup(t, {kv: {settings}});
  await ready(page);
  await discuss(page);
  await meta(page, /완료/);
  const calls = await llm(page);
  assert.deepEqual(calls[1].hints, [{name: 'claude'}]);
  assert.deepEqual(calls[0].hints, []);
  assert.equal(await page.locator('#turns .turn.role-critic .mismatch').count(), 3);
  assert.equal(await page.locator('#turns .turn.role-analyst .mismatch').count(), 0);
});

test('a quota failure explains the problem and can be retried', async t => {
  const page = await setup(t, {faults: {quota: true}});
  await ready(page);
  await discuss(page);
  await meta(page, /실패/);
  assert.match(await page.locator('#notice').textContent(), /사용량이 부족해요/);
  assert.equal(await page.locator('#turns .turn').first().getAttribute('data-status'), 'failed');
  await fault(page, {quota: false});
  await page.click('#turns .turn button.retry');
  await meta(page, /완료/);
  assert.equal((await llm(page)).length, 10);
});

test('stopping keeps the partial reply and a reopened thread resumes without repeating turns', async t => {
  const page = await setup(t, {faults: {stallAt: 2}});
  await ready(page);
  await discuss(page);
  await page.waitForSelector('#turns .turn[data-status="running"] .text');
  await page.click('#thread-actions button.stop');
  await meta(page, /중단됨/);
  const stopped = page.locator('#turns .turn').nth(1);
  assert.equal(await stopped.getAttribute('data-status'), 'stopped');
  assert.match(await stopped.locator('.text').textContent(), /응답/);
  await page.reload();
  await ready(page);
  await fault(page, {stallAt: 0});
  await openTab(page, 'history');
  assert.match(await page.locator('.thread-item').first().textContent(), /중단됨/);
  await page.locator('.thread-item').first().click();
  await page.click('#thread-actions button.resume');
  await meta(page, /완료/);
  assert.equal((await llm(page)).length, 8);
});

test('vote ballots stay sealed until every role has voted', async t => {
  const page = await setup(t, {faults: {stallAt: 3}});
  await ready(page);
  await vote(page);
  await page.waitForSelector('#turns .turn:nth-child(3)[data-status="running"]');
  assert.equal(await page.locator('#turns .turn .sealed').count(), 2);
  assert.equal(await page.locator('#turns .turn .choice').count(), 0);
  assert.equal(await page.locator('#vote-result').isHidden(), true);
  await page.click('#thread-actions button.stop');
  await meta(page, /중단됨/);
  await fault(page, {stallAt: 0});
  await page.click('#thread-actions button.resume');
  await meta(page, /완료/);
  assert.match(await page.locator('#vote-result').textContent(), /A\. 짜장 — 3표/);
  assert.equal(await page.locator('#turns .turn .choice').count(), 3);
});

test('a failed ballot can be skipped and the rest still count', async t => {
  const page = await setup(t, {faults: {quota: true}});
  await ready(page);
  await vote(page);
  await meta(page, /실패/);
  await fault(page, {quota: false});
  await page.click('#turns .turn button.skip');
  await meta(page, /완료/);
  assert.equal(await page.locator('#turns .turn').first().getAttribute('data-status'), 'skipped');
  assert.match(await page.locator('#vote-result').textContent(), /A\. 짜장 — 2표/);
});

test('starting checks the text, the roles and the options', async t => {
  const page = await setup(t);
  await ready(page);
  await page.click('#discussion-form button[type="submit"]');
  assert.equal(await page.locator('#notice').textContent(), '내용을 입력해 주세요.');
  await page.fill('#discussion-form textarea[name="request"]', '질문');
  await page.uncheck('#discussion-form input[name="roles"][value="critic"]');
  await page.uncheck('#discussion-form input[name="roles"][value="editor"]');
  assert.match(await page.locator('#discussion-form [data-estimate]').textContent(), /두 개 이상/);
  await page.click('#discussion-form button[type="submit"]');
  assert.equal(await page.locator('#notice').textContent(), '토론에는 역할이 두 개 이상 필요해요.');
  await openTab(page, 'vote');
  await page.fill('#vote-form textarea[name="passage"]', '지문');
  await page.fill('#vote-form textarea[name="options"]', '하나뿐');
  await page.click('#vote-form button[type="submit"]');
  assert.equal(await page.locator('#notice').textContent(), '선택지를 두 개 이상 적어 주세요.');
  assert.deepEqual(await llm(page), []);
});

test('an English discussion asks the roles in English', async t => {
  const page = await setup(t, {kv: {settings: {version: 1, language: 'en', detail: false, roles: {}, seenModels: []}}});
  await ready(page);
  assert.equal(await page.locator('#discussion-form [data-estimate]').textContent(), '9 AI calls planned');
  await discuss(page, 'Pick lunch');
  await page.waitForFunction(() => /Done/.test(document.querySelector('#thread-meta').textContent));
  assert.match((await llm(page))[0].system, /Answer in English/);
});

test('a finished discussion fits a 360px screen', async t => {
  const page = await setup(t, {viewport: {width: 360, height: 740}});
  await ready(page);
  await discuss(page);
  await meta(page, /완료/);
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
