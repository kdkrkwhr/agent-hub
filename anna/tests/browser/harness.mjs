import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

// Every request is served locally; CSP matches the Anna bundle policy.
const bundle = new URL('../../bundle/', import.meta.url);
const mock = await readFile(new URL('./mock-sdk.mjs', import.meta.url), 'utf8');
const TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml'};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:";

// Existing regression fixtures represent users who already chose Korean.
// Use language: null for genuinely fresh storage and the product's English default.
export async function setup(t, {faults = {}, kv = {}, language = 'ko', viewport = {width: 1180, height: 820}} = {}) {
  kv = {...(language ? {settings: {language}} : {}), ...kv};
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
export const ready = page => page.waitForSelector('body[data-ready="true"]');
export const llm = page => page.evaluate(() => window.hostTest.calls.filter(c => c.method === 'llm.stream'));
export const fault = (page, values) => page.evaluate(values => Object.assign(window.hostTest.faults, values), values);
export const noticeText = page => page.locator('#notice').textContent();

export async function newChannel(page) {
  const before = await page.locator('#channel-list .channel').count();
  if (await page.locator('#feed .welcome-new').count()) await page.click('#feed .welcome-new');
  else {
    if (await page.locator('#menu').isVisible()) await page.click('#menu');
    await page.click('#new-channel');
  }
  await page.waitForFunction(count => document.querySelectorAll('#channel-list .channel').length > count && !document.querySelector('#send').disabled, before);
}

export async function discuss(page, text = '점심 메뉴를 정해 줘') {
  // Existing regression scenarios intentionally exercise the original deep run.
  await page.selectOption('#composer select[name="mode"]', 'deep');
  await page.selectOption('#composer select[name="purpose"]', 'general');
  await page.fill('#composer textarea[name="request"]', text);
  await page.click('#send');
}

export async function vote(page, {passage = '점심은 무엇으로?', options = ['짜장', '짬뽕']} = {}) {
  await page.click('#open-ballot');
  await page.fill('#ballot-form textarea[name="passage"]', passage);
  for (const [index, text] of options.entries()) {
    if (index >= 2) await page.click('#add-option');
    await page.fill(`#ballot-options li:nth-child(${index + 1}) input`, text);
  }
  await page.click('#ballot-form button[type="submit"]');
}

export const lastRun = page => page.locator('#feed .run').last();
export const runStatus = (page, status) => page.waitForSelector(`#feed .run:last-child[data-status="${status}"]`);
export const openSettings = page => page.click('#settings-button');
