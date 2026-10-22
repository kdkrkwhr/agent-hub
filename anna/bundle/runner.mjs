import {AiError} from './ai.mjs';
import {modelPreferences, recordModel, requestedLabel} from './roles.mjs';
import {storageErrorKind} from './store.mjs';

const MAX_TEXT = 8000;

export function newId(now = Date.now(), random = Math.random) {
  if (!arguments.length && globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export const blankTurn = (step, role) => ({step, role, status: 'pending', text: '', model: '', requested: '', error: ''});

export const settled = turn => turn.status === 'done' || turn.status === 'skipped';

export function skipTurn(thread, index) {
  const turn = thread.turns[index];
  if (turn && turn.step !== 'final' && !settled(turn)) Object.assign(turn, {status: 'skipped', error: '', text: ''});
  return thread;
}

export function settleInterrupted(thread) {
  if (thread.status !== 'running') return thread;
  thread.status = 'stopped';
  for (const turn of thread.turns) if (turn.status === 'running') turn.status = 'stopped';
  return thread;
}

// Save an already received response without asking the model again.
export async function saveThreadOnly({thread, store, now = Date.now}) {
  const updated = now();
  try {
    const snapshot = structuredClone({...thread, updated, savePending: false,
      leaseUntil: thread.status === 'running' ? thread.leaseUntil : 0});
    const threads = await store.saveThread(snapshot);
    Object.assign(thread, {updated, savePending: false, saveError: '', _etag: snapshot._etag, leaseUntil: snapshot.leaseUntil});
    return {saved: true, threads};
  } catch (error) {
    thread.savePending = true;
    thread.saveError = storageErrorKind(error);
    if (thread.status === 'running') thread.status = 'stopped';
    return {saved: false};
  }
}

export async function runThread({thread, plan, ai, store, settings, signal, onUpdate = () => {}, now = Date.now}) {
  let latest = settings;
  let saveFailed = thread.savePending === true;
  if (saveFailed) return {thread, settings: latest, saveFailed};
  const update = () => {
    try {
      onUpdate(thread, {saveFailed});
    } catch {}
  };
  async function save() {
    saveFailed = !(await saveThreadOnly({thread, store, now})).saved;
    update();
    return !saveFailed;
  }
  thread.status = 'running';
  thread.runOwner = newId();
  for (let index = 0; index < thread.turns.length; index += 1) {
    const turn = thread.turns[index];
    if (settled(turn)) continue;
    if (signal?.aborted) {
      thread.status = 'stopped';
      await save();
      return {thread, settings: latest, saveFailed};
    }
    Object.assign(turn, {status: 'running', text: '', model: '', error: '', requested: ''});
    thread.leaseUntil = now() + 150000;
    // Persist the in-flight marker before a potentially billable request.
    if (!await save()) {
      turn.status = 'pending';
      update();
      return {thread, settings: latest, saveFailed};
    }
    try {
      if (signal?.aborted) throw new AiError('aborted', 'aborted');
      const role = latest.roles?.[turn.role] || {};
      turn.requested = requestedLabel(role);
      const {system, messages, maxTokens} = plan.prompt(thread, index);
      const reply = await ai.speak({
        system,
        messages,
        maxTokens,
        signal,
        preferences: modelPreferences(role),
        onToken: text => {
          turn.text = text.slice(0, MAX_TEXT);
          update();
        },
      });
      Object.assign(turn, {text: String(reply.text || '').slice(0, MAX_TEXT), model: reply.model || ''});
      turn.error = !turn.text.trim() ? 'empty' : String(reply.text).length > MAX_TEXT ? 'incomplete' : plan.accept ? plan.accept(thread, index) : '';
      turn.status = turn.error ? 'failed' : 'done';
      if (turn.model) {
        try {
          latest = await store.updateSettings(current => recordModel(current, turn.model));
        } catch {}
      }
    } catch (error) {
      const kind = error instanceof AiError ? error.kind : 'unavailable';
      Object.assign(turn, {
        status: kind === 'aborted' ? 'stopped' : 'failed',
        error: kind === 'aborted' ? '' : kind,
        text: String(error?.partial ?? turn.text).slice(0, MAX_TEXT),
      });
    }
    if (turn.status !== 'done') {
      thread.status = turn.status;
      await save();
      return {thread, settings: latest, saveFailed};
    }
    if (!await save()) return {thread, settings: latest, saveFailed};
  }
  thread.status = 'done';
  await save();
  return {thread, settings: latest, saveFailed};
}
