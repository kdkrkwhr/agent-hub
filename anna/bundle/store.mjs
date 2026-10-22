import {normalizeSettings} from './roles.mjs';
import {normalizeChannel} from './channels.mjs';

export const SETTINGS_KEY = 'settings';
export const INDEX_KEY = 'threads'; // Read-only legacy index; bodies are now authoritative.
export const CHANNELS_KEY = 'channels';
export const threadKey = id => `thread/${id}`;
export const MAX_RECORD_BYTES = 248 * 1024; // Anna APS: 256 KiB, measured with UTF-8 JSON.
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const sorted = items => items.sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const jsonBytes = value => new TextEncoder().encode(JSON.stringify(value)).length;

export class StorageError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}
export function storageErrorKind(error) {
  if (error instanceof StorageError) return error.kind;
  const message = `${error?.code || ''} ${error?.message || ''}`;
  if (/precondition_failed|if_match/i.test(message)) return 'conflict';
  if (/too_large|quota|capacity|limit.*exceed|storage.*full/i.test(message)) return 'capacity';
  if (/permission|forbidden|unauthori/i.test(message)) return 'permission';
  return 'connection';
}
function assertId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Invalid thread id');
}
function checked(value) {
  if (jsonBytes(value) > MAX_RECORD_BYTES) throw new StorageError('capacity');
  return value;
}
function etag(result) {
  if (typeof result?.etag !== 'string' || !result.etag) throw new StorageError('concurrency');
  return result.etag;
}
const missing = error => /not.?found/i.test(String(error?.code || error?.message || ''));
const payload = ({_etag, _base, saveError, ...value}) => value;

export function summary(thread) {
  return {id: thread.id, title: String(thread.title || '').slice(0, 80), kind: thread.kind,
    status: thread.status, created: thread.created ?? thread.updated, updated: thread.updated,
    archived: thread.archived === true, channel: typeof thread.channel === 'string' ? thread.channel : ''};
}

