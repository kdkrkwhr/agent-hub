import {AiError} from './ai.mjs';
import {modelPreferences, recordModel, requestedLabel} from './roles.mjs';

const MAX_TEXT = 8000;

export function newId(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export const blankTurn = (step, role) => ({step, role, status: 'pending', text: '', model: '', requested: '', error: ''});

export const settled = turn => turn.status === 'done' || turn.status === 'skipped';

export function skipTurn(thread, index) {
  const turn = thread.turns[index];
  if (turn && !settled(turn)) Object.assign(turn, {status: 'skipped', error: ''});
  return thread;
}

export async function runThread({thread, plan, ai, store, settings, signal, onUpdate = () => {}, now = Date.now}) {
  let latest = settings;
  let saveFailed = false;
  const update = () => onUpdate(thread, {saveFailed});
  async function save() {
    thread.updated = now();
    try {
      await store.saveThread(thread);
      saveFailed = false;
    } catch {
      saveFailed = true;
    }
    update();
  }
  thread.status = 'running';
  for (let index = 0; index < thread.turns.length; index += 1) {
    const turn = thread.turns[index];
    if (settled(turn)) continue;
    const role = latest.roles[turn.role];
    Object.assign(turn, {status: 'running', text: '', model: '', error: '', requested: requestedLabel(role)});
    update();
    try {
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
      turn.error = plan.accept ? plan.accept(thread, index) : '';
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
    await save();
  }
  thread.status = 'done';
  await save();
  return {thread, settings: latest, saveFailed};
}
