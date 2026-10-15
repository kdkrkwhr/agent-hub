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

test('falls back to complete when stream throws or its first frame rejects as unsupported', async () => {
  const complete = async () => ({content: {text: 'done'}, model: 'm'});
  const throwing = {stream() { throw {code: -32601}; }, complete};
  assert.deepEqual(await createAi(throwing).speak(ask), {text: 'done', model: 'm'});
  const rejecting = {stream() { return {[Symbol.asyncIterator]: () => ({next: () => Promise.reject({code: 'not_implemented'})})}; }, complete};
  assert.deepEqual(await createAi(rejecting).speak(ask), {text: 'done', model: 'm'});
});

test('abort applies to the complete fallback', async () => {
  const controller = new AbortController();
  const llm = {complete: () => new Promise(resolve => setTimeout(() => resolve({content: {text: 'late'}, model: 'm'}), 50))};
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(createAi(llm).speak({...ask, signal: controller.signal}), e => e instanceof AiError && e.kind === 'aborted' && e.partial === '');
});

test('abort listeners are released after each call', async () => {
  const listeners = new Set();
  const signal = {aborted: false, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn)};
  const ai = createAi(streamOf([{event: 'complete', content: {text: 'ok'}, model: 'm'}]));
  for (let i = 0; i < 3; i++) await ai.speak({...ask, signal});
  assert.equal(listeners.size, 0);
});

test('abort wins over a frame that already arrived', async () => {
  const controller = new AbortController();
  const llm = {stream() {
    return {[Symbol.asyncIterator]() { let n = 0; return {
      next() {
        if (n++ === 0) return Promise.resolve({value: {event: 'model_token', text: 'part'}, done: false});
        controller.abort();
        return Promise.resolve({value: {event: 'complete', content: {text: 'whole'}, model: 'm'}, done: false});
      },
      return: async () => ({done: true}),
    }; }};
  }};
  await assert.rejects(createAi(llm).speak({...ask, signal: controller.signal}), e => e instanceof AiError && e.kind === 'aborted' && e.partial === 'part');
});

test('abort from a timer stops a stalled stream', async () => {
  const controller = new AbortController();
  let closed = false;
  const llm = {stream() {
    return {[Symbol.asyncIterator]() { let sent = false; return {
      next: () => sent ? new Promise(() => {}) : (sent = true, Promise.resolve({value: {event: 'model_token', text: 'part'}, done: false})),
      return: async () => { closed = true; return {done: true}; },
    }; }};
  }};
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(createAi(llm).speak({...ask, signal: controller.signal}), e => e instanceof AiError && e.kind === 'aborted' && e.partial === 'part');
  assert.equal(closed, true);
});

test('explicit codes and AbortError are classified before message text', () => {
  assert.equal(classify({code: 'APP_PROVIDER_ERROR', message: 'insufficient context window'}), 'provider');
  assert.equal(classify(Object.assign(new Error('x'), {name: 'AbortError'})), 'aborted');
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
