import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

// Every request is served locally; CSP matches the Anna bundle policy.
const bundle = new URL('../../bundle/', import.meta.url);
const mock = await readFile(new URL('./mock-sdk.mjs', import.meta.url), 'utf8');
const TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml'};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:";

export async function setup(t, {faults = {}, kv = {}, viewport = {width: 1180, height: 820}} = {}) {
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
export const openTab = (page, view) => page.click(`#tabs [data-view="${view}"]`);
