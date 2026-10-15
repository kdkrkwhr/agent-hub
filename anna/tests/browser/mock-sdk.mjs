// Deterministic host for UI tests. No Anna account, network or AI allowance.
const state = JSON.parse(localStorage.getItem('test-host') || '{"kv":{}}');
const faults = JSON.parse(sessionStorage.getItem('test-faults') || '{}');
const calls = [];
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
  },
};

export const AnnaAppRuntime = {
  async connect() {
    if (faults.connect) throw new Error('connect failed');
    return runtime;
  },
};
