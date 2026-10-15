// Deterministic host for UI tests. No Anna account, network or AI allowance.
const state = JSON.parse(localStorage.getItem('test-host') || '{"kv":{}}');
const faults = JSON.parse(sessionStorage.getItem('test-faults') || '{}');
const calls = [];
let streams = 0;
const persist = () => localStorage.setItem('test-host', JSON.stringify(state));
window.hostTest = {state, faults, calls};

const runtime = {
  window: {set_title: async () => ({})},
  storage: {
    async get({key}) {
      calls.push({method: 'storage.get', key});
      if (faults.load) throw new Error('storage unavailable');
      return Object.hasOwn(state.kv, key) ? {value: structuredClone(state.kv[key]), etag: 'e', exists: true} : {value: null, exists: false};
    },
    async set({key, value}) {
      calls.push({method: 'storage.set', key});
      if (faults.save) throw new Error('storage unavailable');
      state.kv[key] = structuredClone(value);
      persist();
      return {etag: 'e'};
    },
    async list({prefix = ''} = {}) {
      return {items: Object.keys(state.kv).filter(key => key.startsWith(prefix)).map(key => ({key})), next_cursor: null};
    },
    async delete({key}) {
      delete state.kv[key];
      persist();
      return {deleted: true};
    },
  },
  llm: {
    async complete() {
      calls.push({method: 'llm.complete'});
      throw Object.assign(new Error('AI disabled in UI tests'), {code: 'llm_disabled'});
    },
    stream(request) {
      const n = ++streams;
      calls.push({method: 'llm.stream', system: request.systemPrompt, text: request.messages?.[0]?.content?.text || '', hints: request.modelPreferences?.hints || []});
      const reply = /JSON/.test(request.systemPrompt) ? '{"choice":"A","reason":"가까워요","concern":"없음"}' : `응답 ${n}`;
      return (async function* () {
        await null;
        if (faults.quota) {
          yield {event: 'error', code: 'APP_QUOTA_EXCEEDED', message: 'quota exceeded'};
          return;
        }
        const tokens = faults.slowTokens ? ['토큰1', ' 토큰2', ' 토큰3', ' 토큰4', ' 토큰5'] : [reply.slice(0, 3)];
        for (const [index, text] of tokens.entries()) {
          if (index) await new Promise(resolve => setTimeout(resolve, 30));
          yield {event: 'model_token', text};
        }
        if (faults.stallAt === n) await new Promise(() => {});
        yield {event: 'complete', content: {text: reply}, model: 'mock/gemini-test'};
      })();
    },
  },
};

export const AnnaAppRuntime = {
  async connect() {
    if (faults.connect) throw new Error('connect failed');
    return runtime;
  },
};
