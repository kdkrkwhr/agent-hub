import {$, node, notice} from './view.mjs';
import {FAMILIES, ROLE_IDS, ROLES, TEMPERAMENTS} from './roles.mjs';
import {getLanguage, setLanguage, t} from './i18n.mjs';
import {StorageError, storageErrorKind} from './store.mjs';

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
  let baseline = structuredClone(ctx.settings.roles);
  const changedRoles = roles => {
    const before = baseline;
    return current => {
      const merged = structuredClone(current.roles);
      for (const id of ROLE_IDS) for (const key of Object.keys(roles[id])) {
        if (roles[id][key] === before[id][key]) continue;
        if (current.roles[id][key] !== before[id][key] && current.roles[id][key] !== roles[id][key]) throw new StorageError('conflict');
        merged[id][key] = roles[id][key];
      }
      return {...current, roles: merged};
    };
  };
  const dialog = $('#settings-dialog');
  for (const opener of [$('#open-settings'), $('#settings-button')]) {
    opener.addEventListener('click', async () => {
      document.body.classList.remove('drawer-open');
      notice('');
      try { ctx.settings = await ctx.store.loadSettings(); }
      catch { notice(t('openFailed')); return; }
      renderSettings(ctx);
      baseline = structuredClone(ctx.settings.roles);
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
      ctx.settings = await ctx.store.updateSettings(changedRoles(roles));
      baseline = structuredClone(ctx.settings.roles);
      renderSettings(ctx);
      notice(t('saved'));
    } catch (error) {
      notice(t(`storage-${storageErrorKind(error)}`));
    } finally {
      submit.disabled = false;
    }
  });
  picker.addEventListener('change', async () => {
    const previous = getLanguage();
    const roles = readRoles();
    const change = changedRoles(roles);
    setLanguage(picker.value);
    const language = getLanguage();
    ctx.settings = {...ctx.settings, roles, language};
    ctx.rerender();
    picker.disabled = true;
    try {
      ctx.settings = await ctx.store.updateSettings(current => ({...change(current), language}));
      baseline = structuredClone(ctx.settings.roles);
    } catch (error) {
      picker.value = previous;
      setLanguage(previous);
      ctx.settings = {...ctx.settings, language: previous};
      ctx.rerender();
      notice(t(`storage-${storageErrorKind(error)}`));
    } finally {
      picker.disabled = false;
    }
  });
  submit.disabled = false;
}
