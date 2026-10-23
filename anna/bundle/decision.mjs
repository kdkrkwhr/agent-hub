import {normalizeLanguage} from './locales.mjs';

// A small, lossless display contract. Unrecognised model output stays visible
// as plain text; parsing never triggers another AI request.
export const PRIORITY_HEADINGS = {
  ko: ['먼저 만들기', '미루기', '판단 근거', '확인할 가정', '다음 행동'],
  en: ['Build first', 'Defer', 'Reasons', 'Assumptions to check', 'Next action'],
  'zh-CN': ['优先开发', '暂缓开发', '判断依据', '待验证的假设', '下一步行动'],
  ja: ['先に作るもの', '見送るもの', '判断の根拠', '確認する仮定', '次の行動'],
};

const GUIDE = {
  ko: {
    base: '당신은 개인 개발자의 다음 출시 범위를 검토합니다. 입력의 사용자, 목표, 기간, 개발 여력, 기능 후보를 기준으로 판단하세요. 기능 간 의존성과 최소 구현 범위를 고려하세요. 근거 없는 개발 기간, 사용자 수, 시장 조사 결과를 만들지 마세요. 정보가 부족하면 가정과 확인할 질문을 명시하고 조건부로 제안하세요. 역할들의 합의를 사실 검증으로 표현하지 마세요.',
    format: '아래 다섯 제목을 순서대로 정확히 사용하세요. 각 제목 아래 1~3개 짧은 항목을 씁니다. 먼저 만들기는 최대 2개 후보와 최소 범위, 미루기는 이유, 판단 근거에는 남은 반론과 선택의 대가를 포함하세요. 확인할 가정은 검증 방법, 다음 행동은 바로 할 수 있는 한 가지 행동으로 작성하세요. 이 형식 밖에 서문이나 결론을 덧붙이지 마세요.',
  },
  en: {
    base: 'Review the next release scope for a solo builder. Use the supplied audience, goal, time, capacity and feature candidates. Consider dependencies and the smallest useful scope. Do not invent effort estimates, user counts or market research. Label missing information as assumptions and questions, and make conditional recommendations. Agreement between roles is not fact checking.',
    format: 'Use exactly the following five headings in order, with 1–3 short items each. Build first: at most two candidates and minimum scope. Defer: why. Reasons: include dissent and tradeoffs. Assumptions: how to check them. Next action: one concrete immediate action. Do not add a preamble or closing outside these sections.',
  },
  'zh-CN': {
    base: '请评审独立开发者下一次发布的范围。以输入的用户、目标、时间、开发资源和候选功能为依据，考虑功能依赖与最小可用范围。不要编造工期、用户数或市场调查结果。信息不足时，明确列出假设和待确认的问题，并给出有条件的建议。不要把角色间的共识称为事实核实。',
    format: '请严格按顺序使用以下五个标题，每节写 1～3 个简短条目。优先开发：最多两个候选功能及最小范围。暂缓开发：说明原因。判断依据：包含尚存的反对意见与取舍。待验证的假设：说明验证方法。下一步行动：给出一项可以立即执行的具体行动。不要在这些章节之外添加开场或结尾。',
  },
  ja: {
    base: '個人開発者の次のリリース範囲を検討してください。入力された対象ユーザー、目標、期間、開発体制、機能の候補に基づき、依存関係と最小限の実装範囲を考えます。根拠のない工数、ユーザー数、市場調査結果を作らないでください。情報が足りなければ仮定と確認すべき質問を示し、条件付きで提案してください。役割間の合意を事実確認として扱わないでください。',
    format: '以下の五つの見出しを順番どおり正確に使い、各節に短い項目を 1～3 個書いてください。先に作るもの：候補を最大二つと最小範囲。見送るもの：理由。判断の根拠：残る反論と取捨選択。確認する仮定：検証方法。次の行動：すぐにできる具体的な行動を一つ。この形式の外に前置きや結びを追加しないでください。',
  },
};

export function priorityGuide(language, step) {
  const lang = normalizeLanguage(language);
  const {base, format: instructions} = GUIDE[lang];
  if (step !== 'final') return base;
  const format = PRIORITY_HEADINGS[lang].map(heading => `## ${heading}`).join('\n');
  return `${base}\n${instructions}\n${format}`;
}

export function decisionSections(text, language = 'ko') {
  const headings = PRIORITY_HEADINGS[normalizeLanguage(language)];
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
