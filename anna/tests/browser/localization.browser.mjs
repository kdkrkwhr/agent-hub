import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TEXT} from '../../bundle/i18n.mjs';
import {PRIORITY_HEADINGS} from '../../bundle/decision.mjs';
import {llm, newChannel, openSettings, ready, runStatus, setup, vote, fault} from './harness.mjs';

async function switchLanguage(page,language) {
  await openSettings(page);
  await page.selectOption('#language',language);
  await page.waitForFunction(async language=>!document.querySelector('#language').disabled && (await window.hostTest.settings()).language===language,language);
  await page.click('#settings-close');
}

test('genuinely fresh storage starts in English without creating settings or spending AI',async t=>{
  const page=await setup(t,{language:null});await ready(page);
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'en');
  assert.equal(await page.locator('#send').textContent(),'Send');
  assert.equal(await page.locator('#feed .empty h2').textContent(),'What should you build next?');
  await openSettings(page);
  assert.deepEqual(await page.locator('#language option').evaluateAll(items=>items.map(x=>[x.value,x.textContent])),[['en','English'],['ko','한국어'],['zh-CN','简体中文'],['ja','日本語']]);
  assert.equal(await page.locator('#language').inputValue(),'en');
  assert.equal(await page.evaluate(()=>window.hostTest.calls.some(c=>c.method==='storage.set'||c.method.startsWith('llm'))),false);
});

for(const language of ['en','ko','zh-CN','ja']) {
  test(`${language}: example, AI prompts, result, ballot, office, MD export and reload`,async t=>{
    const reply=PRIORITY_HEADINGS[language].map(h=>`## ${h}\n- Original result 原文`).join('\n\n');
    const page=await setup(t,{language:null,faults:{priorityReply:reply}});await ready(page);
    if(language!=='en')await switchLanguage(page,language);
    await newChannel(page);
    assert.equal(await page.locator('#channel-title').textContent(),TEXT[language].defaultChannel.replace('{n}','1'));
    await page.click('#priority-example');
    assert.equal(await page.locator('#composer textarea').inputValue(),TEXT[language].priorityExampleText);
    assert.equal((await llm(page)).length,0);
    await page.click('#send');await runStatus(page,'done');
    assert.deepEqual(await page.locator('.decision-section h3').allTextContents(),PRIORITY_HEADINGS[language]);
    assert.equal((await llm(page)).length,4);
    assert.equal(await page.evaluate(()=>Object.values(window.hostTest.state.kv).find(v=>v?.kind==='discussion')?.language),language);
    await vote(page,{passage:'Compare / 比较 / 比較',options:['A','B']});await runStatus(page,'done');
    assert.equal((await llm(page)).length,7);
    assert.ok(await page.locator('.vote-result').isVisible());
    await page.click('[data-view="office"]');
    await page.click('[data-room-tab="office"]');
    assert.equal(await page.locator('.corridor-label').textContent(),TEXT[language].hallway);
    await page.click('[data-room-tab="vote"]');
    assert.equal(await page.locator('.area-booth .area-sub').first().textContent(),TEXT[language].privateBooth);
    await page.click('[data-view="chat"]');
    const download=page.waitForEvent('download');await page.click('#export');
    const md=await readFile(await (await download).path(),'utf8');
    assert.ok(md.includes(TEXT[language].request));
    assert.ok(md.includes(reply.replace(/^## /gm,'### ')), 'channel export nests run headings without changing the content');
    assert.ok(md.includes(TEXT[language].reason));
    assert.equal((await llm(page)).length,7);
    await page.reload();await ready(page);
    assert.equal(await page.evaluate(()=>document.documentElement.lang),language);
    assert.equal(await page.locator('#feed .run').count(),2);
    assert.equal((await llm(page)).length,0);
  });
}

test('switching to Japanese keeps a Chinese run and draft intact when resuming',async t=>{
  const page=await setup(t,{language:'zh-CN',faults:{emptyAt:2}});await ready(page);await newChannel(page);
  await page.fill('#composer textarea','原始问题');await page.click('#send');await runStatus(page,'failed');
  const before=await page.locator('.message[data-status="done"] .message-text').first().textContent();
  await page.fill('#composer textarea','入力中の文章');
  await switchLanguage(page,'ja');
  assert.equal(await page.locator('#composer textarea').inputValue(),'入力中の文章');
  assert.equal(await page.locator('.message[data-status="done"] .message-text').first().textContent(),before);
  assert.equal((await llm(page)).length,2);
  await fault(page,{emptyAt:0});await page.click('button.retry');await runStatus(page,'done');
  const calls=await llm(page);
  assert.equal(calls.length,5);
  for(const call of calls)assert.match(call.system,/简体中文回答/);
  assert.equal(await page.evaluate(()=>document.documentElement.lang),'ja');
});

test('Japanese and Chinese controls and dialogs fit 360px and IME Enter does not send',async t=>{
  const page=await setup(t,{language:null,viewport:{width:360,height:740}});await ready(page);await newChannel(page);
  for(const language of ['ja','zh-CN']) {
    await switchLanguage(page,language);
    await page.fill('#composer textarea','変換中 输入中');
    await page.locator('#composer textarea').dispatchEvent('keydown',{key:'Enter',isComposing:true});
    assert.equal((await llm(page)).length,0);
    await page.click('#open-ballot');
    assert.ok(await page.evaluate(()=>document.scrollingElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator('#ballot-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));
    await page.click('#ballot-cancel');
    await openSettings(page);
    assert.ok(await page.locator('#settings-dialog').evaluate(e=>e.getBoundingClientRect().right<=innerWidth && e.scrollWidth<=e.clientWidth));
    await page.click('#settings-close');
  }
});
