import {t, getLanguage} from './i18n.mjs';

export const $ = selector => document.querySelector(selector);

export function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function button(label, onClick, className = '') {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

export function notice(text) {
  $('#notice').textContent = text;
}

export const later = promise => promise.catch(() => notice(t('loadFailed')));

export function renderText() {
  document.documentElement.lang = getLanguage();
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
}
