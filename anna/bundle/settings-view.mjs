import {$, node, notice} from './view.mjs';
import {FAMILIES, ROLE_IDS, ROLES, TEMPERAMENTS} from './roles.mjs';
import {getLanguage, setLanguage, t} from './i18n.mjs';

function option(value, label, selected) {
  const element = node('option', '', label);
  element.value = value;
  element.selected = selected;
  return element;
}

function field(label, control) {
  const wrapper = node('label');
  wrapper.append(node('span', '', label), control);
  return wrapper;
}

function select(name, entries) {
  const element = node('select');
  element.name = name;
  element.append(...entries);
  return element;
}

export function renderSettings(ctx) {
  const language = getLanguage();
  const {settings} = ctx;
  $('#roles').replaceChildren(...ROLE_IDS.map(id => {
    const role = settings.roles[id];
    const models = role.model && !settings.seenModels.includes(role.model) ? [role.model, ...settings.seenModels] : settings.seenModels;
    const card = node('fieldset', `role role-${id}`);
    card.dataset.role = id;
    const model = select(`${id}-model`, [
      option('', models.length ? t('noModel') : t('noSeen'), !role.model),
      ...models.map(name => option(name, name, role.model === name)),
    ]);
    model.disabled = !models.length;
    card.append(
      node('legend', '', ROLES[id].name[language]),
      node('p', '', ROLES[id].persona[language]),
      field(t('temperament'), select(`${id}-temperament`, Object.keys(TEMPERAMENTS).map(key => option(key, t(key), role.temperament === key)))),
      field(t('family'), select(`${id}-family`, FAMILIES.map(key => option(key, t(key), role.family === key)))),
      field(t('model'), model),
    );
    return card;
  }));
}

function readRoles() {
  const data = new FormData($('#settings-form'));
  return Object.fromEntries(ROLE_IDS.map(id => [id, {
    temperament: data.get(`${id}-temperament`),
    family: data.get(`${id}-family`),
    model: data.get(`${id}-model`) || '',
  }]));
}

export function refreshModels(ctx) {
  if (!$('#settings-form [name$="-temperament"]')) return renderSettings(ctx);
  renderSettings({...ctx, settings: {...ctx.settings, roles: readRoles()}});
}

export function mountSettings(ctx) {
  const dialog = $('#settings-dialog');
  for (const opener of [$('#open-settings'), $('#settings-button')]) {
    opener.addEventListener('click', () => {
      document.body.classList.remove('drawer-open');
      notice('');
      renderSettings(ctx);
      dialog.showModal();
    });
  }
  $('#settings-close').addEventListener('click', () => dialog.close());
  const form = $('#settings-form');
  const submit = form.querySelector('button[type="submit"]');
  const picker = $('#language');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const roles = readRoles();
      ctx.settings = await ctx.store.updateSettings(current => ({...current, roles}));
      renderSettings(ctx);
      notice(t('saved'));
    } catch {
      notice(t('saveFailed'));
    } finally {
      submit.disabled = false;
    }
  });
  picker.addEventListener('change', async () => {
    const previous = getLanguage();
    const roles = readRoles();
    setLanguage(picker.value);
    const language = getLanguage();
    ctx.settings = {...ctx.settings, roles, language};
    ctx.rerender();
    picker.disabled = true;
    try {
      ctx.settings = await ctx.store.updateSettings(current => ({...current, roles, language}));
    } catch {
      picker.value = previous;
      setLanguage(previous);
      ctx.settings = {...ctx.settings, language: previous};
      ctx.rerender();
      notice(t('saveFailed'));
    } finally {
      picker.disabled = false;
    }
  });
  submit.disabled = false;
}
