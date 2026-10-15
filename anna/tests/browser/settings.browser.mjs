import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

// Every request is served locally; CSP matches the Anna bundle policy.
const bundle = new URL('../../bundle/', import.meta.url);
const mock = await readFile(new URL('./mock-sdk.mjs', import.meta.url), 'utf8');
const TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml'};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:";

async function setup(t, {faults = {}, kv = {}, viewport = {width: 1180, height: 820}} = {}) {
  const browser = await chromium.launch(process.env.ANNA_BROWSER_CHANNEL ? {channel: process.env.ANNA_BROWSER_CHANNEL} : process.platform === 'win32' ? {channel: 'msedge'} : {});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport});
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://agent-hub.test') return route.abort();
    if (url.pathname.includes('/_sdk/')) return route.fulfill({contentType: 'text/javascript', body: mock});
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (file.includes('..')) return route.abort();
    try {
      await route.fulfill({body: await readFile(new URL(file, bundle)), contentType: TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', headers: {'content-security-policy': CSP}});
    } catch {
      await route.fulfill({status: 404, body: ''});
    }
  });
  await page.addInitScript(({faults, kv}) => {
    if (sessionStorage.getItem('test-initialized')) return;
    sessionStorage.setItem('test-initialized', '1');
    sessionStorage.setItem('test-faults', JSON.stringify(faults));
    localStorage.setItem('test-host', JSON.stringify({kv}));
  }, {faults, kv});
  await page.goto('https://agent-hub.test/');
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors or CSP violations'));
  return page;
}
const ready = page => page.waitForSelector('body[data-ready="true"]');
const stored = page => page.evaluate(() => window.hostTest.state.kv.settings);

test('defaults show three Korean roles without any AI call', async t => {
  const page = await setup(t);
  await ready(page);
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
  await page.selectOption('select[name="critic-temperament"]', 'deep');
  await page.selectOption('select[name="critic-family"]', 'gpt');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '저장했어요');
  assert.deepEqual((await stored(page)).roles.critic, {temperament: 'deep', family: 'gpt', model: ''});
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('select[name="critic-temperament"]').inputValue(), 'deep');
  assert.equal(await page.locator('select[name="critic-family"]').inputValue(), 'gpt');
});

test('models Anna used before can be chosen per role', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {}, seenModels: ['google/gemini-3-flash-preview', 'openai/gpt-5-mini']};
  const page = await setup(t, {kv: {settings}});
  await ready(page);
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
  await page.selectOption('#language', 'en');
  await page.waitForFunction(() => document.querySelector('#settings-title').textContent === 'Roles and models');
  assert.equal(await page.locator('fieldset.role[data-role="analyst"] legend').textContent(), 'Analyst');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.waitForFunction(() => window.hostTest.state.kv.settings?.language === 'en');
});

test('save failures keep the form and explain the problem', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await page.selectOption('select[name="analyst-family"]', 'claude');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('select[name="analyst-family"]').inputValue(), 'claude');
  assert.equal(await page.locator('#settings-form button[type="submit"]').isDisabled(), false);
});

test('connection failure shows a reopen notice', async t => {
  const page = await setup(t, {faults: {connect: true}});
  await page.waitForFunction(() => !document.querySelector('#notice').hidden);
  assert.match(await page.locator('#notice').textContent(), /Anna에 연결하지 못했어요/);
  assert.equal(await page.locator('#settings-form button[type="submit"]').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.body.dataset.ready), undefined);
});

test('a failed language save keeps the previous language', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
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
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
