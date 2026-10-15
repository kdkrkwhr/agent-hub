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
  for (const element of document.querySelectorAll('[data-notice]')) element.textContent = text;
}

export const later = promise => promise.catch(() => notice(t('loadFailed')));

export function renderText() {
  document.documentElement.lang = getLanguage();
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
  for (const element of document.querySelectorAll('[data-tp]')) element.placeholder = t(element.dataset.tp);
  for (const element of document.querySelectorAll('[data-ta]')) element.setAttribute('aria-label', t(element.dataset.ta));
}

export const when = value => new Date(Number(value) || 0).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'ko-KR', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});

export function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], {type: 'text/markdown'}));
  const link = node('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text) {
  const area = $('#export-text');
  try {
    await navigator.clipboard.writeText(text);
    area.hidden = true;
    notice(t('copied'));
  } catch {
    area.value = text;
    area.hidden = false;
    area.select();
    notice(t('copyFailed'));
  }
}

export function confirmButton(label, armedLabel, action, className) {
  let armed = false;
  let timer;
  const reset = () => {
    armed = false;
    element.textContent = label;
    element.classList.remove('armed');
  };
  const element = button(label, async () => {
    if (!armed) {
      armed = true;
      element.textContent = armedLabel;
      element.classList.add('armed');
      timer = setTimeout(reset, 4000);
      return;
    }
    clearTimeout(timer);
    element.disabled = true;
    try {
      await action();
    } finally {
      element.disabled = false;
      reset();
    }
  }, className);
  return element;
}
