import {$, button, confirmButton, copyText, node, notice, when} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLES, modelMismatch} from './roles.mjs';
import {runThread, saveThreadOnly, settleInterrupted, skipTurn} from './runner.mjs';
import {canSkip, discussionPlan} from './discussion.mjs';
import {parseBallot, tally, votePlan} from './voting.mjs';
import {toMarkdown} from './export.mjs';
import {channelThreads} from './channels.mjs';
import {channelRecord, currentChannel} from './context.mjs';
import {decisionSections} from './decision.mjs';
import {storageErrorKind} from './store.mjs';

const PLANS = {discussion: discussionPlan, vote: votePlan};
const TAGS = {analyst: 'AN', critic: 'CR', editor: 'ED'};
const roleName = id => ROLES[id].name[getLanguage()];
const shape = thread => `${thread.status}|${thread.savePending}|${thread.saveError}|${thread.turns.map(turn => `${turn.status}:${turn.requested}`).join(',')}`;
const saveMessage = thread => t(`storage-${thread.saveError || 'connection'}`);
const leased = thread => thread.leaseUntil > Date.now();
const pendingSaves = ctx => ctx.pendingSaves ||= new Map();
const feed = () => $('#feed');
const nearBottom = element => element.scrollHeight - element.scrollTop - element.clientHeight < 120;

function avatar(role) {
  const element = node('span', 'avatar', role ? TAGS[role] : t('you'));
  element.setAttribute('aria-hidden', 'true');
  return element;
}

function modelBadge(turn) {
  const element = node('span', 'model', turn.model || t('unknownModel'));
  element.title = t('actualModel');
  if (turn.requested) element.append(node('span', 'requested', ` · ${t('requestedModel')}: ${turn.requested}`));
  if (modelMismatch(turn)) element.append(node('span', 'mismatch', t('mismatch')));
  return element;
}

function userBubble(thread) {
  const item = node('div', 'message user');
  const body = node('div', 'bubble-body');
  const head = node('div', 'message-head');
  head.append(node('span', 'sender', t('you')), node('time', '', when(thread.created || thread.updated)));
  const text = node('div', 'message-text');
  if (thread.kind === 'vote') {
    text.append(node('strong', 'vote-label', t('secretVote')), node('p', '', thread.passage));
    const list = node('ol', 'option-list');
    for (const option of thread.options) list.append(node('li', '', `${option.id}. ${option.text}`));
    text.append(list);
  } else {
    text.textContent = thread.request;
  }
  body.append(head, text);
  item.append(body, avatar(''));
  return item;
}

function turnActions(ctx, thread, turn, index) {
  if (ctx.running || pendingSaves(ctx).size || leased(thread) || (turn.status !== 'failed' && turn.status !== 'stopped')) return null;
  const actions = node('div', 'turn-actions');
  actions.append(button(t('retry'), () => run(ctx, thread), 'retry'));
  if (thread.kind === 'vote' || canSkip(turn)) {
    actions.append(button(t('skip'), () => {
      skipTurn(thread, index);
      run(ctx, thread);
    }, 'skip'));
  }
  return actions;
}

function turnBubble(ctx, thread, turn, index) {
  const item = node('div', `message role-${turn.role}`);
  item.dataset.status = turn.status;
  item.dataset.step = turn.step;
  const body = node('div', 'bubble-body');
  const head = node('div', 'message-head');
  head.append(node('span', 'sender', roleName(turn.role)), node('span', 'step', t(`step-${turn.step}`)));
  if (turn.status !== 'running') head.append(modelBadge(turn));
  if (turn.status !== 'done') head.append(node('span', `tag status-${turn.status}`, t(`status-${turn.status}`)));
  body.append(head);
  if (turn.text || turn.status === 'running') {
    const text = node('div', 'message-text', turn.text || t('writing'));
    if (!turn.text) text.classList.add('typing');
    body.append(text);
  }
  if (turn.error) body.append(node('p', 'error', t(`error-${turn.error}`)));
  const actions = turnActions(ctx, thread, turn, index);
  if (actions) body.append(actions);
  item.append(avatar(turn.role), body);
  return item;
}

