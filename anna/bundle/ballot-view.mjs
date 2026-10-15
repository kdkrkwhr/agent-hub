import {$, button, node, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLE_IDS, ROLES} from './roles.mjs';
import {createVote} from './voting.mjs';
import {newId} from './runner.mjs';
import {startThread} from './timeline-view.mjs';

const MIN = 2;
const MAX = 6;
const letter = index => String.fromCharCode(65 + index);
const dialog = () => $('#ballot-dialog');
const values = () => [...document.querySelectorAll('#ballot-options input')].map(input => input.value);
const voters = () => [...document.querySelectorAll('#ballot-voters input:checked')].map(input => input.value);

function renderOptions(list) {
  $('#ballot-options').replaceChildren(...list.map((value, index) => {
    const id = letter(index);
    const input = node('input');
    input.name = `option-${id}`;
    input.maxLength = 200;
    input.value = value;
    input.setAttribute('aria-label', t('optionLabel', {id}));
    const remove = button(t('removeOption'), () => {
      const next = values();
      next.splice(index, 1);
      renderOptions(next);
    }, 'ghost remove-option');
    remove.disabled = list.length <= MIN;
    const item = node('li');
    item.append(node('span', 'letter', id), input, remove);
    return item;
  }));
  $('#add-option').disabled = list.length >= MAX;
}

function estimate() {
  const n = voters().length;
  $('#ballot-estimate').textContent = n ? t('estimate', {n}) : t('needRole');
}

export function openBallot(ctx) {
  const form = $('#ballot-form');
  form.elements.passage.value = '';
  renderOptions(['', '']);
  const picks = ctx.picks?.length ? ctx.picks : ROLE_IDS;
  $('#ballot-voters').replaceChildren(...ROLE_IDS.map(id => {
    const input = node('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = picks.includes(id);
    const label = node('label', `check pick role-${id}`);
    label.append(input, node('span', '', ROLES[id].name[getLanguage()]));
    return label;
  }));
  estimate();
  notice('');
  dialog().showModal();
  form.elements.passage.focus();
}

export function mountBallot(ctx) {
  const form = $('#ballot-form');
  $('#open-ballot').addEventListener('click', () => openBallot(ctx));
  $('#ballot-cancel').addEventListener('click', () => dialog().close());
  $('#add-option').addEventListener('click', () => {
    if (values().length < MAX) renderOptions([...values(), '']);
  });
  $('#ballot-voters').addEventListener('change', estimate);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const passage = form.elements.passage.value;
    const options = values().map(value => value.trim()).filter(Boolean);
    const roles = voters();
    if (!passage.trim()) return notice(t('needText'));
    if (options.length < MIN) return notice(t('needOptions'));
    if (!roles.length) return notice(t('needRole'));
    const thread = createVote({id: newId(), passage, options, roles, language: getLanguage()});
    dialog().close();
    if (!await startThread(ctx, thread)) dialog().showModal();
  });
}
