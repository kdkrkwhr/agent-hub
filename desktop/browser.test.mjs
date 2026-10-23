import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

test('desktop workspace lifecycle, edits, cancellation, persistence and export', {timeout:90000}, async()=>{
  const server=spawn(process.env.AGENT_HUB_TEST_PYTHON||'python',[fileURLToPath(new URL('./test_server.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});
  let stderr='';server.stderr.on('data',chunk=>stderr+=chunk);
  const exit=new Promise(resolve=>server.on('exit',resolve));
  const lines=createInterface({input:server.stdout});
  const info=await Promise.race([new Promise(resolve=>lines.once('line',line=>resolve(JSON.parse(line)))),exit.then(()=>{throw new Error('Backend exited: '+stderr);})]);
  const browser=await chromium.launch({headless:true});
  try{
    const original=await readFile(info.source+'/note.txt','utf8');
    const page=await browser.newPage({viewport:{width:1280,height:850}});
    await page.goto(info.origin+'/desktop.html');
    await page.waitForSelector('body[data-ready=true]');
    assert.equal(await page.locator('.provider.available').count(),3);
    await page.locator('#welcome-new').click();
    await page.locator('#source').fill(info.source);
    await page.locator('#writable').check();
    await page.locator('#create-submit').click();
    await page.locator('#copy-path').waitFor();
    await page.locator('#request').fill('Please edit the copy');
    await page.locator('#send').click();
    await page.waitForFunction(()=>document.getElementById('history').textContent.includes('Fixture response'));
    assert.equal(await page.evaluate(()=>window.injected),undefined);
    assert.equal(await readFile(info.source+'/note.txt','utf8'),original);
    await page.locator('#export').click();
    await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Export saved to:'));
    const output=await page.locator('#notice').textContent();
    const directory=output.split('\n')[1];
    const manifest=JSON.parse(await readFile(directory+'/manifest.json','utf8'));
    assert.ok(JSON.stringify(manifest).includes('note.txt'));
    await page.locator('#request').fill('Please stop this request');
    await page.locator('#send').click();
    await page.waitForFunction(()=>!document.getElementById('stop').disabled);
    await page.locator('#stop').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('ready'));
    await page.reload();await page.waitForSelector('body[data-ready=true]');
    await page.locator('#sessions button').first().click();
    await page.waitForFunction(()=>document.getElementById('history').textContent.includes('Fixture response'));
    const count=await page.locator('#history .message').count();
    await page.waitForTimeout(1600);
    assert.equal(await page.locator('#history .message').count(),count,'Reopening must not execute another request');
    await page.locator('#request').fill('Unsent draft');
    await page.locator('#refresh').click();
    await page.waitForFunction(()=>!document.getElementById('send').disabled);
    assert.equal(await page.locator('#request').inputValue(),'Unsent draft');
    for(const width of [860,1320]){
      await page.setViewportSize({width,height:850});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    }
    page.on('dialog',dialog=>dialog.accept());
    await page.locator('#close-session').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('closed'));
    assert.equal(await page.locator('#send').isDisabled(),true);
  } finally {
    await browser.close();server.stdin.end('\n');await exit;lines.close();
  }
});
