import {ROLE_IDS, ROLES} from './roles.mjs';
import {blankTurn, settled} from './runner.mjs';

const MAX_PASSAGE = 4000;
const MAX_OPTION = 300;
const MAX_OPTIONS = 6;

const GUIDE = {
  ko: {
    task: '다른 참여자의 표를 보지 않고 독립적으로 판단합니다. 지문을 읽고 선택지 하나를 고르거나, 판단할 정보가 부족하면 ABSTAIN을 고르세요.',
    format: 'JSON 하나만 답합니다: {"choice":"A","reason":"결정적 근거 한 문장","concern":"가장 중요한 불확실성 한 문장 또는 없음"}. 설명이나 코드 블록을 붙이지 않습니다. 한국어로 씁니다.',
    passage: '지문',
    options: '선택지',
  },
  en: {
    task: 'Judge independently without seeing other ballots. Read the passage and pick one option, or ABSTAIN if information is missing.',
    format: 'Reply with one JSON object only: {"choice":"A","reason":"one decisive reason","concern":"one key uncertainty or none"}. No commentary or code fences. Write in English.',
    passage: 'Passage',
    options: 'Options',
  },
};

export function createVote({id, passage, options, roles, language = 'ko', now = Date.now()}) {
  const text = String(passage || '').trim().slice(0, MAX_PASSAGE);
  const choices = (options || []).map(option => String(option || '').trim().slice(0, MAX_OPTION)).filter(Boolean).slice(0, MAX_OPTIONS);
  const picked = ROLE_IDS.filter(role => (roles || []).includes(role));
  if (!text) throw new Error('Empty passage');
  if (choices.length < 2) throw new Error('Need two options');
  if (!picked.length) throw new Error('Need a voter');
  return {
    id,
    kind: 'vote',
    title: text.split('\n')[0].slice(0, 80),
    passage: text,
    options: choices.map((choice, index) => ({id: String.fromCharCode(65 + index), text: choice})),
    roles: picked,
    language: language === 'en' ? 'en' : 'ko',
    detail: false,
    status: 'ready',
    created: now,
    updated: now,
    archived: false,
    turns: picked.map(role => blankTurn('ballot', role)),
  };
}

export function votePrompt(thread, index) {
  const turn = thread.turns[index];
  const language = thread.language === 'en' ? 'en' : 'ko';
  const guide = GUIDE[language];
  const options = thread.options.map(option => `${option.id}. ${option.text}`).join('\n');
  return {
    system: [ROLES[turn.role].persona[language], guide.task, guide.format].join('\n'),
    messages: [{role: 'user', text: `${guide.passage}:\n${thread.passage}\n\n${guide.options}:\n${options}`}],
    maxTokens: 400,
  };
}

export function parseBallot(text, options) {
  const match = /\{[\s\S]*\}/.exec(String(text || ''));
  if (!match) return null;
  let value;
  try {
    value = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const choice = String(value?.choice || '').trim().toUpperCase();
  if (![...options.map(option => option.id), 'ABSTAIN'].includes(choice)) return null;
  return {choice, reason: String(value.reason || '').trim().slice(0, 600), concern: String(value.concern || '').trim().slice(0, 300)};
}

export function tally(thread) {
  if (!thread.turns.every(settled)) return null;
  const counts = Object.fromEntries([...thread.options.map(option => option.id), 'ABSTAIN'].map(id => [id, 0]));
  const ballots = [];
  for (const turn of thread.turns) {
    const ballot = turn.status === 'done' ? parseBallot(turn.text, thread.options) : null;
    if (!ballot) continue;
    counts[ballot.choice] += 1;
    ballots.push({role: turn.role, model: turn.model, ...ballot});
  }
  return {counts, ballots};
}

export const votePlan = {
  prompt: votePrompt,
  accept: (thread, index) => parseBallot(thread.turns[index].text, thread.options) ? '' : 'format',
};
