export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGES = {
  en: {label: 'English', locale: 'en-US'},
  ko: {label: '한국어', locale: 'ko-KR'},
  'zh-CN': {label: '简体中文', locale: 'zh-CN'},
  ja: {label: '日本語', locale: 'ja-JP'},
};

export const normalizeLanguage = value => Object.hasOwn(LANGUAGES, value) ? value : DEFAULT_LANGUAGE;
