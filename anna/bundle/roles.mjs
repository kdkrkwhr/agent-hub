import {DEFAULT_LANGUAGE, normalizeLanguage} from './locales.mjs';

export const ROLE_IDS = ['analyst', 'critic', 'editor'];

export const ROLES = {
  analyst: {
    name: {ko: '분석가', en: 'Analyst', 'zh-CN': '分析师', ja: '分析役'},
    persona: {
      ko: '당신은 분석가입니다. 사실, 가정, 판단 기준을 구분해 근거와 구조를 짚습니다.',
      en: 'You are the analyst. Separate facts, assumptions and criteria, and lay out the reasoning.',
      'zh-CN': '你是分析师。区分事实、假设和判断标准，梳理依据与逻辑结构。',
      ja: 'あなたは分析役です。事実、仮定、判断基準を区別し、根拠と構造を整理します。',
    },
  },
  critic: {
    name: {ko: '비판자', en: 'Critic', 'zh-CN': '评议者', ja: '批評役'},
    persona: {
      ko: '당신은 비판자입니다. 가장 약한 가정과 위험, 반례를 먼저 지적하고 대안을 제시합니다.',
      en: 'You are the critic. Point out the weakest assumption, risks and counterexamples first, then offer an alternative.',
      'zh-CN': '你是评议者。先指出最薄弱的假设、风险和反例，再提出替代方案。',
      ja: 'あなたは批評役です。最も弱い仮定、リスク、反例を先に指摘し、代案を提示します。',
    },
  },
  editor: {
    name: {ko: '정리자', en: 'Editor', 'zh-CN': '整理者', ja: 'まとめ役'},
    persona: {
      ko: '당신은 정리자입니다. 결론, 근거, 남은 쟁점 순서로 합의안과 문서를 짧게 다듬습니다.',
      en: 'You are the editor. Shape agreements and documents as conclusion, reasons and open issues.',
      'zh-CN': '你是整理者。按结论、依据、待解决问题的顺序，简洁地整理共识与文档。',
      ja: 'あなたはまとめ役です。結論、根拠、残る論点の順に、合意案や文書を簡潔に整理します。',
    },
  },
};

export const TEMPERAMENTS = {
  fast: {speedPriority: 0.9, intelligencePriority: 0.3, costPriority: 0.7},
  balanced: {speedPriority: 0.5, intelligencePriority: 0.6, costPriority: 0.5},
  deep: {speedPriority: 0.2, intelligencePriority: 0.95, costPriority: 0.2},
};

export const FAMILIES = ['auto', 'claude', 'gpt', 'gemini'];

const MAX_SEEN = 20;
const MAX_MODEL = 120;
const cleanModel = value => typeof value === 'string' ? value.trim().slice(0, MAX_MODEL) : '';

export function defaultSettings() {
  return {
    version: 1,
    language: DEFAULT_LANGUAGE,
    detail: false,
    roles: Object.fromEntries(ROLE_IDS.map(id => [id, {temperament: 'balanced', family: 'auto', model: ''}])),
    seenModels: [],
  };
}

export function normalizeSettings(raw) {
  if (!raw || typeof raw !== 'object') return defaultSettings();
  const seen = Array.isArray(raw.seenModels) ? raw.seenModels : [];
  const roles = Object.fromEntries(ROLE_IDS.map(id => {
    const role = raw.roles?.[id] || {};
    return [id, {
      temperament: Object.hasOwn(TEMPERAMENTS, role.temperament) ? role.temperament : 'balanced',
      family: FAMILIES.includes(role.family) ? role.family : 'auto',
      model: cleanModel(role.model),
    }];
  }));
  return {
    version: 1,
    language: normalizeLanguage(raw.language),
    detail: raw.detail === true,
    roles,
    seenModels: [...new Set(seen.map(cleanModel).filter(Boolean))].slice(0, MAX_SEEN),
  };
}

export function modelPreferences(role) {
  const preferences = {...(TEMPERAMENTS[role.temperament] || TEMPERAMENTS.balanced)};
  const hints = [];
  if (role.model) hints.push({name: role.model});
  if (role.family && role.family !== 'auto') hints.push({name: role.family});
  if (hints.length) preferences.hints = hints;
  return preferences;
}

export function requestedLabel(role) {
  return role.model || (role.family && role.family !== 'auto' ? role.family : '');
}

export function recordModel(settings, model) {
  const name = cleanModel(model);
  if (!name) return settings;
  return {...settings, seenModels: [name, ...settings.seenModels.filter(m => m !== name)].slice(0, MAX_SEEN)};
}

export function modelMismatch(turn) {
  const requested = String(turn?.requested || '').toLowerCase();
  const model = String(turn?.model || '').toLowerCase();
  return Boolean(requested && model && !model.includes(requested));
}
