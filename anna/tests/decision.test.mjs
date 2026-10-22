import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decisionSections, PRIORITY_HEADINGS} from '../bundle/decision.mjs';

test('priority sections preserve Unicode, bullets and unsafe-looking text as plain data', () => {
  const source = PRIORITY_HEADINGS.ko.map(heading => `## ${heading}\n- 메모 📝 <script>alert(1)</script>`).join('\n\n');
  assert.deepEqual(decisionSections(source).map(section => section.text), Array(5).fill('- 메모 📝 <script>alert(1)</script>'));
});

test('missing, reordered, duplicate or unexpected preamble output falls back to the complete original', () => {
  const headings = PRIORITY_HEADINGS.en;
  const source = headings.map(heading => `## ${heading}\nAn item`).join('\n');
  assert.equal(decisionSections(source, 'en').length, 5);
  for (const input of [source.replace('## Defer\nAn item\n', ''), `Preamble\n${source}`, source.replace('## Defer', '## Build first'), 'ordinary answer']) {
    assert.equal(decisionSections(input, 'en'), null);
  }
});
