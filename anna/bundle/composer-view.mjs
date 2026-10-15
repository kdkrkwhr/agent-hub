import {$, button, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLE_IDS, ROLES} from './roles.mjs';
import {createDiscussion, discussionSteps} from './discussion.mjs';
import {newId} from './runner.mjs';
import {currentChannel} from './context.mjs';
import {startThread} from './timeline-view.mjs';

const form = () => $('#composer');

export function renderComposer(ctx) {
  const channel = currentChannel(ctx);
  const open = Boolean(channel && !channel.archived);
  const picks = ctx.picks || [];
  $('#role-chips').replaceChildren(...ROLE_IDS.map(id => {
    const chip = button(`@${ROLES[id].name[getLanguage()]}`, () => {
      ctx.picks = picks.includes(id) ? picks.filter(role => role !== id) : ROLE_IDS.filter(role => role === id || picks.includes(role));
      renderComposer(ctx);
    }, `chip role-${id}`);
    chip.dataset.role = id;
    chip.setAttribute('aria-pressed', String(picks.includes(id)));
    chip.disabled = !open;
    return chip;
  }));
  $('#estimate').textContent = !channel ? '' : picks.length < 2 ? t('needRoles') : t('estimate', {n: discussionSteps(picks).length});
  $('#composer-closed').hidden = !channel || !channel.archived;
  for (const element of [form().elements.request, form().elements.detail, $('#send'), $('#open-ballot')]) element.disabled = !open;
}

export function mountComposer(ctx) {
  const element = form();
  element.elements.request.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    element.requestSubmit();
  });
  element.addEventListener('submit', async event => {
    event.preventDefault();
    const request = element.elements.request.value;
    const roles = ctx.picks || [];
    if (!request.trim()) return notice(t('needText'));
    if (roles.length < 2) return notice(t('needRoles'));
    const thread = createDiscussion({id: newId(), request, roles, language: getLanguage(), detail: element.elements.detail.checked});
    if (await startThread(ctx, thread)) element.elements.request.value = '';
  });
}
