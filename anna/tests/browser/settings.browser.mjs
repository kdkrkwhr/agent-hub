import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openSettings, ready, setup} from './harness.mjs';

const stored = page => page.evaluate(() => window.hostTest.state.kv.settings);
const status = page => page.locator('#settings-form .notice').textContent();

test('the settings dialog shows three Korean roles without any AI call', async t => {
  const page = await setup(t);
  await ready(page);
  await openSettings(page);
  assert.equal(await page.locator('#settings-dialog').evaluate(dialog => dialog.open), true);
  assert.deepEqual(await page.locator('fieldset.role').evaluateAll(els => els.map(e => e.dataset.role)), ['analyst', 'critic', 'editor']);
  assert.equal(await page.locator('fieldset.role[data-role="critic"] legend').textContent(), '비판자');
  assert.equal(await page.locator('select[name="analyst-temperament"]').inputValue(), 'balanced');
  assert.equal(await page.locator('select[name="analyst-model"]').isDisabled(), true);
  assert.match(await page.locator('select[name="analyst-model"] option').first().textContent(), /아직 응답을 받은 모델이 없어요/);
  await page.click('#settings-close');
  assert.equal(await page.locator('#settings-dialog').evaluate(dialog => dialog.open), false);
  assert.equal(await page.evaluate(() => window.hostTest.calls.some(c => c.method.startsWith('llm'))), false);
});

test('role settings persist across reloads', async t => {
  const page = await setup(t);
  await ready(page);
  await page.click('#open-settings');
  await page.selectOption('select[name="critic-temperament"]', 'deep');
  await page.selectOption('select[name="critic-family"]', 'gpt');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#settings-form .notice').textContent === '저장했어요');
  assert.deepEqual((await stored(page)).roles.critic, {temperament: 'deep', family: 'gpt', model: ''});
  await page.reload();
  await ready(page);
  await openSettings(page);
  assert.equal(await page.locator('select[name="critic-temperament"]').inputValue(), 'deep');
  assert.equal(await page.locator('select[name="critic-family"]').inputValue(), 'gpt');
});

test('models Anna used before can be chosen per role', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {}, seenModels: ['google/gemini-3-flash-preview', 'openai/gpt-5-mini']};
  const page = await setup(t, {kv: {settings}});
  await ready(page);
  await openSettings(page);
  const options = await page.locator('select[name="editor-model"] option').evaluateAll(els => els.map(e => e.value));
  assert.deepEqual(options, ['', 'google/gemini-3-flash-preview', 'openai/gpt-5-mini']);
  await page.selectOption('select[name="editor-model"]', 'openai/gpt-5-mini');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#settings-form .notice').textContent === '저장했어요');
  assert.equal((await stored(page)).roles.editor.model, 'openai/gpt-5-mini');
});

test('language choice switches the whole UI and is saved', async t => {
  const page = await setup(t);
  await ready(page);
  await openSettings(page);
  await page.selectOption('#language', 'en');
  await page.waitForFunction(() => document.querySelector('#settings-title').textContent === 'Roles and models');
  assert.equal(await page.locator('fieldset.role[data-role="analyst"] legend').textContent(), 'Analyst');
  assert.equal(await page.locator('#send').textContent(), 'Send');
  assert.equal(await page.locator('#composer textarea').getAttribute('placeholder'), 'Ask your roles.');
  assert.equal(await page.locator('#feed .empty h2').textContent(), 'Start talking with your role team');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.waitForFunction(() => window.hostTest.state.kv.settings?.language === 'en');
});

test('save failures keep the form and explain the problem', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await openSettings(page);
  await page.selectOption('select[name="analyst-family"]', 'claude');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#settings-form .notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('select[name="analyst-family"]').inputValue(), 'claude');
  assert.equal(await page.locator('#settings-form button[type="submit"]').isDisabled(), false);
  assert.match(await status(page), /저장하지 못했어요/);
});

test('a failed language save keeps the previous language', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await openSettings(page);
  await page.selectOption('#language', 'en');
  await page.waitForFunction(() => document.querySelector('#settings-form .notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('#language').inputValue(), 'ko');
  assert.equal(await page.locator('#settings-title').textContent(), '역할과 모델');
  assert.equal(await page.locator('fieldset.role[data-role="analyst"] legend').textContent(), '분석가');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'ko');
});

test('a failed channel save explains the problem', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await page.click('#feed .welcome-new');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('#channel-list .channel').count(), 0);
});

test('the settings dialog fits a 360px screen', async t => {
  const page = await setup(t, {viewport: {width: 360, height: 740}});
  await ready(page);
  await openSettings(page);
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
  assert.ok(await page.locator('#settings-dialog').evaluate(dialog => dialog.getBoundingClientRect().right <= 360));
});
