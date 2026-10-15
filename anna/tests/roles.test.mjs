import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROLE_IDS, ROLES, defaultSettings, normalizeSettings, modelPreferences, requestedLabel, recordModel, modelMismatch} from '../bundle/roles.mjs';

test('three bilingual roles with balanced automatic defaults', () => {
  assert.deepEqual(ROLE_IDS, ['analyst', 'critic', 'editor']);
  for (const id of ROLE_IDS) {
    assert.ok(ROLES[id].name.ko && ROLES[id].name.en && ROLES[id].persona.ko && ROLES[id].persona.en);
    assert.deepEqual(defaultSettings().roles[id], {temperament: 'balanced', family: 'auto', model: ''});
  }
  assert.equal(defaultSettings().language, 'ko');
  assert.deepEqual(defaultSettings().seenModels, []);
});

test('normalization repairs unknown values and bounds model names', () => {
  const s = normalizeSettings({language: 'fr', detail: 'yes', roles: {critic: {temperament: 'reckless', family: 'llama', model: ` ${'m'.repeat(200)} `}},
    seenModels: ['a', 'a', '', 7, ...Array.from({length: 30}, (_, i) => `model-${i}`)]});
  assert.equal(s.language, 'ko');
  assert.equal(s.detail, false);
  assert.deepEqual(s.roles.critic, {temperament: 'balanced', family: 'auto', model: 'm'.repeat(120)});
  assert.deepEqual(s.roles.analyst, {temperament: 'balanced', family: 'auto', model: ''});
  assert.equal(s.seenModels.length, 20);
  assert.equal(s.seenModels[0], 'a');
  assert.deepEqual(normalizeSettings(null), defaultSettings());
});

test('model preferences put the chosen model before the family', () => {
  assert.deepEqual(modelPreferences({temperament: 'deep', family: 'auto', model: ''}), {speedPriority: 0.2, intelligencePriority: 0.95, costPriority: 0.2});
  assert.deepEqual(modelPreferences({temperament: 'fast', family: 'claude', model: 'anthropic/claude-sonnet'}).hints,
    [{name: 'anthropic/claude-sonnet'}, {name: 'claude'}]);
  assert.deepEqual(modelPreferences({temperament: 'balanced', family: 'gpt', model: ''}).hints, [{name: 'gpt'}]);
  assert.equal(requestedLabel({family: 'gemini', model: ''}), 'gemini');
  assert.equal(requestedLabel({family: 'gemini', model: 'google/gemini-3-flash-preview'}), 'google/gemini-3-flash-preview');
  assert.equal(requestedLabel({family: 'auto', model: ''}), '');
});

test('recording a model moves it to the front without mutating settings', () => {
  const before = {...defaultSettings(), seenModels: ['b', 'a']};
  const after = recordModel(before, ' a ');
  assert.deepEqual(after.seenModels, ['a', 'b']);
  assert.deepEqual(before.seenModels, ['b', 'a']);
  assert.equal(recordModel(before, ''), before);
});

test('a requested model or family missing from the actual model is a mismatch', () => {
  assert.equal(modelMismatch({requested: 'claude', model: 'google/gemini-3-flash-preview'}), true);
  assert.equal(modelMismatch({requested: 'gemini', model: 'google/gemini-3-flash-preview'}), false);
  assert.equal(modelMismatch({requested: 'openai/gpt-5-mini', model: 'openai/gpt-5-mini'}), false);
  assert.equal(modelMismatch({requested: '', model: 'x'}), false);
  assert.equal(modelMismatch({requested: 'gpt', model: ''}), false);
});
