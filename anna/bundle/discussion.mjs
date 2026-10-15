import {ROLE_IDS, ROLES} from './roles.mjs';
import {blankTurn} from './runner.mjs';

const MAX_REQUEST = 4000;

const GUIDE = {
  ko: {
    base: '반드시 한국어로 답합니다. 결론을 먼저 말합니다. 다른 역할을 대신해 말하지 않습니다.',
    short: '2~3문장으로 짧게 씁니다.',
    long: '근거를 포함해 자세히 쓰되 10문장을 넘기지 않습니다.',
    opinion: '다른 참여자의 의견을 보지 않은 상태입니다. 요청에 대한 당신의 독립 의견을 제시하세요.',
    rebuttal: '모든 참여자의 1회차 의견을 읽고, 동의하지 않는 지점을 반박하거나 빠진 점을 보완하세요.',
    final: '토론 기록을 바탕으로 최종안을 작성하세요. 결론, 근거, 남은 쟁점 순서로 씁니다.',
    review: '최종안을 검토하세요. 동의 여부를 먼저 밝히고, 고칠 점이 있으면 가장 중요한 하나만 짚으세요.',
    request: '요청',
    opinions: '1회차 독립 의견',
    rebuttals: '2회차 반박·보완',
    finalDraft: '최종안',
  },
  en: {
    base: 'Answer in English. Lead with the conclusion. Do not speak for other roles.',
    short: 'Keep it to two or three sentences.',
    long: 'Give reasons in detail, in at most ten sentences.',
    opinion: 'You have not seen the other participants. Give your independent opinion on the request.',
    rebuttal: 'Read every first-round opinion, then rebut what you disagree with or fill in what is missing.',
    final: 'Write the final proposal from the discussion: conclusion, reasons, then open issues.',
    review: 'Review the final proposal. State first whether you agree, then name the single most important fix, if any.',
    request: 'Request',
    opinions: 'First-round independent opinions',
    rebuttals: 'Second-round rebuttals',
    finalDraft: 'Final proposal',
  },
};

export function finalAuthor(roles) {
  return roles.includes('editor') ? 'editor' : roles[roles.length - 1];
}

export function discussionSteps(roles) {
  const author = finalAuthor(roles);
  return [
    ...roles.map(role => ({step: 'opinion', role})),
    ...roles.map(role => ({step: 'rebuttal', role})),
    {step: 'final', role: author},
    ...roles.filter(role => role !== author).map(role => ({step: 'review', role})),
  ];
}

export function createDiscussion({id, request, roles, language = 'ko', detail = false, now = Date.now()}) {
  const text = String(request || '').trim().slice(0, MAX_REQUEST);
  const picked = ROLE_IDS.filter(role => (roles || []).includes(role));
  if (!text) throw new Error('Empty request');
  if (picked.length < 2) throw new Error('Need two roles');
  return {
    id,
    kind: 'discussion',
    title: text.split('\n')[0].slice(0, 80),
    request: text,
    roles: picked,
    language: language === 'en' ? 'en' : 'ko',
    detail: detail === true,
    status: 'ready',
    created: now,
    updated: now,
    archived: false,
    turns: discussionSteps(picked).map(({step, role}) => blankTurn(step, role)),
  };
}

export function discussionPrompt(thread, index) {
  const turn = thread.turns[index];
  const language = thread.language === 'en' ? 'en' : 'ko';
  const guide = GUIDE[language];
  const parts = [`${guide.request}:\n${thread.request}`];
  const section = (step, label) => {
    const lines = thread.turns
      .filter(other => other.step === step && other.status === 'done')
      .map(other => `- ${ROLES[other.role].name[language]}: ${other.text}`);
    if (lines.length) parts.push(`${label}:\n${lines.join('\n')}`);
  };
  if (turn.step === 'rebuttal' || turn.step === 'final') section('opinion', guide.opinions);
  if (turn.step === 'final') section('rebuttal', guide.rebuttals);
  if (turn.step === 'review') section('final', guide.finalDraft);
  const length = turn.step === 'final' || thread.detail ? guide.long : guide.short;
  return {
    system: [ROLES[turn.role].persona[language], guide.base, length, guide[turn.step]].join('\n'),
    messages: [{role: 'user', text: parts.join('\n\n')}],
    maxTokens: turn.step === 'final' ? 1200 : thread.detail ? 1000 : 600,
  };
}

export const canSkip = turn => turn.step !== 'final';

export const discussionPlan = {prompt: discussionPrompt};