export function createStore(storage) {
  let queue = Promise.resolve();
  const revisions = new Map();
  let index = [];
  function serial(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }
  async function get(key) {
    try {
      const result = await storage.get({key});
      return result && result.exists !== false && result.value != null ? result : null;
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  async function rows(prefix) {
    const result = [], cursors = new Set();
    let cursor;
    do {
      const page = await storage.list({prefix, limit: 200, ...(cursor ? {cursor} : {})});
      const items = page?.items ?? page?.entries;
      if (!Array.isArray(items)) throw new Error('Invalid storage listing');
      result.push(...items.filter(item => typeof item?.key === 'string'));
      cursor = page.next_cursor ?? page.cursor;
      if (cursor && cursors.has(cursor)) throw new Error('Repeated storage cursor');
      cursors.add(cursor);
    } while (cursor);
    return result;
  }
  async function listThreads() {
    const items = [];
    for (const row of await rows('thread/')) {
      const id = row.key.slice(7);
      if (!ID_PATTERN.test(id)) continue;
      const value = row.metadata?.record === 'thread-v1' && row.metadata.id === id
        ? row.metadata : (await get(row.key))?.value;
      if (value?.id === id) items.push(summary(value));
    }
    return index = sorted(items);
  }
  async function loadThread(id) {
    assertId(id);
    const result = await get(threadKey(id));
    if (!result) return null;
    const revision = etag(result);
    revisions.set(id, revision);
    return {...result.value, _etag: revision};
  }
  async function listChannels() {
    const legacy = (await get(CHANNELS_KEY))?.value;
    const items = (Array.isArray(legacy) ? legacy : []).map(normalizeChannel).filter(Boolean)
      .map(value => ({...value, _base: JSON.stringify(value)}));
    for (const row of await rows('channel/')) {
      const id = row.key.slice(8);
      if (!ID_PATTERN.test(id)) continue;
      const result = await get(row.key), value = normalizeChannel(result?.value);
      if (!value || value.id !== id) continue;
      const old = items.findIndex(item => item.id === id);
      if (old >= 0) items.splice(old, 1);
      items.push({...value, _etag: etag(result)});
    }
    return items;
  }

  // Settings are small immutable patches, not a shared read/modify/write blob.
  // Distinct first-time edits and newly observed models cannot erase each other.
  async function loadSettings() {
    let value = normalizeSettings((await get(SETTINGS_KEY))?.value);
    const changes = (await rows('settings-edit/')).sort((a, b) =>
      String(a.updated_at || '').localeCompare(String(b.updated_at || '')) || a.key.localeCompare(b.key));
    for (const row of changes) {
      const edit = row.metadata?.record === 'settings-v1' ? row.metadata : (await get(row.key))?.value;
      if (!edit || edit.schema !== 1) continue;
      if (edit.language) value.language = edit.language;
      for (const [role, fields] of Object.entries(edit.roles || {})) {
        if (value.roles[role]) value.roles[role] = {...value.roles[role], ...fields};
      }
      value.seenModels = [...new Set([...(edit.models || []), ...value.seenModels])];
    }
    return normalizeSettings(value);
  }
  async function updateSettings(change) {
    const current = await loadSettings(), next = normalizeSettings(change(structuredClone(current)));
    const edit = {schema: 1, roles: {}, models: next.seenModels.filter(model => !current.seenModels.includes(model))};
    if (next.language !== current.language) edit.language = next.language;
    for (const role of Object.keys(current.roles)) {
      const fields = Object.fromEntries(Object.entries(next.roles[role]).filter(([key, value]) => current.roles[role][key] !== value));
      if (Object.keys(fields).length) edit.roles[role] = fields;
    }
    if (edit.language || edit.models.length || Object.keys(edit.roles).length) {
      await storage.set({key: `settings-edit/${crypto.randomUUID()}`, value: checked(edit), metadata: {record: 'settings-v1', ...edit}});
    }
    return loadSettings();
  }

  return {
    loadSettings,
    saveSettings(settings) { return serial(() => updateSettings(() => settings)); },
    updateSettings(change) { return serial(() => updateSettings(change)); },
    listThreads, listChannels, loadThread,
    repairIndex: listThreads,
    saveChannel(channel) {
      const value = normalizeChannel(channel);
      if (!value) return Promise.reject(new Error('Invalid channel id'));
      const clean = payload(value);
      return serial(async () => {
        // Legacy channels stay in their existing row, guarded by its current ETag.
        // New channels get independent random keys; no aggregate creation race.
        if (channel._base) {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            const result = await get(CHANNELS_KEY);
            const items = Array.isArray(result?.value) ? result.value.map(normalizeChannel).filter(Boolean) : [];
            const at = items.findIndex(item => item.id === value.id);
            if (at < 0 || JSON.stringify(payload(items[at])) !== channel._base) throw new StorageError('conflict');
            items[at] = clean;
            try {
              await storage.set({key: CHANNELS_KEY, value: checked(items.map(payload)), if_match: etag(result)});
              channel._base = JSON.stringify(clean);
              return listChannels();
            } catch (error) { if (storageErrorKind(error) !== 'conflict' || attempt === 3) throw error; }
          }
        }
        const key = `channel/${value.id}`, current = await get(key);
        if (current && !channel._etag) throw new StorageError('conflict');
        const result = await storage.set({key, value: checked(clean), ...(channel._etag ? {if_match: channel._etag} : {})});
        channel._etag = etag(result);
        return listChannels();
      });
    },
    async saveThread(thread) {
      assertId(thread?.id);
      return serial(async () => {
        const key = threadKey(thread.id), current = await get(key), value = checked(payload(thread));
        // A lost acknowledgement may be retried without changing any server data.
        if (current && equal(current.value, value)) {
          thread._etag = etag(current);
        } else {
          if (current && !thread._etag) throw new StorageError('conflict');
          if (current?.value.status === 'running' && current.value.leaseUntil > Date.now()
            && current.value.runOwner !== value.runOwner) throw new StorageError('busy');
          const result = await storage.set({key, value, metadata: {record: 'thread-v1', ...summary(value)},
            ...(thread._etag ? {if_match: thread._etag} : {})});
          thread._etag = etag(result);
        }
        revisions.set(thread.id, thread._etag);
        // The body and its listing metadata commit atomically. No second index write.
        index = sorted([...index.filter(item => item.id !== thread.id), summary(thread)]);
        return index;
      });
    },
    async deleteThread(id, expected = revisions.get(id)) {
      assertId(id);
      return serial(async () => {
        const current = await get(threadKey(id));
        if (current) {
          if (!expected || expected !== etag(current)) throw new StorageError('conflict');
          if (current.value.status === 'running' && current.value.leaseUntil > Date.now()) throw new StorageError('busy');
          await storage.delete({key: threadKey(id), if_match: expected});
        }
        revisions.delete(id);
        index = index.filter(item => item.id !== id);
        return index;
      });
    },
  };
}
