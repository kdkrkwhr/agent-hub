import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';
import {createStore} from './store.mjs';
import {ROLE_IDS, ROLES, TEMPERAMENTS, FAMILIES} from './roles.mjs';
import {t, setLanguage, getLanguage} from './i18n.mjs';

const $ = selector => document.querySelector(selector);
let store;
let settings;

function notice(text) {
  const element = $('#notice');
  element.textContent = text;
  element.hidden = !text;
}

function option(value, label, selected) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  return element;
}

function field(label, select) {
  const wrapper = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(caption, select);
  return wrapper;
}

function select(name, entries) {
  const element = document.createElement('select');
  element.name = name;
  element.append(...entries);
  return element;
}

function renderText() {
  document.documentElement.lang = getLanguage();
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
}

function renderRoles() {
  const language = getLanguage();
  const cards = ROLE_IDS.map(id => {
    const role = settings.roles[id];
    const models = role.model && !settings.seenModels.includes(role.model) ? [role.model, ...settings.seenModels] : settings.seenModels;
    const card = document.createElement('fieldset');
    card.className = `role role-${id}`;
    card.dataset.role = id;
    const legend = document.createElement('legend');
    legend.textContent = ROLES[id].name[language];
    const persona = document.createElement('p');
    persona.textContent = ROLES[id].persona[language];
    const model = select(`${id}-model`, [
      option('', models.length ? t('noModel') : t('noSeen'), !role.model),
      ...models.map(name => option(name, name, role.model === name)),
    ]);
    model.disabled = !models.length;
    card.append(
      legend,
      persona,
      field(t('temperament'), select(`${id}-temperament`, Object.keys(TEMPERAMENTS).map(key => option(key, t(key), role.temperament === key)))),
      field(t('family'), select(`${id}-family`, FAMILIES.map(key => option(key, t(key), role.family === key)))),
      field(t('model'), model),
    );
    return card;
  });
  $('#roles').replaceChildren(...cards);
}

function render() {
  renderText();
  renderRoles();
}

function readForm() {
  const data = new FormData($('#settings-form'));
  return {
    ...settings,
    roles: Object.fromEntries(ROLE_IDS.map(id => [id, {
      temperament: data.get(`${id}-temperament`),
      family: data.get(`${id}-family`),
      model: data.get(`${id}-model`) || '',
    }])),
  };
}

async function save(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    settings = await store.saveSettings(readForm());
    render();
    notice(t('saved'));
  } catch {
    notice(t('saveFailed'));
  } finally {
    button.disabled = false;
  }
}

async function changeLanguage() {
  setLanguage($('#language').value);
  settings = {...readForm(), language: getLanguage()};
  render();
  try {
    settings = await store.saveSettings(settings);
  } catch {
    notice(t('saveFailed'));
  }
}

async function main() {
  renderText();
  try {
    const anna = await AnnaAppRuntime.connect();
    store = createStore(anna.storage);
    settings = await store.loadSettings();
    setLanguage(settings.language);
    $('#language').value = settings.language;
    render();
    $('#settings-form').addEventListener('submit', save);
    $('#language').addEventListener('change', changeLanguage);
    anna.window.set_title({title: 'Agent Hub Radio'}).catch(() => {});
    document.body.dataset.ready = 'true';
  } catch {
    notice(t('loadFailed'));
  }
}

main();
