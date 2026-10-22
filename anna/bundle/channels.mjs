import {ROLE_IDS} from './roles.mjs';

export const LEGACY = 'legacy';
export const CHANNEL_LIMIT = 30;
const MAX_TITLE = 60;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const cleanTitle = (value, fallback = '') => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || fallback;
const pickRoles = roles => Array.isArray(roles) ? ROLE_IDS.filter(id => roles.includes(id)) : [...ROLE_IDS];
const time = item => Number(item?.created) || Number(item?.updated) || 0;

export const channelOf = item => (typeof item?.channel === 'string' && item.channel) || LEGACY;

export function createChannel({id, title, now = Date.now()}) {
  return {id, title: cleanTitle(title, id), roles: [...ROLE_IDS], archived: false, created: now, updated: now};
}

export function normalizeChannel(raw) {
  if (!raw || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  return {
    id: raw.id,
    title: cleanTitle(raw.title, raw.id),
    roles: pickRoles(raw.roles),
    archived: raw.archived === true,
    created: Number(raw.created) || 0,
    updated: Number(raw.updated) || 0,
    ...(typeof raw._etag === 'string' ? {_etag: raw._etag} : {}),
    ...(typeof raw._base === 'string' ? {_base: raw._base} : {}),
  };
}

export function channelList(stored, threads, legacyTitle) {
  const channels = stored.map(normalizeChannel).filter(Boolean);
  const stats = new Map();
  for (const thread of threads) {
    const id = channelOf(thread);
    const entry = stats.get(id) || {count: 0, latest: 0};
    entry.count += 1;
    entry.latest = Math.max(entry.latest, Number(thread.updated) || 0);
    stats.set(id, entry);
  }
  if (stats.has(LEGACY) && !channels.some(channel => channel.id === LEGACY)) {
    channels.push({...createChannel({id: LEGACY, title: legacyTitle, now: 0})});
  }
  return channels
    .map(channel => {
      const entry = stats.get(channel.id) || {count: 0, latest: 0};
      return {...channel, count: entry.count, latest: Math.max(channel.updated, entry.latest)};
    })
    .sort((a, b) => b.latest - a.latest);
}

export function channelThreads(threads, id, limit = CHANNEL_LIMIT) {
  return threads.filter(thread => channelOf(thread) === id).sort((a, b) => time(a) - time(b)).slice(-limit);
}
