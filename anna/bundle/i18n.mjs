export const TEXT = {
  ko: {
    language: '언어',
    settings: '역할과 모델',
    settingsHint: 'Anna 설정에서 켠 모델 안에서만 선택됩니다. 앱은 원하는 모델을 요청하고, 최종 선택은 Anna가 합니다. 답변마다 실제 사용된 모델이 표시됩니다.',
    temperament: '성향',
    family: '계열',
    model: '사용해 본 모델',
    noModel: '지정 안 함',
    noSeen: '아직 응답을 받은 모델이 없어요',
    fast: '빠름',
    balanced: '균형',
    deep: '깊은 분석',
    auto: '자동',
    claude: 'Claude 계열',
    gpt: 'GPT 계열',
    gemini: 'Gemini 계열',
    save: '저장',
    saved: '저장했어요',
    saveFailed: '저장하지 못했어요. 잠시 후 다시 시도해 주세요.',
    loadFailed: 'Anna에 연결하지 못했어요. 창을 다시 열어 주세요.',
    comingSoon: '토론·투표·문서 작업은 다음 업데이트에서 열려요.',
  },
  en: {
    language: 'Language',
    settings: 'Roles and models',
    settingsHint: 'Only models enabled in your Anna settings can be used. The app requests a model and Anna makes the final choice. Every reply shows the model actually used.',
    temperament: 'Temperament',
    family: 'Family',
    model: 'Models used before',
    noModel: 'No preference',
    noSeen: 'No model has replied yet',
    fast: 'Fast',
    balanced: 'Balanced',
    deep: 'Deep analysis',
    auto: 'Automatic',
    claude: 'Claude family',
    gpt: 'GPT family',
    gemini: 'Gemini family',
    save: 'Save',
    saved: 'Saved',
    saveFailed: 'Could not save. Please try again shortly.',
    loadFailed: 'Could not connect to Anna. Please reopen the window.',
    comingSoon: 'Discussions, votes and document work open in the next update.',
  },
};

let language = 'ko';

export function setLanguage(value) {
  language = value === 'en' ? 'en' : 'ko';
}

export const getLanguage = () => language;

export const t = key => TEXT[language][key] ?? TEXT.ko[key] ?? key;
