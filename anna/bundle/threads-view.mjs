import {$, button, node, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLES, modelMismatch} from './roles.mjs';
import {runThread, skipTurn} from './runner.mjs';
import {canSkip, discussionPlan} from './discussion.mjs';
import {parseBallot, tally, votePlan} from './voting.mjs';
import {exportName, toMarkdown} from './export.mjs';

const PLANS = {discussion: discussionPlan, vote: votePlan};
const when = value => new Date(Number(value) || 0).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'ko-KR');

export function showView(ctx, name) {
  ctx.view = name;
  if (name !== 'thread') ctx.thread = null;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${name}`;
  for (const tab of document.querySelectorAll('#tabs [data-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.view === name));
}

export function renderHistory(ctx) {
  const archived = $('#show-archived').checked;
  const items = (ctx.threads || []).filter(item => (item.archived === true) === archived);
  const list = $('#thread-list');
  if (!items.length) return list.replaceChildren(node('li', 'empty', t('empty')));
  list.replaceChildren(...items.map(item => {
    const open = button('', () => openThread(ctx, item.id), 'thread-item');
    open.dataset.id = item.id;
    open.append(node('strong', '', item.title), node('span', 'meta', `${t(`kind-${item.kind}`)} · ${t(`status-${item.status}`)} · ${when(item.updated)}`));
    const entry = node('li');
    entry.append(open);
    return entry;
  }));
}

export async function refreshHistory(ctx) {
  try {
    ctx.threads = await ctx.store.listThreads();
  } catch {}
  renderHistory(ctx);
}

export function showThread(ctx, thread) {
  showView(ctx, 'thread');
  ctx.thread = thread;
  renderThread(ctx);
}

export async function openThread(ctx, id) {
  let thread = null;
  try {
    thread = ctx.running?.thread.id === id ? ctx.running.thread : await ctx.store.loadThread(id);
  } catch {}
  if (!thread) return notice(t('openFailed'));
  showThread(ctx, thread);
}

function modelLine(turn) {
  const parts = [`${t('actualModel')}: ${turn.model || t('unknownModel')}`];
  if (turn.requested) parts.push(`${t('requestedModel')}: ${turn.requested}`);
  const element = node('p', 'model', parts.join(' · '));
  if (modelMismatch(turn)) element.append(node('span', 'mismatch', t('mismatch')));
  return element;
}

function turnItem(ctx, thread, turn, index, revealed) {
  const item = node('li', `turn role-${turn.role}`);
  item.dataset.status = turn.status;
  item.dataset.step = turn.step;
  item.append(node('p', 'turn-head', `${t(`step-${turn.step}`)} · ${ROLES[turn.role].name[getLanguage()]} · ${t(`status-${turn.status}`)}`));
  if (turn.status !== 'pending') item.append(modelLine(turn));
  if (thread.kind === 'vote') {
    const ballot = revealed && turn.status === 'done' ? parseBallot(turn.text, thread.options) : null;
    if (ballot) {
      const choice = thread.options.find(option => option.id === ballot.choice);
      item.append(
        node('p', 'choice', choice ? `${choice.id}. ${choice.text}` : t('abstain')),
        node('p', 'text', `${t('reason')}: ${ballot.reason}`),
        node('p', 'text', `${t('concern')}: ${ballot.concern}`),
      );
    } else if (turn.status === 'done') {
      item.append(node('p', 'sealed', t('sealed')));
    }
  } else if (turn.text) {
    item.append(node('p', 'text', turn.text));
  }
  if (turn.error) item.append(node('p', 'error', t(`error-${turn.error}`)));
  if (!ctx.running && (turn.status === 'failed' || turn.status === 'stopped')) {
    const actions = node('div', 'actions');
    actions.append(button(t('retry'), () => run(ctx, thread), 'retry'));
    if (thread.kind === 'vote' || canSkip(turn)) {
      actions.append(button(t('skip'), () => {
        skipTurn(thread, index);
        run(ctx, thread);
      }, 'skip'));
    }
    item.append(actions);
  }
  return item;
}

function renderTally(thread, result) {
  const box = $('#vote-result');
  box.hidden = !result;
  if (!result) return box.replaceChildren();
  const list = node('ul');
  for (const option of thread.options) list.append(node('li', '', `${option.id}. ${option.text} — ${t('votes', {n: result.counts[option.id]})}`));
  list.append(node('li', '', `${t('abstain')} — ${t('votes', {n: result.counts.ABSTAIN})}`));
  box.replaceChildren(node('h3', '', t('resultTitle')), list);
}

function download(thread) {
  const url = URL.createObjectURL(new Blob([toMarkdown(thread, getLanguage())], {type: 'text/markdown'}));
  const link = node('a');
  link.href = url;
  link.download = exportName(thread);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(thread) {
  const text = toMarkdown(thread, getLanguage());
  try {
    await navigator.clipboard.writeText(text);
    notice(t('copied'));
  } catch {
    const area = $('#export-text');
    area.value = text;
    area.hidden = false;
    area.select();
    notice(t('copyFailed'));
  }
}

async function archive(ctx, thread) {
  thread.archived = !thread.archived;
  try {
    ctx.threads = await ctx.store.saveThread(thread);
    renderThread(ctx);
  } catch {
    thread.archived = !thread.archived;
    notice(t('saveFailed'));
  }
}

function removeButton(ctx, thread) {
  let armed = false;
  let timer;
  const element = button(t('remove'), async () => {
    if (!armed) {
      armed = true;
      element.textContent = t('confirmRemove');
      element.classList.add('armed');
      timer = setTimeout(() => {
        armed = false;
        element.textContent = t('remove');
        element.classList.remove('armed');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    element.disabled = true;
    try {
      ctx.threads = await ctx.store.deleteThread(thread.id);
      showView(ctx, 'history');
      renderHistory(ctx);
      notice(t('removed'));
    } catch {
      element.disabled = false;
      notice(t('saveFailed'));
    }
  }, 'remove');
  return element;
}

export function renderThread(ctx) {
  const thread = ctx.thread;
  if (!thread || ctx.view !== 'thread') return;
  const running = ctx.running?.thread === thread;
  $('#thread-title').textContent = thread.title;
  $('#thread-meta').textContent = `${t(`kind-${thread.kind}`)} · ${t(`status-${thread.status}`)} · ${when(thread.updated)}`;
  const actions = [];
  if (running) actions.push(button(t('stop'), () => ctx.running.controller.abort(), 'stop'));
  if (!ctx.running && thread.status !== 'done') actions.push(button(t('resume'), () => run(ctx, thread), 'resume'));
  if (!running) {
    actions.push(
      button(t('exportFile'), () => download(thread), 'export'),
      button(t('copy'), () => copy(thread), 'copy'),
      button(thread.archived ? t('unarchive') : t('archive'), () => archive(ctx, thread), 'archive'),
      removeButton(ctx, thread),
    );
  }
  $('#thread-actions').replaceChildren(...actions);
  const result = thread.kind === 'vote' ? tally(thread) : null;
  $('#turns').replaceChildren(...thread.turns.map((turn, index) => turnItem(ctx, thread, turn, index, Boolean(result))));
  renderTally(thread, result);
  $('#export-text').hidden = true;
}

export async function run(ctx, thread) {
  if (ctx.running) return notice(t('busy'));
  const controller = new AbortController();
  ctx.running = {thread, controller};
  notice('');
  let warned = false;
  try {
    const result = await runThread({
      thread,
      plan: PLANS[thread.kind],
      ai: ctx.ai,
      store: ctx.store,
      settings: ctx.settings,
      signal: controller.signal,
      onUpdate: (current, {saveFailed}) => {
        if (saveFailed && !warned) {
          warned = true;
          notice(t('saveRetry'));
        }
        if (ctx.thread === current) renderThread(ctx);
      },
    });
    ctx.settings = result.settings;
    const failed = thread.turns.find(turn => turn.status === 'failed');
    if (failed) notice(t(`error-${failed.error}`));
    else if (result.saveFailed) notice(t('saveRetry'));
  } finally {
    ctx.running = null;
    renderThread(ctx);
    await refreshHistory(ctx);
    ctx.onSettings();
  }
}

export function mountThreads(ctx) {
  $('#show-archived').addEventListener('change', () => renderHistory(ctx));
  $('#back').addEventListener('click', () => {
    showView(ctx, 'history');
    refreshHistory(ctx);
  });
}