function ballotCard(ctx, thread) {
  const result = tally(thread);
  const done = thread.turns.filter(turn => turn.status === 'done').length;
  const card = node('div', 'ballot-card');
  const head = node('div', 'ballot-head');
  head.append(node('span', 'eyebrow', t('ballotEyebrow')), node('span', 'count', t('ballotsIn', {n: done, total: thread.turns.length})));
  const list = node('ul', 'ballots');
  thread.turns.forEach((turn, index) => {
    const item = node('li', `ballot role-${turn.role}`);
    item.dataset.status = turn.status;
    const main = node('div', 'ballot-main');
    main.append(node('strong', 'sender', roleName(turn.role)));
    const ballot = result && turn.status === 'done' ? parseBallot(turn.text, thread.options) : null;
    if (ballot) {
      const choice = thread.options.find(option => option.id === ballot.choice);
      main.append(
        node('span', 'choice', choice ? `${choice.id}. ${choice.text}` : t('abstain')),
        node('p', 'reason', `${t('reason')}: ${ballot.reason}`),
        node('p', 'reason', `${t('concern')}: ${ballot.concern}`),
        modelBadge(turn),
      );
    } else {
      main.append(node('span', turn.status === 'done' ? 'sealed' : `tag status-${turn.status}`, turn.status === 'done' ? t('submitted') : t(`status-${turn.status}`)));
    }
    if (turn.error) main.append(node('p', 'error', t(`error-${turn.error}`)));
    const actions = turnActions(ctx, thread, turn, index);
    if (actions) main.append(actions);
    item.append(avatar(turn.role), main);
    list.append(item);
  });
  card.append(head, list);
  if (result) {
    const box = node('div', 'vote-result');
    box.append(node('strong', '', t('resultTitle')));
    const total = thread.turns.length;
    const rows = [...thread.options.map(option => [`${option.id}. ${option.text}`, result.counts[option.id]]), [t('abstain'), result.counts.ABSTAIN]];
    for (const [label, count] of rows) {
      const row = node('div', 'result-row');
      const bar = node('progress');
      bar.max = total;
      bar.value = count;
      row.append(node('span', 'label', label), bar, node('span', 'votes', t('votes', {n: count})));
      box.append(row);
    }
    card.append(box);
  }
  return card;
}

async function removeThread(ctx, thread) {
  try {
    ctx.threads = await ctx.store.deleteThread(thread.id, thread._etag);
    ctx.timeline = ctx.timeline.filter(item => item.id !== thread.id);
    pendingSaves(ctx).delete(thread.id);
    ctx.render();
    notice(t('removed'));
  } catch (error) {
    notice(t(`storage-${storageErrorKind(error)}`));
  }
}

function runFoot(ctx, thread) {
  const foot = node('div', 'run-foot');
  const state = thread.savePending ? 'unsaved' : thread.status;
  const pill = node('span', `pill status-${state}`, `${t(`kind-${thread.kind}`)} · ${t(`status-${state}`)}`);
  foot.append(pill);
  const running = ctx.running?.thread === thread;
  if (running) foot.append(button(t('stop'), () => ctx.running?.controller.abort(), 'stop'));
  if (!ctx.running && thread.savePending) {
    foot.append(node('p', 'save-warning', saveMessage(thread)));
    const retry = button(t('retrySave'), async () => {
      retry.disabled = true;
      const result = await saveThreadOnly({thread, store: ctx.store});
      if (result.saved) {
        pendingSaves(ctx).delete(thread.id);
        if (Array.isArray(result.threads)) ctx.threads = result.threads;
        notice(t('savedNoAi'));
      } else notice(saveMessage(thread));
      ctx.render();
    }, 'retry-save');
    if (!['conflict', 'busy'].includes(thread.saveError)) foot.append(retry);
    foot.append(confirmButton(t('reloadRecord'), t('confirmReload'), async () => {
      try {
        const latest = await ctx.store.loadThread(thread.id);
        const threads = await ctx.store.listThreads();
        pendingSaves(ctx).delete(thread.id);
        ctx.threads = threads;
        ctx.timeline = ctx.timeline.filter(item => item.id !== thread.id);
        if (latest) ctx.timeline.push(latest);
        await loadTimeline(ctx);
        ctx.render();
        notice(t('loadedLatest'));
      } catch { notice(t('openFailed')); }
    }, 'reload-record'));
  } else if (!ctx.running && !pendingSaves(ctx).size && thread.status !== 'done') {
    if (leased(thread)) foot.append(node('p', 'save-warning', t('storage-busy')),
      button(t('refreshRecords'), () => ctx.refresh(), 'refresh-run'));
    else foot.append(button(t('resume'), () => run(ctx, thread), 'resume'));
  }
  if (thread.status === 'stopped' || thread.turns.some(turn => turn.error === 'timeout')) foot.append(node('p', 'resume-note', t('resumeNotice')));
  if (!running) {
    foot.append(
      button(t('copy'), () => copyText(toMarkdown(thread, getLanguage())), 'copy'),
    );
    if (!thread.savePending && !leased(thread)) foot.append(confirmButton(t('remove'), t('confirmRemove'), () => removeThread(ctx, thread), 'remove'));
  }
  return foot;
}

