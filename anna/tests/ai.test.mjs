import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAi, classify, AiError} from '../bundle/ai.mjs';

const streamOf = (events, calls = []) => ({
  stream(request) { calls.push(request); return (async function* () { for (const e of events) { await null; yield e; } })(); },
  async complete() { throw new Error('complete must not be called'); },
});
const ask = {system: 'sys', messages: [{role: 'user', text: 'hi'}], preferences: {speedPriority: 0.5}};

test('streams tokens and returns the model Anna actually used', async () => {
  const calls = [], seen = [];
  const ai = createAi(streamOf([{event: 'model_token', text: 'Hel'}, {event: 'model_token', text: 'lo'}, {event: 'complete', content: {text: 'Hello'}, model: 'google/gemini-3-flash-preview'}], calls));
  assert.deepEqual(await ai.speak({...ask, onToken: text => seen.push(text)}), {text: 'Hello', model: 'google/gemini-3-flash-preview'});
  assert.deepEqual(seen, ['Hel', 'Hello']);
  assert.deepEqual(calls[0], {systemPrompt: 'sys', messages: [{role: 'user', content: {type: 'text', text: 'hi'}}], maxTokens: 600, temperature: 0.7, modelPreferences: {speedPriority: 0.5}});
});

test('falls back to complete when the host has no streaming', async () => {
  const llm = {
    stream() { return (async function* () { yield {event: 'error', code: -32601, message: 'unknown method'}; })(); },
    async complete(request) { return {content: {text: 'ok:' + request.messages[0].content.text}, model: 'openai/gpt'}; },
  };
  assert.deepEqual(await createAi(llm).speak(ask), {text: 'ok:hi', model: 'openai/gpt'});
  assert.deepEqual(await createAi({complete: llm.complete}).speak(ask), {text: 'ok:hi', model: 'openai/gpt'});
});

test('abort stops a stalled stream and keeps the partial text', async () => {
  const controller = new AbortController();
  let closed = false;
  const llm = {stream() {
    return {[Symbol.asyncIterator]() { let sent = false; return {
      next: () => sent ? new Promise(() => {}) : (sent = true, Promise.resolve({value: {event: 'model_token', text: 'part'}, done: false})),
      return: async () => { closed = true; return {done: true}; },
    }; }};
  }};
  const pending = createAi(llm).speak({...ask, signal: controller.signal, onToken: () => controller.abort()});
  await assert.rejects(pending, e => e instanceof AiError && e.kind === 'aborted' && e.partial === 'part');
  assert.equal(closed, true);
});

test('errors are classified for the user', async () => {
  assert.equal(classify({code: 'APP_QUOTA_EXCEEDED'}), 'quota');
  assert.equal(classify(new Error('insufficient credit')), 'quota');
  assert.equal(classify({code: 'APP_PROVIDER_ERROR', message: 'no eligible model available'}), 'provider');
  assert.equal(classify(new Error('RPC llm.stream timed out after 180000ms')), 'timeout');
  assert.equal(classify(new Error('boom')), 'unavailable');
  const failing = streamOf([{event: 'model_token', text: 'x'}, {event: 'error', code: 'APP_QUOTA_EXCEEDED', message: 'quota'}]);
  await assert.rejects(createAi(failing).speak(ask), e => e.kind === 'quota' && e.partial === 'x');
  await assert.rejects(createAi(streamOf([])).speak(ask), e => e.kind === 'unavailable');
});
