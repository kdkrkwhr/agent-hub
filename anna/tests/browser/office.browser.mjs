import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discuss, newChannel, ready, runStatus, setup, vote} from './harness.mjs';

async function start(t, options) {
  const page = await setup(t, options);
  await ready(page);
  await newChannel(page);
  return page;
}

const openOffice = page => page.click('#view-tabs [data-view="office"]');
const actor = (page, role) => page.locator(`#office-map .actor[data-role="${role}"]`);
const zones = page => page.$$eval('#office-map .actor', items => Object.fromEntries(items.map(item => [item.dataset.role, item.dataset.zone])));
const arrived = page => page.waitForFunction(() => !document.querySelector('#office-map .actor.walking'));

test('the office tab appears with a channel and starts with everyone in the lounge', async t => {
  const page = await setup(t);
  await ready(page);
  assert.equal(await page.locator('#view-tabs').isHidden(), true);
  await newChannel(page);
  await openOffice(page);
  assert.equal(await page.locator('#feed').isHidden(), true);
  assert.equal(await page.locator('#office').isVisible(), true);
  assert.deepEqual(await zones(page), {analyst: 'lounge', critic: 'lounge', editor: 'lounge'});
  assert.match(await page.locator('#office-caption').textContent(), /휴게실에서 기다리는/);
  assert.deepEqual(await page.locator('#office-map .area-label').allTextContents(), ['연구실', '토론실', '조율실', '휴게실', '검토실']);
  await page.click('#office [data-room-tab="vote"]');
  assert.match(await page.locator('#office-caption').textContent(), /아직 투표가 없어요/);
  assert.equal(await page.locator('#office-map .actor').count(), 0);
  await page.click('#view-tabs [data-view="chat"]');
  assert.equal(await page.locator('#office').isHidden(), true);
  assert.equal(await page.locator('#feed').isVisible(), true);
});

test('roles walk to the room of the step they are working on', async t => {
  const page = await start(t, {faults: {stallAt: 4}});
  await openOffice(page);
  await discuss(page);
  await page.waitForSelector('#office-map .actor[data-role="analyst"][data-status="running"]');
  await arrived(page);
  assert.deepEqual(await zones(page), {analyst: 'forum', critic: 'research', editor: 'research'});
  const speech = actor(page, 'analyst').locator('.speech');
  assert.equal(await speech.evaluate(element => element.classList.contains('quiet')), false);
  assert.match(await speech.textContent(), /응답/);
  assert.equal(await actor(page, 'critic').locator('.speech').evaluate(element => element.classList.contains('quiet')), true);
  assert.deepEqual(await page.locator('#office-status .status-chip').allTextContents(), ['분석가작성 중', '비판자완료', '정리자완료']);
  const box = await actor(page, 'analyst').evaluate(element => element.getAttribute('transform'));
  assert.match(box, /^translate\(/);
});

test('a finished discussion sends everyone back and the card links to the chat', async t => {
  const page = await start(t);
  await discuss(page);
  await runStatus(page, 'done');
  await openOffice(page);
  assert.deepEqual(await zones(page), {analyst: 'lounge', critic: 'lounge', editor: 'lounge'});
  assert.match(await page.locator('#office-caption').textContent(), /토론 · .* · 완료/);
  await actor(page, 'critic').click();
  const card = page.locator('#office-card');
  assert.equal(await card.isVisible(), true);
  assert.match(await card.locator('h3').textContent(), /비판자/);
  assert.match(await card.textContent(), /동료 검토|2회차|1회차/);
  assert.match(await card.textContent(), /mock\/gemini-test/);
  assert.match(await card.locator('.card-text').textContent(), /응답 \d/);
  assert.equal(await actor(page, 'critic').getAttribute('aria-pressed'), 'true');
  await card.locator('button.primary').click();
  assert.equal(await page.locator('#feed').isVisible(), true);
  assert.equal(await page.locator('#view-tabs [data-view="chat"]').getAttribute('aria-selected'), 'true');
});

test('ballots stay sealed in the booths, then voters walk to their choice', async t => {
  const page = await start(t, {faults: {stallAt: 2}});
  await vote(page);
  await page.waitForSelector('#feed .ballot[data-status="running"]');
  await openOffice(page);
  assert.equal(await page.locator('#office [data-room-tab="vote"]').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await zones(page), {analyst: 'booth-analyst', critic: 'booth-critic', editor: 'booth-editor'});
  assert.deepEqual(await page.locator('#office-status .status-chip').allTextContents(), ['분석가제출함', '비판자판단 중', '정리자대기']);
  await actor(page, 'analyst').click();
  assert.match(await page.locator('#office-card .card-text').textContent(), /모든 투표가 끝나면 공개/);
  assert.doesNotMatch(await page.locator('#office').textContent(), /가까워요/);
});

test('revealed ballots gather in the option zones', async t => {
  const page = await start(t);
  await vote(page, {options: ['짜장', '짬뽕', '볶음밥']});
  await runStatus(page, 'done');
  await openOffice(page);
  await arrived(page);
  assert.deepEqual(await zones(page), {analyst: 'option-A', critic: 'option-A', editor: 'option-A'});
  assert.deepEqual(await page.locator('#office-map .area-zone .area-label').allTextContents(), ['A', 'B', 'C', '기권·무효']);
  assert.deepEqual(await page.locator('#office-status .status-chip').allTextContents(), ['분석가A 선택', '비판자A 선택', '정리자A 선택']);
  await page.click('#office [data-room-tab="office"]');
  assert.deepEqual(await zones(page), {analyst: 'lounge', critic: 'lounge', editor: 'lounge'});
});

test('the office fits a narrow window with the card below the map', async t => {
  const page = await start(t, {viewport: {width: 420, height: 780}});
  await openOffice(page);
  await actor(page, 'editor').click();
  const map = await page.locator('#office-map').boundingBox();
  const card = await page.locator('#office-card').boundingBox();
  assert.ok(map.width <= 420 && map.width > 300, `map width ${map.width}`);
  assert.ok(card.y >= map.y + map.height - 1, 'card is below the map');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});