function decisionCard(thread) {
  const final = thread.turns.find(turn => turn.step === 'final' && turn.status === 'done');
  if (!final) return null;
  const card = node('section', 'decision-card');
  const head = node('div', 'decision-head');
  head.append(node('h2', '', t('decisionTitle')), modelBadge(final));
  head.append(button(t('copyDecision'), () => copyText(decisionText(thread)), 'copy-decision'));
  card.append(head, node('p', 'hint', t(thread.mode === 'quick' ? 'quickResultHint' : 'decisionHint')));
  const sections = thread.purpose === 'priority' ? decisionSections(final.text, thread.language) : null;
  if (sections) {
    const grid = node('div', 'decision-grid');
    for (const [index, section] of sections.entries()) {
      const cell = node('section', `decision-section decision-section-${index}`);
      cell.append(node('h3', '', section.title), node('p', 'decision-text', section.text));
      grid.append(cell);
    }
    card.append(grid);
  } else card.append(node('p', 'decision-text', final.text));
  const reviews = thread.turns.filter(turn => turn.step === 'review');
  if (reviews.length) {
    const box = node('div', 'decision-reviews');
    box.append(node('h3', '', t('reviewNotes')));
    for (const review of reviews) {
      box.append(node('p', 'decision-text', `${roleName(review.role)} · ${t(`status-${review.status}`)}\n${review.text || ''}`));
    }
    card.append(box);
  }
  if (thread.turns.some(turn => turn.status === 'skipped')) card.append(node('p', 'hint', t('partialDecision')));
  return card;
}

function decisionText(thread) {
  const final = thread.turns.find(turn => turn.step === 'final' && turn.status === 'done');
  const reviews = thread.turns.filter(turn => turn.step === 'review').map(turn => `${roleName(turn.role)} · ${t(`status-${turn.status}`)}\n${turn.text || ''}`);
  return [thread.title, t('decisionHint'), final?.text || '', reviews.length ? t('reviewNotes') : '', ...reviews,
    thread.turns.some(turn => turn.status === 'skipped') ? t('partialDecision') : ''].filter(Boolean).join('\n\n');
}

function runBlock(ctx, thread) {
  const block = node('article', 'run');
  block.dataset.id = thread.id;
  block.dataset.kind = thread.kind;
  block.dataset.status = thread.savePending ? 'unsaved' : thread.status;
  block.append(userBubble(thread));
  if (thread.kind === 'vote') block.append(ballotCard(ctx, thread));
  else {
    const decision = decisionCard(thread);
    if (decision) block.append(decision);
    const history = decision ? node('details', 'discussion-history') : block;
    if (decision) {
      history.open = thread.status !== 'done';
      history.append(node('summary', '', t('allOpinions')));
      block.append(history);
    }
    thread.turns.forEach((turn, index) => { if (turn.status !== 'pending') history.append(turnBubble(ctx, thread, turn, index)); });
  }
  block.append(runFoot(ctx, thread));
  return block;
}

function emptyState(ctx) {
  const box = node('div', 'empty');
  if (!ctx.channel) {
    box.append(node('h2', '', t('welcomeTitle')), node('p', '', t('welcomeHint')));
    box.append(button(t('newChannel'), () => ctx.newChannel(), 'primary welcome-new'));
  } else {
    box.append(node('h2', '', t('welcomeTitle')), node('p', '', t('emptyChannel')));
    box.append(button(t('priorityExample'), () => $('#priority-example').click(), 'example-start'));
  }
  return box;
}

