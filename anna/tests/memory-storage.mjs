export function memory(seed = {}) {
  const kv = structuredClone(seed), log = [], meta = {}, versions = {};
  let revision = 0;
  const tag = key => String(versions[key] || 'seed');
  const guard = (key, expected) => {
    if (expected !== undefined && (!Object.hasOwn(kv, key) || expected !== tag(key)))
      throw Object.assign(new Error('if_match mismatch'), {code: 'precondition_failed'});
  };
  return {kv, log, meta, storage: {
    async get({key}) { return Object.hasOwn(kv, key) ? {value: structuredClone(kv[key]), etag: tag(key), exists: true} : {value: null, exists: false}; },
    async set({key, value, if_match, metadata}) {
      guard(key, if_match);
      log.push(key); kv[key] = structuredClone(value); versions[key] = ++revision;
      meta[key] = {metadata, updated_at: String(revision).padStart(16, '0')};
      return {etag: tag(key)};
    },
    async list({prefix = '', cursor, limit = 100}) {
      const keys = Object.keys(kv).filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? keys.indexOf(cursor) + 1 : 0, page = keys.slice(start, start + limit);
      return {items: page.map(key => ({key, etag: tag(key), ...meta[key]})), next_cursor: start + limit < keys.length ? page.at(-1) : null};
    },
    async delete({key, if_match}) {
      guard(key, if_match);
      delete kv[key]; delete meta[key]; delete versions[key]; return {deleted: true};
    },
  }};
}
