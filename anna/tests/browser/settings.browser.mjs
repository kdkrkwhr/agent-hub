import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, ready, openTab} from './harness.mjs';

const stored = page => page.evaluate(() => window.hostTest.state.kv.settings);

test('defaults show three Korean roles without any AI call', async t => {
  const page = await setup(t);
  await ready(page);
  await openTab(page, 'settings');
  assert.deepEqual(await page.locator('fieldset.role').evaluateAll(els => els.map(e => e.dataset.role)), ['analyst', 'critic', 'editor']);
  assert.equal(await page.locator('fieldset.role[data-role="critic"] legend').textContent(), '비판자');
  assert.equal(await page.locator('select[name="analyst-temperament"]').inputValue(), 'balanced');
  assert.equal(await page.locator('select[name="analyst-model"]').isDisabled(), true);
  assert.match(await page.locator('select[name="analyst-model"] option').first().textContent(), /아직 응답을 받은 모델이 없어요/);
  assert.equal(await page.evaluate(() => window.hostTest.calls.some(c => c.method.startsWith('llm'))), false);
});

test('role settings persist across reloads', async t => {
  const page = await setup(t);
  await ready(page);
  await openTab(page, 'settings');
  await page.selectOption('select[name="critic-temperament"]', 'deep');
  await page.selectOption('select[name="critic-family"]', 'gpt');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '저장했어요');
  assert.deepEqual((await stored(page)).roles.critic, {temperament: 'deep', family: 'gpt', model: ''});
  await page.reload();
  await ready(page);
  await openTab(page, 'settings');
  assert.equal(await page.locator('select[name="critic-temperament"]').inputValue(), 'deep');
  assert.equal(await page.locator('select[name="critic-family"]').inputValue(), 'gpt');
});

test('models Anna used before can be chosen per role', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {}, seenModels: ['google/gemini-3-flash-preview', 'openai/gpt-5-mini']};
  const page = await setup(t, {kv: {settings}});
  await ready(page);
  await openTab(page, 'settings');
  const options = await page.locator('select[name="editor-model"] option').evaluateAll(els => els.map(e => e.value));
  assert.deepEqual(options, ['', 'google/gemini-3-flash-preview', 'openai/gpt-5-mini']);
  await page.selectOption('select[name="editor-model"]', 'openai/gpt-5-mini');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '저장했어요');
  assert.equal((await stored(page)).roles.editor.model, 'openai/gpt-5-mini');
});

test('language choice switches the UI and is saved', async t => {
  const page = await setup(t);
  await ready(page);
  await openTab(page, 'settings');
  await page.selectOption('#language', 'en');
  await page.waitForFunction(() => document.querySelector('#settings-title').textContent === 'Roles and models');
  assert.equal(await page.locator('fieldset.role[data-role="analyst"] legend').textContent(), 'Analyst');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.waitForFunction(() => window.hostTest.state.kv.settings?.language === 'en');
});

test('save failures keep the form and explain the problem', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await openTab(page, 'settings');
  await page.selectOption('select[name="analyst-family"]', 'claude');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('select[name="analyst-family"]').inputValue(), 'claude');
  assert.equal(await page.locator('#settings-form button[type="submit"]').isDisabled(), false);
});

test('connection failure shows a reopen notice', async t => {
  const page = await setup(t, {faults: {connect: true}});
  await page.waitForFunction(() => document.querySelector('#notice').textContent !== '');
  assert.match(await page.locator('#notice').textContent(), /Anna에 연결하지 못했어요/);
  assert.equal(await page.locator('#settings-form button[type="submit"]').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.body.dataset.ready), undefined);
});

test('a failed language save keeps the previous language', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await openTab(page, 'settings');
  await page.selectOption('#language', 'en');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('#language').inputValue(), 'ko');
  assert.equal(await page.locator('#settings-title').textContent(), '역할과 모델');
  assert.equal(await page.locator('fieldset.role[data-role="analyst"] legend').textContent(), '분석가');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko');
});

test('mobile width has no horizontal overflow', async t => {
  const page = await setup(t, {viewport: {width: 360, height: 740}});
  await ready(page);
  await openTab(page, 'settings');
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
