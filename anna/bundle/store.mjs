import {normalizeSettings} from './roles.mjs';

export const SETTINGS_KEY = 'settings';
export const INDEX_KEY = 'threads';
export const threadKey = id => `thread/${id}`;
const THREAD_PATTERN = /^thread\/([^/]+)$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function assertId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Invalid thread id');
}

export function summary(thread) {
  return {
    id: thread.id,
    title: String(thread.title || '').slice(0, 80),
    kind: thread.kind,
    status: thread.status,
    updated: thread.updated,
    archived: thread.archived === true,
  };
}

const missing = error => /not.?found/i.test(String(error?.code || error?.message || ''));

export function createStore(storage) {
  let queue = Promise.resolve();
  function serial(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }
  async function read(key) {
    const result = await storage.get({key});
    return result && result.exists !== false ? result.value ?? null : null;
  }
  async function listThreads() {
    const value = await read(INDEX_KEY);
    return Array.isArray(value) ? value : [];
  }
  async function writeIndex(items) {
    const sorted = [...items].sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0));
    await storage.set({key: INDEX_KEY, value: sorted});
    return sorted;
  }
  async function writeSettings(settings) {
    const value = normalizeSettings(settings);
    await storage.set({key: SETTINGS_KEY, value});
    return value;
  }
  async function loadSettings() {
    return normalizeSettings(await read(SETTINGS_KEY));
  }

  return {
    loadSettings,
    saveSettings(settings) {
      return serial(() => writeSettings(settings));
    },
    updateSettings(change) {
      return serial(async () => writeSettings(change(await loadSettings())));
    },
    listThreads,
    async loadThread(id) {
      assertId(id);
      return read(threadKey(id));
    },
    async saveThread(thread) {
      assertId(thread?.id);
      return serial(async () => {
        await storage.set({key: threadKey(thread.id), value: thread});
        const items = (await listThreads()).filter(item => item.id !== thread.id);
        items.push(summary(thread));
        return writeIndex(items);
      });
    },
    async deleteThread(id) {
      assertId(id);
      return serial(async () => {
        try {
          await storage.delete({key: threadKey(id)});
        } catch (error) {
          if (!missing(error)) throw error;
        }
        return writeIndex((await listThreads()).filter(item => item.id !== id));
      });
    },
    repairIndex() {
      return serial(async () => {
        const ids = [];
        let cursor = null;
        do {
          const page = await storage.list({prefix: 'thread/', limit: 200, ...(cursor ? {cursor} : {})});
          const items = page && typeof page === 'object' ? page.items ?? page.entries : undefined;
          if (!Array.isArray(items)) throw new Error('Invalid storage listing');
          for (const item of items) {
            const match = THREAD_PATTERN.exec(String(item?.key ?? ''));
            if (match) ids.push(match[1]);
          }
          cursor = page.next_cursor ?? page.cursor ?? null;
        } while (cursor);
        const index = await listThreads();
        const present = new Set(ids);
        const known = new Set(index.map(item => item.id));
        const items = index.filter(item => present.has(item.id));
        let changed = items.length !== index.length;
        for (const id of ids) {
          if (known.has(id)) continue;
          const thread = await read(threadKey(id));
          if (thread?.id === id) {
            items.push(summary(thread));
            changed = true;
          }
        }
        return changed ? writeIndex(items) : index;
      });
    },
  };
}
