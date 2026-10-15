import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEXT, t, setLanguage, getLanguage} from '../bundle/i18n.mjs';

test('Korean and English define the same non-empty keys', () => {
  assert.deepEqual(Object.keys(TEXT.en).sort(), Object.keys(TEXT.ko).sort());
  for (const lang of ['ko', 'en']) for (const [key, value] of Object.entries(TEXT[lang])) assert.ok(value, `${lang}.${key}`);
});

test('language switching falls back to Korean', () => {
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('save'), 'Save');
  setLanguage('xx');
  assert.equal(getLanguage(), 'ko');
  assert.equal(t('save'), '저장');
  assert.equal(t('no-such-key'), 'no-such-key');
});
