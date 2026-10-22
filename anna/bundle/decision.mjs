// A small, lossless display contract. Unrecognised model output stays visible
// as plain text; parsing never triggers another AI request.
export const PRIORITY_HEADINGS = {
  ko: ['먼저 만들기', '미루기', '판단 근거', '확인할 가정', '다음 행동'],
  en: ['Build first', 'Defer', 'Reasons', 'Assumptions to check', 'Next action'],
};

export function priorityGuide(language, step) {
  const lang = language === 'en' ? 'en' : 'ko';
  const base = lang === 'ko'
    ? '당신은 개인 개발자의 다음 출시 범위를 검토합니다. 입력의 사용자, 목표, 기간, 개발 여력, 기능 후보를 기준으로 판단하세요. 기능 간 의존성과 최소 구현 범위를 고려하세요. 근거 없는 개발 기간, 사용자 수, 시장 조사 결과를 만들지 마세요. 정보가 부족하면 가정과 확인할 질문을 명시하고 조건부로 제안하세요. 역할들의 합의를 사실 검증으로 표현하지 마세요.'
    : 'Review the next release scope for a solo builder. Use the supplied audience, goal, time, capacity and feature candidates. Consider dependencies and the smallest useful scope. Do not invent effort estimates, user counts or market research. Label missing information as assumptions and questions, and make conditional recommendations. Agreement between roles is not fact checking.';
  if (step !== 'final') return base;
  const format = PRIORITY_HEADINGS[lang].map(heading => `## ${heading}`).join('\n');
  return `${base}\n${lang === 'ko'
    ? '아래 다섯 제목을 순서대로 정확히 사용하세요. 각 제목 아래 1~3개 짧은 항목을 씁니다. 먼저 만들기는 최대 2개 후보와 최소 범위, 미루기는 이유, 판단 근거에는 남은 반론과 선택의 대가를 포함하세요. 확인할 가정은 검증 방법, 다음 행동은 바로 할 수 있는 한 가지 행동으로 작성하세요. 이 형식 밖에 서문이나 결론을 덧붙이지 마세요.'
    : 'Use exactly the following five headings in order, with 1–3 short items each. Build first: at most two candidates and minimum scope. Defer: why. Reasons: include dissent and tradeoffs. Assumptions: how to check them. Next action: one concrete immediate action. Do not add a preamble or closing outside these sections.'}\n${format}`;
}

export function decisionSections(text, language = 'ko') {
  const headings = PRIORITY_HEADINGS[language === 'en' ? 'en' : 'ko'];
  const sections = [];
  for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)?.[1];
    if (heading && headings.includes(heading)) {
      if (heading !== headings[sections.length]) return null;
      sections.push({title: heading, text: ''});
    } else if (sections.length) {
      sections.at(-1).text += `${line}\n`;
    } else if (line.trim()) return null;
  }
  if (sections.length !== headings.length || sections.some(section => !section.text.trim())) return null;
  return sections.map(section => ({...section, text: section.text.trim()}));
}
