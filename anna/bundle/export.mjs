import {ROLES, modelMismatch} from './roles.mjs';
import {tr} from './i18n.mjs';
import {parseBallot, tally} from './voting.mjs';

const line = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const code = text => `\`${line(String(text ?? '').replaceAll('`', ''))}\``;

function modelNote(turn, lang) {
  const parts = [`${tr(lang, 'actualModel')}: ${turn.model ? code(turn.model) : tr(lang, 'unknownModel')}`];
  if (turn.requested) parts.push(`${tr(lang, 'requestedModel')}: ${code(turn.requested)}${modelMismatch(turn) ? ` (${tr(lang, 'mismatch')})` : ''}`);
  return parts.join(' · ');
}

function turnBlock(turn, lang) {
  const out = [`### ${ROLES[turn.role].name[lang]} · ${tr(lang, `status-${turn.status}`)}`, '', modelNote(turn, lang), ''];
  if (turn.error) out.push(`_${tr(lang, `error-${turn.error}`)}_`, '');
  if (turn.text) out.push(turn.text.trim(), '');
  return out;
}

function voteBody(thread, lang, out) {
  const result = tally(thread);
  out.push(`## ${tr(lang, 'passage')}`, '', thread.passage.trim(), '', `## ${tr(lang, 'optionsTitle')}`, '');
  for (const option of thread.options) out.push(`- ${option.id}. ${line(option.text)}${result ? ` — ${tr(lang, 'votes', {n: result.counts[option.id]})}` : ''}`);
  if (result) out.push(`- ${tr(lang, 'abstain')} — ${tr(lang, 'votes', {n: result.counts.ABSTAIN})}`);
  out.push('', `## ${tr(lang, 'step-ballot')}`, '');
  if (!result) {
    out.push(`_${tr(lang, 'voteHidden')}_`, '');
    return;
  }
  for (const turn of thread.turns) {
    const ballot = turn.status === 'done' ? parseBallot(turn.text, thread.options) : null;
    const name = ROLES[turn.role].name[lang];
    if (!ballot) {
      out.push(`### ${name} · ${tr(lang, `status-${turn.status}`)}`, '');
      continue;
    }
    out.push(
      `### ${name} · ${ballot.choice === 'ABSTAIN' ? tr(lang, 'abstain') : ballot.choice}`, '',
      modelNote(turn, lang), '',
      `- ${tr(lang, 'reason')}: ${line(ballot.reason)}`,
      `- ${tr(lang, 'concern')}: ${line(ballot.concern)}`, '',
    );
  }
}

export function toMarkdown(thread, lang = thread.language === 'en' ? 'en' : 'ko') {
  const out = [
    `# ${line(thread.title)}`, '',
    `- ${tr(lang, 'kind')}: ${tr(lang, `kind-${thread.kind}`)}`,
    `- ${tr(lang, 'status')}: ${tr(lang, `status-${thread.status}`)}`,
    `- ${tr(lang, 'updated')}: ${new Date(Number(thread.updated) || 0).toISOString()}`, '',
  ];
  if (thread.kind === 'vote') {
    voteBody(thread, lang, out);
    return out.join('\n');
  }
  out.push(`## ${tr(lang, 'request')}`, '', thread.request.trim(), '');
  for (const step of ['opinion', 'rebuttal', 'final', 'review']) {
    const turns = thread.turns.filter(turn => turn.step === step && turn.status !== 'pending');
    if (!turns.length) continue;
    out.push(`## ${tr(lang, `step-${step}`)}`, '');
    for (const turn of turns) out.push(...turnBlock(turn, lang));
  }
  return out.join('\n');
}

export const exportName = thread => `agent-hub-${thread.kind}-${thread.id}.md`;
