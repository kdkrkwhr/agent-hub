import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEXT, t, tr, setLanguage, getLanguage} from '../bundle/i18n.mjs';
import {LANGUAGES} from '../bundle/locales.mjs';

test('all supported languages define the same non-empty keys and placeholders', () => {
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  assert.deepEqual(Object.keys(TEXT).sort(), Object.keys(LANGUAGES).sort());
  for (const lang of Object.keys(LANGUAGES)) {
    assert.deepEqual(Object.keys(TEXT[lang]).sort(), Object.keys(TEXT.en).sort());
    for (const [key, value] of Object.entries(TEXT[lang])) {
      assert.ok(value.trim(), `${lang}.${key}`);
      assert.deepEqual(placeholders(value), placeholders(TEXT.en[key]), `${lang}.${key}`);
    }
  }
});

test('language switching falls back to English', () => {
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('save'), 'Save');
  setLanguage('xx');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('save'), 'Save');
  assert.equal(t('no-such-key'), 'no-such-key');
});

test('placeholders are filled and every status, step and error has text', () => {
  setLanguage('ko');
  assert.equal(t('estimate', {n: 9}), 'AI 호출 9회 예정');
  assert.equal(tr('en', 'votes', {n: 2}), '2 vote(s)');
  assert.equal(tr('en', 'no-such-key'), 'no-such-key');
  for (const key of ['ready', 'pending', 'running', 'done', 'failed', 'stopped', 'skipped']) assert.ok(TEXT.en[`status-${key}`]);
  for (const key of ['opinion', 'rebuttal', 'final', 'review', 'ballot']) assert.ok(TEXT.ko[`step-${key}`]);
  for (const key of ['quota', 'provider', 'timeout', 'unavailable', 'format']) assert.ok(TEXT.ko[`error-${key}`]);
});