export function renderTimeline(ctx, {scroll = false} = {}) {
  const element = feed();
  const pinned = scroll || nearBottom(element);
  const runs = ctx.channel ? ctx.timeline || [] : [];
  ctx.shapes = new Map(runs.map(thread => [thread.id, shape(thread)]));
  element.replaceChildren(...(runs.length ? runs.map(thread => runBlock(ctx, thread)) : [emptyState(ctx)]));
  if (pinned) element.scrollTop = element.scrollHeight;
}

function updateRun(ctx, thread) {
  const element = feed();
  const block = element.querySelector(`.run[data-id="${thread.id}"]`);
  if (!block) return;
  const pinned = nearBottom(element);
  if (ctx.shapes.get(thread.id) === shape(thread)) {
    const turn = thread.turns.find(item => item.status === 'running');
    const text = block.querySelector('.message[data-status="running"] .message-text');
    if (thread.kind === 'discussion' && turn && text) {
      text.textContent = turn.text || t('writing');
      text.classList.toggle('typing', !turn.text);
    }
  } else {
    ctx.shapes.set(thread.id, shape(thread));
    block.replaceWith(runBlock(ctx, thread));
  }
  if (pinned) element.scrollTop = element.scrollHeight;
}

let loading = 0;

export async function loadTimeline(ctx) {
  const request = ++loading;
  const id = ctx.channel;
  if (!id) {
    ctx.timeline = [];
    return renderTimeline(ctx);
  }
  const items = channelThreads(ctx.threads, id);
  for (const thread of pendingSaves(ctx).values()) {
    if (thread.channel === id && !items.some(item => item.id === thread.id)) items.push(thread);
  }
  const loaded = await Promise.all(items.map(item => (pendingSaves(ctx).get(item.id) || (ctx.running?.thread.id === item.id ? ctx.running.thread : ctx.store.loadThread(item.id).catch(() => null)))));
  if (request !== loading || ctx.channel !== id) return;
  ctx.timeline = loaded.filter(Boolean);
  if (ctx.timeline.length < items.length) notice(t('openFailed'));
  for (const thread of ctx.timeline) {
    if (thread.savePending || thread === ctx.running?.thread || thread.status !== 'running') continue;
    settleInterrupted(thread);
  }
  renderTimeline(ctx, {scroll: true});
  ctx.renderOffice?.();
}

export async function run(ctx, thread) {
  if (ctx.running) return notice(t('busy'));
  if (pendingSaves(ctx).size || thread.savePending) return notice(t('saveRetry'));
  const controller = new AbortController();
  ctx.running = {thread, controller};
  notice('');
  ctx.render();
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
        if (saveFailed) pendingSaves(ctx).set(current.id, current);
        if (saveFailed && !warned) {
          warned = true;
          notice(saveMessage(current));
        }
        if (!ctx.timeline?.includes(current)) return;
        updateRun(ctx, current);
        ctx.renderOffice?.();
      },
    });
    ctx.settings = {...ctx.settings, seenModels: result.settings.seenModels};
    const failed = thread.turns.find(turn => turn.status === 'failed');
    if (failed) notice(t(`error-${failed.error}`));
    else if (result.saveFailed) notice(saveMessage(thread));
  } catch {
    notice(t('loadFailed'));
  } finally {
    ctx.running = null;
    for (const step of [async () => { ctx.threads = await ctx.store.listThreads(); }, () => ctx.render(), () => ctx.onSettings()]) {
      try {
        await step();
      } catch {}
    }
  }
}

export async function startThread(ctx, thread) {
  if (pendingSaves(ctx).size) { notice(t('saveRetry')); return false; }
  if (ctx.running || ctx.starting) {
    notice(t('busy'));
    return false;
  }
  const channel = currentChannel(ctx);
  if (!channel || channel.archived) return false;
  ctx.starting = true;
  thread.channel = channel.id;
  try {
    ctx.threads = await ctx.store.saveThread(thread);
  } catch (error) {
    notice(t(`storage-${storageErrorKind(error)}`));
    return false;
  } finally {
    ctx.starting = false;
  }
  ctx.store.saveChannel(channelRecord(channel, {roles: ctx.picks, updated: thread.created}))
    .then(channels => { ctx.channels = channels; })
    .catch(() => {});
  if (ctx.channel === channel.id) ctx.timeline = [...(ctx.timeline || []), thread];
  run(ctx, thread);
  return true;
}
