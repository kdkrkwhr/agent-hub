import {ROLE_IDS} from './roles.mjs';
import {parseBallot, tally} from './voting.mjs';

export const STEP_ROOMS = {opinion: 'research', rebuttal: 'forum', final: 'synthesis', review: 'review'};
const AWAY = new Set(['stopped', 'skipped']);
const ordered = roles => ROLE_IDS.filter(role => (roles || []).includes(role));

const idle = role => ({role, zone: 'lounge', status: 'pending', step: '', text: '', model: '', speaking: false});

export function pickThreads(timeline = [], running = null) {
  const items = timeline || [];
  const latest = kind => (running?.kind === kind && items.includes(running) ? running : [...items].reverse().find(thread => thread.kind === kind)) || null;
  const current = running && items.includes(running) ? running : items.at(-1) || null;
  return {work: latest('discussion'), vote: latest('vote'), room: current?.kind === 'vote' ? 'vote' : 'office'};
}

export function workActors(thread, roles = ROLE_IDS) {
  if (!thread || thread.kind !== 'discussion') return ordered(roles).map(idle);
  const finished = thread.status === 'done';
  return ordered(thread.roles).map(role => {
    const turns = thread.turns.filter(turn => turn.role === role);
    const latest = [...turns].reverse().find(turn => turn.status !== 'pending');
    const spoken = [...turns].reverse().find(turn => turn.text);
    const base = {...idle(role), text: spoken?.text || '', model: spoken?.model || ''};
    if (!latest) return base;
    const away = finished || AWAY.has(latest.status);
    return {
      ...base,
      zone: away ? 'lounge' : STEP_ROOMS[latest.step] || 'lounge',
      status: finished ? 'done' : latest.status,
      step: latest.step,
      speaking: latest.status === 'running',
      text: latest.status === 'running' ? latest.text : base.text,
    };
  });
}

export function voteActors(thread) {
  if (!thread || thread.kind !== 'vote') return [];
  const result = tally(thread);
  return thread.turns.map(turn => {
    const base = {role: turn.role, zone: 'booth', status: 'pending', step: 'ballot', text: '', model: '', speaking: false, choice: ''};
    if (!result) {
      const status = {running: 'thinking', done: 'submitted'}[turn.status] || turn.status;
      return {...base, status, speaking: turn.status === 'running'};
    }
    const ballot = turn.status === 'done' ? parseBallot(turn.text, thread.options) : null;
    if (!ballot) return {...base, zone: 'abstain', status: 'invalid', model: turn.model};
    if (ballot.choice === 'ABSTAIN') return {...base, zone: 'abstain', status: 'abstain', text: ballot.reason, model: turn.model};
    return {...base, zone: `option-${ballot.choice}`, status: 'chose', choice: ballot.choice, text: ballot.reason, model: turn.model};
  });
}
