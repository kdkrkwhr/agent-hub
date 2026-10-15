import {$, later, node, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLE_IDS, ROLES} from './roles.mjs';
import {createDiscussion, discussionSteps} from './discussion.mjs';
import {createVote} from './voting.mjs';
import {newId} from './runner.mjs';
import {run, showThread} from './threads-view.mjs';

const forms = () => [$('#discussion-form'), $('#vote-form')];
const picked = form => [...form.querySelectorAll('input[name="roles"]:checked')].map(input => input.value);

function estimate() {
  const discussion = $('#discussion-form');
  const roles = picked(discussion);
  discussion.querySelector('[data-estimate]').textContent = roles.length < 2 ? t('needRoles') : t('estimate', {n: discussionSteps(roles).length});
  const vote = $('#vote-form');
  const voters = picked(vote);
  vote.querySelector('[data-estimate]').textContent = voters.length ? t('estimate', {n: voters.length}) : t('needRole');
}

export function renderPicks() {
  for (const form of forms()) {
    const box = form.querySelector('[data-picks]');
    const chosen = box.children.length ? picked(form) : ROLE_IDS;
    box.replaceChildren(...ROLE_IDS.map(id => {
      const input = node('input');
      input.type = 'checkbox';
      input.name = 'roles';
      input.value = id;
      input.checked = chosen.includes(id);
      const label = node('label', `pick role-${id}`);
      label.append(input, node('span', '', ROLES[id].name[getLanguage()]));
      return label;
    }));
  }
  estimate();
}

const submits = () => forms().map(form => form.querySelector('button[type="submit"]'));

async function start(ctx, thread, form) {
  if (ctx.running || ctx.starting) return notice(t('busy'));
  ctx.starting = true;
  const view = ctx.view;
  for (const submit of submits()) submit.disabled = true;
  try {
    ctx.threads = await ctx.store.saveThread(thread);
  } catch {
    return notice(t('saveFailed'));
  } finally {
    ctx.starting = false;
    for (const submit of submits()) submit.disabled = false;
  }
  for (const area of form.querySelectorAll('textarea')) area.value = '';
  if (ctx.view === view) showThread(ctx, thread);
  await run(ctx, thread);
}

export function mountCompose(ctx) {
  for (const form of forms()) form.addEventListener('change', estimate);
  $('#discussion-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const request = form.elements.request.value;
    const roles = picked(form);
    if (!request.trim()) return notice(t('needText'));
    if (roles.length < 2) return notice(t('needRoles'));
    later(start(ctx, createDiscussion({id: newId(), request, roles, language: getLanguage(), detail: form.elements.detail.checked}), form));
  });
  $('#vote-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const passage = form.elements.passage.value;
    const options = form.elements.options.value.split('\n').map(line => line.trim()).filter(Boolean);
    const roles = picked(form);
    if (!passage.trim()) return notice(t('needText'));
    if (options.length < 2) return notice(t('needOptions'));
    if (!roles.length) return notice(t('needRole'));
    later(start(ctx, createVote({id: newId(), passage, options, roles, language: getLanguage()}), form));
  });
  for (const submit of submits()) submit.disabled = false;
}
