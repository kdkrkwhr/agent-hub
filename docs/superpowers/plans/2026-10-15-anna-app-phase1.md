# Anna 앱 1단계 구현 계획 · 뼈대와 모델 선택

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `agent-hub/anna/`에 Anna 웹 앱 뼈대를 만들고, 역할별 모델 설정(성향·계열·사용해 본 모델)을 저장·표시하며, 이후 단계가 쓸 AI·저장 모듈을 테스트와 함께 완성한다.

**Architecture:** 실행 도구 없는 정적 SPA. 화면은 Anna Host API(`llm.stream`/`llm.complete`, `storage.*`, `window.set_title`)만 쓴다. 진행 로직이 쓸 `roles.mjs`·`ai.mjs`·`store.mjs`는 DOM을 모르는 순수 모듈로 만들어 `node --test`로 검증하고, 화면은 Playwright와 가짜 SDK로 검증한다.

**Tech Stack:** 브라우저 ES 모듈, `@anna-ai/cli` 0.1.57, `playwright-core` 1.64.0, Node 22 `node:test`, GitHub Actions.

**설계 문서:** `docs/superpowers/specs/2026-10-15-anna-app-design.md`

## Global Constraints

- 브랜치: `release-anna`. `main`에는 커밋하지 않는다.
- 앱 slug `agent-hub-radio`, 버전 `0.4.0`.
- Anna AI 실제 호출 금지. 모든 테스트는 가짜 AI·가짜 저장소를 쓴다.
- Anna 번들 CSP: 인라인 `<script>`·인라인 이벤트 처리기·HTML `style=""` 속성 금지. SDK는 `/static/anna-apps/_sdk/latest/index.js`에서 import한다.
- `manifest.ui.host_api`: `llm: ["complete","stream"]`, `storage: ["get","set","list","delete"]`, `window: ["set_title"]`.
- 저장 키: `settings`, `threads`, `thread/<id>`.
- 모델 힌트 형식: `modelPreferences.hints = [{name}]`. 사용해 본 모델명을 먼저, 계열(`claude`/`gpt`/`gemini`)을 다음에 둔다. 자동이면 `hints` 생략.
- 사용해 본 모델 목록은 최대 20개, 모델명은 120자 이하.
- UI 문구는 한국어·영어 모두 제공하며 기본은 한국어.
- 기존 Python 허브·CLI·데스크톱 동작은 바꾸지 않는다(Task 6의 출력 인코딩 수정 제외).
- 노트버디 저장소와 Anna 노트버디 앱은 건드리지 않는다.

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `anna/package.json`, `anna/package-lock.json` | 도구 버전 고정, 스크립트 |
| `anna/app.json` | 스토어 정보 |
| `anna/manifest.json` | 권한, 화면, CSP |
| `anna/bundle/index.html` | 정적 마크업 |
| `anna/bundle/style.css` | 화면 스타일 |
| `anna/bundle/app.js` | SDK 연결, 설정 화면 렌더링·저장 |
| `anna/bundle/i18n.mjs` | 한국어·영어 문구 |
| `anna/bundle/roles.mjs` | 역할 정의, 설정 정규화, 모델 요청 조립, 실제 모델 기록 |
| `anna/bundle/ai.mjs` | Anna AI 호출 단일 창구(스트림·대체 경로·중단·오류 분류) |
| `anna/bundle/store.mjs` | 설정·기록·색인 저장과 색인 복구 |
| `anna/tests/*.test.mjs` | 순수 모듈 단위 테스트 |
| `anna/tests/browser/mock-sdk.mjs` | 브라우저 테스트용 가짜 SDK |
| `anna/tests/browser/settings.browser.mjs` | 설정 화면 브라우저 테스트 |
| `.github/workflows/anna.yml` | Anna 앱 CI |
| `src/agent_hub/__main__.py` | 출력 인코딩 오류 방지(CI 실패 수정) |
| `tests/test_cli_encoding.py` | 위 수정의 회귀 테스트 |

---

### Task 1: 앱 뼈대와 권한 검증

**Files:**
- Create: `anna/package.json`, `anna/app.json`, `anna/manifest.json`, `anna/bundle/index.html`, `anna/bundle/style.css`, `anna/bundle/app.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `npm run validate|test|test:browser|dev` 스크립트, `#roles`·`#settings-form`·`#language`·`#notice` DOM id(Task 5에서 사용)

- [ ] **Step 1: `.gitignore`에 추가**

```gitignore
anna/node_modules/
```

- [ ] **Step 2: `anna/package.json` 작성**

```json
{
  "name": "agent-hub-radio-anna",
  "version": "0.4.0",
  "private": true,
  "description": "Agent Hub Radio on Anna: AI roles that debate, vote and draft together.",
  "scripts": {
    "dev": "anna-app dev --port 5181 --no-llm",
    "validate": "anna-app validate --strict",
    "test": "node --test tests/*.test.mjs",
    "test:browser": "node --test tests/browser/*.browser.mjs"
  },
  "devDependencies": {
    "@anna-ai/cli": "0.1.57",
    "playwright-core": "1.64.0"
  }
}
```

- [ ] **Step 3: `anna/app.json` 작성**

```json
{
  "slug": "agent-hub-radio",
  "name": "Agent Hub Radio",
  "version": "0.4.0",
  "tagline": "Analyst, critic and editor roles debate, vote and draft with your Anna AI.",
  "description": "Agent Hub Radio turns your Anna AI into a small team. An analyst, a critic and an editor give independent opinions, debate the open points, vote without seeing each other's choices and draft documents step by step. Pick a temperament and preferred model family for each role; every reply shows the model Anna actually used. Uses your own Anna AI allowance. Model choice follows the models enabled in your Anna settings.",
  "category": "productivity",
  "homepage_url": "https://github.com/kdkrkwhr/agent-hub",
  "support_url": "https://github.com/kdkrkwhr/agent-hub/issues"
}
```

- [ ] **Step 4: `anna/manifest.json` 작성** (임시 폴더에서 `validate --strict` 통과를 확인한 구성)

```json
{
  "schema": 3,
  "host_capabilities": ["llm.complete"],
  "required_executas": [],
  "optional_executas": [],
  "system_prompt_addendum": "Agent Hub Radio runs role-play discussions, votes and document drafts in its own window. It never edits files or runs code. Each role reply shows the model Anna actually used.",
  "tags": ["agents", "debate", "voting", "productivity", "korean"],
  "ui": {
    "bundle": {"format": "static-spa", "entry": "index.html", "external_origins": []},
    "views": [
      {
        "name": "main",
        "title": "Agent Hub Radio",
        "default": true,
        "entry": "index.html",
        "min_size": {"w": 360, "h": 540},
        "default_size": {"w": 1180, "h": 820},
        "max_size": {"w": 1800, "h": 1400},
        "resizable": true,
        "movable": true,
        "single_instance": true
      }
    ],
    "host_api": {
      "llm": ["complete", "stream"],
      "storage": ["get", "set", "list", "delete"],
      "window": ["set_title"]
    },
    "csp_overrides": {
      "style-src": ["'self'"],
      "script-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'"]
    },
    "state_merge": "last_writer_wins"
  },
  "dev": {"user_id": 1, "seed_storage": {}}
}
```

- [ ] **Step 5: `anna/bundle/index.html` 작성**

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent Hub Radio</title>
<link rel="stylesheet" href="style.css">
<script src="app.js" type="module"></script>
</head>
<body>
<header class="bar">
  <h1>Agent Hub Radio</h1>
  <label class="language"><span data-t="language">언어</span>
    <select id="language"><option value="ko">한국어</option><option value="en">English</option></select>
  </label>
</header>
<main>
  <section class="panel" aria-labelledby="settings-title">
    <h2 id="settings-title" data-t="settings">역할과 모델</h2>
    <p class="hint" data-t="settingsHint"></p>
    <form id="settings-form">
      <div id="roles" class="roles"></div>
      <button type="submit" data-t="save">저장</button>
    </form>
  </section>
  <p class="soon" data-t="comingSoon"></p>
</main>
<p id="notice" role="status" hidden></p>
</body>
</html>
```

- [ ] **Step 6: `anna/bundle/style.css` 작성**

```css
:root{--paper:#f7f1e3;--ink:#2b2621;--frame:#6b5a45;--muted:#7a6d5c;--analyst:#2f6f8f;--critic:#a5483a;--editor:#5d7a3a;font-family:system-ui,"Malgun Gothic",sans-serif;color:var(--ink);background:var(--paper)}
*{box-sizing:border-box}
body{margin:0;min-height:100vh}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:3px solid var(--frame);background:#efe4cc}
.bar h1{margin:0;font-size:1.25rem}
.language{display:flex;align-items:center;gap:8px}
main{max-width:1100px;margin:0 auto;padding:20px}
.panel{border:3px solid var(--frame);border-radius:10px;padding:16px 20px;background:#fffaf0}
.panel h2{margin:0 0 6px}
.hint,.soon{color:var(--muted);margin:0 0 14px}
.roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:14px}
.role{margin:0;border:2px solid var(--frame);border-left-width:8px;border-radius:8px;padding:10px 14px;display:grid;gap:8px;min-width:0}
.role-analyst{border-left-color:var(--analyst)}
.role-critic{border-left-color:var(--critic)}
.role-editor{border-left-color:var(--editor)}
.role legend{font-weight:700;padding:0 4px}
.role p{margin:0;color:var(--muted);font-size:.92rem}
.role label{display:grid;gap:4px;font-size:.9rem}
select,button{font:inherit;min-height:36px;max-width:100%}
select{width:100%;border:2px solid var(--frame);border-radius:6px;background:#fff;padding:4px 8px}
button{border:2px solid var(--frame);border-radius:6px;background:#e7d6b0;padding:4px 18px;cursor:pointer}
button:disabled{opacity:.6;cursor:progress}
#notice{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);margin:0;padding:8px 16px;border:2px solid var(--frame);border-radius:8px;background:#fffaf0}
@media (max-width:480px){.bar{padding:10px 12px}main{padding:12px}.panel{padding:12px}}
```

- [ ] **Step 7: 임시 `anna/bundle/app.js` 작성** (Task 5에서 교체. 권한 검증용으로 실제 쓸 Host API를 호출한다)

```js
import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';

const anna = await AnnaAppRuntime.connect();
await anna.window.set_title({title: 'Agent Hub Radio'});
await anna.storage.get({key: 'settings'});
document.body.dataset.ready = 'true';
```

- [ ] **Step 8: 의존성 설치와 검증**

Run: `cd anna; npm install; npm run validate`
Expected: `validate passed`. `anna/package-lock.json`이 생성된다.

- [ ] **Step 9: Commit**

```bash
git add .gitignore anna/package.json anna/package-lock.json anna/app.json anna/manifest.json anna/bundle
git commit -m "feat(anna): scaffold Agent Hub Radio Anna app"
```

---

### Task 2: 역할과 모델 설정 (`roles.mjs`)

**Files:**
- Create: `anna/bundle/roles.mjs`
- Test: `anna/tests/roles.test.mjs`

**Interfaces:**
- Produces:
  - `ROLE_IDS: ['analyst','critic','editor']`
  - `ROLES[id] = {name:{ko,en}, persona:{ko,en}}`
  - `TEMPERAMENTS = {fast|balanced|deep: {speedPriority, intelligencePriority, costPriority}}`
  - `FAMILIES = ['auto','claude','gpt','gemini']`
  - `defaultSettings() -> Settings`
  - `normalizeSettings(raw) -> Settings`
  - `modelPreferences(roleSetting) -> {speedPriority, intelligencePriority, costPriority, hints?: [{name}]}`
  - `requestedLabel(roleSetting) -> string` (요청한 모델명 또는 계열, 없으면 `''`)
  - `recordModel(settings, model) -> Settings` (새 객체)
  - `Settings = {version:1, language:'ko'|'en', detail:boolean, roles:{[id]:{temperament, family, model}}, seenModels:string[]}`

- [ ] **Step 1: 실패하는 테스트 작성** `anna/tests/roles.test.mjs`

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ROLE_IDS, ROLES, defaultSettings, normalizeSettings, modelPreferences, requestedLabel, recordModel} from '../bundle/roles.mjs';

test('three bilingual roles with balanced automatic defaults', () => {
  assert.deepEqual(ROLE_IDS, ['analyst', 'critic', 'editor']);
  for (const id of ROLE_IDS) {
    assert.ok(ROLES[id].name.ko && ROLES[id].name.en && ROLES[id].persona.ko && ROLES[id].persona.en);
    assert.deepEqual(defaultSettings().roles[id], {temperament: 'balanced', family: 'auto', model: ''});
  }
  assert.equal(defaultSettings().language, 'ko');
  assert.deepEqual(defaultSettings().seenModels, []);
});

test('normalization repairs unknown values and bounds model names', () => {
  const s = normalizeSettings({language: 'fr', detail: 'yes', roles: {critic: {temperament: 'reckless', family: 'llama', model: ` ${'m'.repeat(200)} `}},
    seenModels: ['a', 'a', '', 7, ...Array.from({length: 30}, (_, i) => `model-${i}`)]});
  assert.equal(s.language, 'ko');
  assert.equal(s.detail, false);
  assert.deepEqual(s.roles.critic, {temperament: 'balanced', family: 'auto', model: 'm'.repeat(120)});
  assert.deepEqual(s.roles.analyst, {temperament: 'balanced', family: 'auto', model: ''});
  assert.equal(s.seenModels.length, 20);
  assert.equal(s.seenModels[0], 'a');
  assert.deepEqual(normalizeSettings(null), defaultSettings());
});

test('model preferences put the chosen model before the family', () => {
  assert.deepEqual(modelPreferences({temperament: 'deep', family: 'auto', model: ''}), {speedPriority: 0.2, intelligencePriority: 0.95, costPriority: 0.2});
  assert.deepEqual(modelPreferences({temperament: 'fast', family: 'claude', model: 'anthropic/claude-sonnet'}).hints,
    [{name: 'anthropic/claude-sonnet'}, {name: 'claude'}]);
  assert.deepEqual(modelPreferences({temperament: 'balanced', family: 'gpt', model: ''}).hints, [{name: 'gpt'}]);
  assert.equal(requestedLabel({family: 'gemini', model: ''}), 'gemini');
  assert.equal(requestedLabel({family: 'gemini', model: 'google/gemini-3-flash-preview'}), 'google/gemini-3-flash-preview');
  assert.equal(requestedLabel({family: 'auto', model: ''}), '');
});

test('recording a model moves it to the front without mutating settings', () => {
  const before = {...defaultSettings(), seenModels: ['b', 'a']};
  const after = recordModel(before, ' a ');
  assert.deepEqual(after.seenModels, ['a', 'b']);
  assert.deepEqual(before.seenModels, ['b', 'a']);
  assert.equal(recordModel(before, ''), before);
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd anna; node --test tests/roles.test.mjs`
Expected: FAIL (`Cannot find module ... roles.mjs`)

- [ ] **Step 3: 구현** `anna/bundle/roles.mjs`

```js
export const ROLE_IDS = ['analyst', 'critic', 'editor'];

export const ROLES = {
  analyst: {
    name: {ko: '분석가', en: 'Analyst'},
    persona: {
      ko: '당신은 분석가입니다. 사실, 가정, 판단 기준을 구분해 근거와 구조를 짚습니다.',
      en: 'You are the analyst. Separate facts, assumptions and criteria, and lay out the reasoning.',
    },
  },
  critic: {
    name: {ko: '비판자', en: 'Critic'},
    persona: {
      ko: '당신은 비판자입니다. 가장 약한 가정과 위험, 반례를 먼저 지적하고 대안을 제시합니다.',
      en: 'You are the critic. Point out the weakest assumption, risks and counterexamples first, then offer an alternative.',
    },
  },
  editor: {
    name: {ko: '정리자', en: 'Editor'},
    persona: {
      ko: '당신은 정리자입니다. 결론, 근거, 남은 쟁점 순서로 합의안과 문서를 짧게 다듬습니다.',
      en: 'You are the editor. Shape agreements and documents as conclusion, reasons and open issues.',
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
    language: 'ko',
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
    language: raw.language === 'en' ? 'en' : 'ko',
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd anna; node --test tests/roles.test.mjs`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add anna/bundle/roles.mjs anna/tests/roles.test.mjs
git commit -m "feat(anna): add role and model preference settings"
```

---

### Task 3: AI 호출 창구 (`ai.mjs`)

**Files:**
- Create: `anna/bundle/ai.mjs`
- Test: `anna/tests/ai.test.mjs`

**Interfaces:**
- Consumes: Anna `llm` 네임스페이스(`stream(request)` → async iterable of `{event:'model_token',text}` / `{event:'complete',content,model}` / `{event:'error',code,message}`; `complete(request)` → `{content:{text}, model}`)
- Produces:
  - `class AiError extends Error {kind: 'quota'|'provider'|'timeout'|'aborted'|'unavailable', partial: string}`
  - `classify(error) -> kind`
  - `createAi(llm) -> {speak({system, messages:[{role:'user'|'assistant', text}], preferences, maxTokens?, onToken?, signal?}) -> Promise<{text, model}>}`

- [ ] **Step 1: 실패하는 테스트 작성** `anna/tests/ai.test.mjs`

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAi, classify, AiError} from '../bundle/ai.mjs';

const streamOf = (events, calls = []) => ({
  stream(request) { calls.push(request); return (async function* () { for (const e of events) { await null; yield e; } })(); },
  async complete() { throw new Error('complete must not be called'); },
});
const ask = {system: 'sys', messages: [{role: 'user', text: 'hi'}], preferences: {speedPriority: 0.5}};

test('streams tokens and returns the model Anna actually used', async () => {
  const calls = [], seen = [];
  const ai = createAi(streamOf([{event: 'model_token', text: 'Hel'}, {event: 'model_token', text: 'lo'}, {event: 'complete', content: {text: 'Hello'}, model: 'google/gemini-3-flash-preview'}], calls));
  assert.deepEqual(await ai.speak({...ask, onToken: text => seen.push(text)}), {text: 'Hello', model: 'google/gemini-3-flash-preview'});
  assert.deepEqual(seen, ['Hel', 'Hello']);
  assert.deepEqual(calls[0], {systemPrompt: 'sys', messages: [{role: 'user', content: {type: 'text', text: 'hi'}}], maxTokens: 600, temperature: 0.7, modelPreferences: {speedPriority: 0.5}});
});

test('falls back to complete when the host has no streaming', async () => {
  const llm = {
    stream() { return (async function* () { yield {event: 'error', code: -32601, message: 'unknown method'}; })(); },
    async complete(request) { return {content: {text: 'ok:' + request.messages[0].content.text}, model: 'openai/gpt'}; },
  };
  assert.deepEqual(await createAi(llm).speak(ask), {text: 'ok:hi', model: 'openai/gpt'});
  assert.deepEqual(await createAi({complete: llm.complete}).speak(ask), {text: 'ok:hi', model: 'openai/gpt'});
});

test('abort stops a stalled stream and keeps the partial text', async () => {
  const controller = new AbortController();
  let closed = false;
  const llm = {stream() {
    return {[Symbol.asyncIterator]() { let sent = false; return {
      next: () => sent ? new Promise(() => {}) : (sent = true, Promise.resolve({value: {event: 'model_token', text: 'part'}, done: false})),
      return: async () => { closed = true; return {done: true}; },
    }; }};
  }};
  const pending = createAi(llm).speak({...ask, signal: controller.signal, onToken: () => controller.abort()});
  await assert.rejects(pending, e => e instanceof AiError && e.kind === 'aborted' && e.partial === 'part');
  assert.equal(closed, true);
});

test('errors are classified for the user', async () => {
  assert.equal(classify({code: 'APP_QUOTA_EXCEEDED'}), 'quota');
  assert.equal(classify(new Error('insufficient credit')), 'quota');
  assert.equal(classify({code: 'APP_PROVIDER_ERROR', message: 'no eligible model available'}), 'provider');
  assert.equal(classify(new Error('RPC llm.stream timed out after 180000ms')), 'timeout');
  assert.equal(classify(new Error('boom')), 'unavailable');
  const failing = streamOf([{event: 'model_token', text: 'x'}, {event: 'error', code: 'APP_QUOTA_EXCEEDED', message: 'quota'}]);
  await assert.rejects(createAi(failing).speak(ask), e => e.kind === 'quota' && e.partial === 'x');
  await assert.rejects(createAi(streamOf([])).speak(ask), e => e.kind === 'unavailable');
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd anna; node --test tests/ai.test.mjs`
Expected: FAIL (`Cannot find module ... ai.mjs`)

- [ ] **Step 3: 구현** `anna/bundle/ai.mjs`

```js
export class AiError extends Error {
  constructor(kind, message, partial = '') {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.partial = partial;
  }
}

const UNSUPPORTED = new Set([-32601, 'not_implemented', 'unknown_method']);

export function classify(error) {
  const code = error?.code;
  const text = String(error?.message || '');
  if (code === 'APP_QUOTA_EXCEEDED' || /quota|credit|insufficient/i.test(text)) return 'quota';
  if (code === 'APP_PROVIDER_ERROR' || /no eligible model/i.test(text)) return 'provider';
  if (/timed? ?out/i.test(text)) return 'timeout';
  return 'unavailable';
}

export function createAi(llm) {
  async function viaComplete(request) {
    const result = await llm.complete(request);
    return {text: result?.content?.text || '', model: result?.model || ''};
  }

  async function speak({system, messages, preferences, maxTokens = 600, onToken = () => {}, signal} = {}) {
    const request = {
      systemPrompt: system,
      messages: messages.map(m => ({role: m.role, content: {type: 'text', text: m.text}})),
      maxTokens,
      temperature: 0.7,
      modelPreferences: preferences,
    };
    if (signal?.aborted) throw new AiError('aborted', 'aborted');
    let text = '';
    let iterator = null;
    try {
      if (typeof llm.stream !== 'function') return await viaComplete(request);
      iterator = llm.stream(request)[Symbol.asyncIterator]();
      const aborted = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new AiError('aborted', 'aborted')), {once: true}));
      aborted.catch(() => {});
      while (true) {
        const {value: event, done} = await (signal ? Promise.race([iterator.next(), aborted]) : iterator.next());
        if (done) break;
        if (event?.event === 'model_token' && event.text) {
          text += event.text;
          onToken(text);
          if (signal?.aborted) throw new AiError('aborted', 'aborted');
        } else if (event?.event === 'complete') {
          return {text: event.content?.text || text, model: event.model || ''};
        } else if (event?.event === 'error') {
          if (!text && UNSUPPORTED.has(event.code)) return await viaComplete(request);
          throw Object.assign(new Error(event.message || 'stream failed'), {code: event.code});
        }
      }
      throw Object.assign(new Error('stream ended without a reply'), {code: 'stream_closed'});
    } catch (error) {
      if (error instanceof AiError) {
        error.partial = text;
        throw error;
      }
      throw new AiError(classify(error), error?.message || 'AI unavailable', text);
    } finally {
      iterator?.return?.().catch?.(() => {});
    }
  }

  return {speak};
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd anna; node --test tests/ai.test.mjs`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add anna/bundle/ai.mjs anna/tests/ai.test.mjs
git commit -m "feat(anna): add Anna AI streaming client with abort and fallback"
```

---

### Task 4: 저장소 (`store.mjs`)

**Files:**
- Create: `anna/bundle/store.mjs`
- Test: `anna/tests/store.test.mjs`

**Interfaces:**
- Consumes: `normalizeSettings` (Task 2). Anna `storage.get({key}) -> {value, exists?}`, `set({key,value})`, `list({prefix,cursor,limit}) -> {items:[{key}], next_cursor}`, `delete({key})`
- Produces:
  - `SETTINGS_KEY='settings'`, `INDEX_KEY='threads'`, `threadKey(id) -> 'thread/<id>'`
  - `summary(thread) -> {id, title, kind, status, updated, archived}`
  - `createStore(storage) -> {loadSettings(), saveSettings(settings), listThreads(), loadThread(id), saveThread(thread), deleteThread(id), repairIndex()}`
  - `Thread`는 최소 `{id, title, kind:'discussion'|'vote'|'pipeline', status, updated:number(ms), archived?:boolean}`를 가진다. 나머지 필드는 2단계에서 정의한다.

- [ ] **Step 1: 실패하는 테스트 작성** `anna/tests/store.test.mjs`

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStore, threadKey} from '../bundle/store.mjs';
import {defaultSettings} from '../bundle/roles.mjs';

function memory(seed = {}) {
  const kv = structuredClone(seed), log = [];
  return {kv, log, storage: {
    async get({key}) { return Object.hasOwn(kv, key) ? {value: structuredClone(kv[key]), exists: true} : {value: null, exists: false}; },
    async set({key, value}) { log.push(key); kv[key] = structuredClone(value); return {etag: 'e'}; },
    async list({prefix = '', cursor, limit = 100}) {
      const keys = Object.keys(kv).filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? keys.indexOf(cursor) + 1 : 0, page = keys.slice(start, start + limit);
      return {items: page.map(key => ({key})), next_cursor: start + limit < keys.length ? page.at(-1) : null};
    },
    async delete({key}) { if (!Object.hasOwn(kv, key)) throw Object.assign(new Error('missing'), {code: 'not_found'}); delete kv[key]; return {deleted: true}; },
  }};
}
const thread = (id, updated, extra = {}) => ({id, title: `T${id}`, kind: 'discussion', status: 'running', updated, ...extra});

test('settings load as defaults and save normalized', async () => {
  const m = memory();
  const store = createStore(m.storage);
  assert.deepEqual(await store.loadSettings(), defaultSettings());
  const saved = await store.saveSettings({...defaultSettings(), language: 'en', roles: {critic: {temperament: 'deep', family: 'gpt', model: ''}}});
  assert.equal(m.kv.settings.language, 'en');
  assert.deepEqual(saved.roles.critic, {temperament: 'deep', family: 'gpt', model: ''});
  assert.deepEqual(saved.roles.analyst, {temperament: 'balanced', family: 'auto', model: ''});
});

test('a thread is written before its index entry, newest first', async () => {
  const m = memory();
  const store = createStore(m.storage);
  await store.saveThread(thread('a', 1));
  await store.saveThread(thread('b', 2, {title: 'x'.repeat(200)}));
  await store.saveThread(thread('a', 3, {status: 'done'}));
  assert.deepEqual(m.log, ['thread/a', 'threads', 'thread/b', 'threads', 'thread/a', 'threads']);
  const index = await store.listThreads();
  assert.deepEqual(index.map(t => [t.id, t.status]), [['a', 'done'], ['b', 'running']]);
  assert.equal(index[1].title.length, 80);
  assert.equal((await store.loadThread('a')).status, 'done');
  assert.equal(await store.loadThread('missing'), null);
});

test('deleting removes the thread and its index entry, even if already gone', async () => {
  const m = memory();
  const store = createStore(m.storage);
  await store.saveThread(thread('a', 1));
  await store.deleteThread('a');
  assert.equal(Object.hasOwn(m.kv, threadKey('a')), false);
  assert.deepEqual(await store.listThreads(), []);
  await store.deleteThread('a');
});

test('repair adds orphaned threads, drops missing ones and ignores chunks', async () => {
  const seed = {threads: [{id: 'gone', title: 'G', kind: 'vote', status: 'done', updated: 9, archived: false}]};
  for (let i = 0; i < 250; i++) seed[threadKey(`t${i}`)] = thread(`t${i}`, i);
  seed['thread/t1/0'] = {chunk: true};
  const m = memory(seed);
  const store = createStore(m.storage);
  const index = await store.repairIndex();
  assert.equal(index.length, 250);
  assert.equal(index.some(t => t.id === 'gone'), false);
  assert.equal(index[0].id, 't249');
  m.log.length = 0;
  await store.repairIndex();
  assert.deepEqual(m.log, [], 'a consistent index is not rewritten');
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd anna; node --test tests/store.test.mjs`
Expected: FAIL (`Cannot find module ... store.mjs`)

- [ ] **Step 3: 구현** `anna/bundle/store.mjs`

```js
import {normalizeSettings} from './roles.mjs';

export const SETTINGS_KEY = 'settings';
export const INDEX_KEY = 'threads';
export const threadKey = id => `thread/${id}`;
const THREAD_PATTERN = /^thread\/([^/]+)$/;

export function summary(thread) {
  return {
    id: thread.id,
    title: String(thread.title || '').slice(0, 80),
    kind: thread.kind,
    status: thread.status,
    updated: thread.updated,
    archived: thread.archived === true,
  };
}

const missing = error => /not.?found/i.test(String(error?.code || error?.message || ''));

export function createStore(storage) {
  async function read(key) {
    const result = await storage.get({key});
    return result && result.exists !== false ? result.value ?? null : null;
  }
  async function listThreads() {
    const value = await read(INDEX_KEY);
    return Array.isArray(value) ? value : [];
  }
  async function writeIndex(items) {
    const sorted = [...items].sort((a, b) => b.updated - a.updated);
    await storage.set({key: INDEX_KEY, value: sorted});
    return sorted;
  }

  return {
    async loadSettings() {
      return normalizeSettings(await read(SETTINGS_KEY));
    },
    async saveSettings(settings) {
      const value = normalizeSettings(settings);
      await storage.set({key: SETTINGS_KEY, value});
      return value;
    },
    listThreads,
    async loadThread(id) {
      return read(threadKey(id));
    },
    async saveThread(thread) {
      await storage.set({key: threadKey(thread.id), value: thread});
      const items = (await listThreads()).filter(item => item.id !== thread.id);
      items.push(summary(thread));
      return writeIndex(items);
    },
    async deleteThread(id) {
      try {
        await storage.delete({key: threadKey(id)});
      } catch (error) {
        if (!missing(error)) throw error;
      }
      return writeIndex((await listThreads()).filter(item => item.id !== id));
    },
    async repairIndex() {
      const ids = [];
      let cursor = null;
      do {
        const page = await storage.list({prefix: 'thread/', limit: 200, ...(cursor ? {cursor} : {})});
        for (const item of page?.items || []) {
          const match = THREAD_PATTERN.exec(item.key);
          if (match) ids.push(match[1]);
        }
        cursor = page?.next_cursor || null;
      } while (cursor);
      const index = await listThreads();
      const present = new Set(ids);
      const known = new Set(index.map(item => item.id));
      const items = index.filter(item => present.has(item.id));
      let changed = items.length !== index.length;
      for (const id of ids) {
        if (known.has(id)) continue;
        const thread = await read(threadKey(id));
        if (thread?.id === id) {
          items.push(summary(thread));
          changed = true;
        }
      }
      return changed ? writeIndex(items) : index;
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd anna; node --test tests/store.test.mjs`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add anna/bundle/store.mjs anna/tests/store.test.mjs
git commit -m "feat(anna): add settings and thread storage with index repair"
```

---

### Task 5: 문구와 역할·모델 설정 화면

**Files:**
- Create: `anna/bundle/i18n.mjs`, `anna/tests/i18n.test.mjs`, `anna/tests/browser/mock-sdk.mjs`, `anna/tests/browser/settings.browser.mjs`
- Modify: `anna/bundle/app.js` (Task 1 임시 파일 전체 교체)

**Interfaces:**
- Consumes: `ROLE_IDS`, `ROLES`, `TEMPERAMENTS`, `FAMILIES` (Task 2), `createStore` (Task 4), Task 1의 DOM id
- Produces:
  - `i18n.mjs`: `TEXT = {ko:{...}, en:{...}}`, `setLanguage(lang)`, `getLanguage()`, `t(key)`
  - 화면 계약(2단계 테스트도 사용): `body[data-ready="true"]`, 역할 카드 `fieldset.role[data-role=<id>]`, 선택 상자 `select[name="<id>-temperament|family|model"]`, `#notice`

- [ ] **Step 1: 문구 테스트 작성** `anna/tests/i18n.test.mjs`

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TEXT, t, setLanguage, getLanguage} from '../bundle/i18n.mjs';

test('Korean and English define the same non-empty keys', () => {
  assert.deepEqual(Object.keys(TEXT.en).sort(), Object.keys(TEXT.ko).sort());
  for (const lang of ['ko', 'en']) for (const [key, value] of Object.entries(TEXT[lang])) assert.ok(value, `${lang}.${key}`);
});

test('language switching falls back to Korean', () => {
  setLanguage('en');
  assert.equal(getLanguage(), 'en');
  assert.equal(t('save'), 'Save');
  setLanguage('xx');
  assert.equal(getLanguage(), 'ko');
  assert.equal(t('save'), '저장');
  assert.equal(t('no-such-key'), 'no-such-key');
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd anna; node --test tests/i18n.test.mjs`
Expected: FAIL (`Cannot find module ... i18n.mjs`)

- [ ] **Step 3: 구현** `anna/bundle/i18n.mjs`

```js
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd anna; node --test tests/i18n.test.mjs`
Expected: 2 tests pass

- [ ] **Step 5: 가짜 SDK 작성** `anna/tests/browser/mock-sdk.mjs`

```js
// Deterministic host for UI tests. No Anna account, network or AI allowance.
const state = JSON.parse(localStorage.getItem('test-host') || '{"kv":{}}');
const faults = JSON.parse(sessionStorage.getItem('test-faults') || '{}');
const calls = [];
const persist = () => localStorage.setItem('test-host', JSON.stringify(state));
window.hostTest = {state, faults, calls};

const runtime = {
  window: {set_title: async () => ({})},
  storage: {
    async get({key}) {
      calls.push({method: 'storage.get', key});
      if (faults.load) throw new Error('storage unavailable');
      return Object.hasOwn(state.kv, key) ? {value: structuredClone(state.kv[key]), etag: 'e', exists: true} : {value: null, exists: false};
    },
    async set({key, value}) {
      calls.push({method: 'storage.set', key});
      if (faults.save) throw new Error('storage unavailable');
      state.kv[key] = structuredClone(value);
      persist();
      return {etag: 'e'};
    },
    async list({prefix = ''} = {}) {
      return {items: Object.keys(state.kv).filter(key => key.startsWith(prefix)).map(key => ({key})), next_cursor: null};
    },
    async delete({key}) {
      delete state.kv[key];
      persist();
      return {deleted: true};
    },
  },
  llm: {
    async complete() {
      calls.push({method: 'llm.complete'});
      throw Object.assign(new Error('AI disabled in UI tests'), {code: 'llm_disabled'});
    },
  },
};

export const AnnaAppRuntime = {
  async connect() {
    if (faults.connect) throw new Error('connect failed');
    return runtime;
  },
};
```

- [ ] **Step 6: 실패하는 브라우저 테스트 작성** `anna/tests/browser/settings.browser.mjs`

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

// Every request is served locally; CSP matches the Anna bundle policy.
const bundle = new URL('../../bundle/', import.meta.url);
const mock = await readFile(new URL('./mock-sdk.mjs', import.meta.url), 'utf8');
const TYPES = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml'};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:";

async function setup(t, {faults = {}, kv = {}, viewport = {width: 1180, height: 820}} = {}) {
  const browser = await chromium.launch(process.env.ANNA_BROWSER_CHANNEL ? {channel: process.env.ANNA_BROWSER_CHANNEL} : process.platform === 'win32' ? {channel: 'msedge'} : {});
  t.after(() => browser.close());
  const page = await browser.newPage({viewport});
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/Content Security Policy/i.test(message.text())) errors.push(message.text()); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://agent-hub.test') return route.abort();
    if (url.pathname.includes('/_sdk/')) return route.fulfill({contentType: 'text/javascript', body: mock});
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (file.includes('..')) return route.abort();
    try {
      await route.fulfill({body: await readFile(new URL(file, bundle)), contentType: TYPES[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream', headers: {'content-security-policy': CSP}});
    } catch {
      await route.fulfill({status: 404, body: ''});
    }
  });
  await page.addInitScript(({faults, kv}) => {
    if (sessionStorage.getItem('test-initialized')) return;
    sessionStorage.setItem('test-initialized', '1');
    sessionStorage.setItem('test-faults', JSON.stringify(faults));
    localStorage.setItem('test-host', JSON.stringify({kv}));
  }, {faults, kv});
  await page.goto('https://agent-hub.test/');
  t.after(() => assert.deepEqual(errors, [], 'No uncaught browser errors or CSP violations'));
  return page;
}
const ready = page => page.waitForSelector('body[data-ready="true"]');
const stored = page => page.evaluate(() => window.hostTest.state.kv.settings);

test('defaults show three Korean roles without any AI call', async t => {
  const page = await setup(t);
  await ready(page);
  assert.deepEqual(await page.locator('fieldset.role').evaluateAll(els => els.map(e => e.dataset.role)), ['analyst', 'critic', 'editor']);
  assert.equal(await page.locator('fieldset.role[data-role="critic"] legend').textContent(), '비판자');
  assert.equal(await page.locator('select[name="analyst-temperament"]').inputValue(), 'balanced');
  assert.equal(await page.locator('select[name="analyst-model"]').isDisabled(), true);
  assert.match(await page.locator('select[name="analyst-model"] option').first().textContent(), /아직 응답을 받은 모델이 없어요/);
  assert.equal(await page.evaluate(() => window.hostTest.calls.some(c => c.method.startsWith('llm'))), false);
});

test('role settings persist across reloads', async t => {
  const page = await setup(t);
  await ready(page);
  await page.selectOption('select[name="critic-temperament"]', 'deep');
  await page.selectOption('select[name="critic-family"]', 'gpt');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '저장했어요');
  assert.deepEqual((await stored(page)).roles.critic, {temperament: 'deep', family: 'gpt', model: ''});
  await page.reload();
  await ready(page);
  assert.equal(await page.locator('select[name="critic-temperament"]').inputValue(), 'deep');
  assert.equal(await page.locator('select[name="critic-family"]').inputValue(), 'gpt');
});

test('models Anna used before can be chosen per role', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {}, seenModels: ['google/gemini-3-flash-preview', 'openai/gpt-5-mini']};
  const page = await setup(t, {kv: {settings}});
  await ready(page);
  const options = await page.locator('select[name="editor-model"] option').evaluateAll(els => els.map(e => e.value));
  assert.deepEqual(options, ['', 'google/gemini-3-flash-preview', 'openai/gpt-5-mini']);
  await page.selectOption('select[name="editor-model"]', 'openai/gpt-5-mini');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '저장했어요');
  assert.equal((await stored(page)).roles.editor.model, 'openai/gpt-5-mini');
});

test('language choice switches the UI and is saved', async t => {
  const page = await setup(t);
  await ready(page);
  await page.selectOption('#language', 'en');
  await page.waitForFunction(() => document.querySelector('#settings-title').textContent === 'Roles and models');
  assert.equal(await page.locator('fieldset.role[data-role="analyst"] legend').textContent(), 'Analyst');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.waitForFunction(() => window.hostTest.state.kv.settings?.language === 'en');
});

test('save failures keep the form and explain the problem', async t => {
  const page = await setup(t, {faults: {save: true}});
  await ready(page);
  await page.selectOption('select[name="analyst-family"]', 'claude');
  await page.click('#settings-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('저장하지 못했어요'));
  assert.equal(await page.locator('select[name="analyst-family"]').inputValue(), 'claude');
  assert.equal(await page.locator('#settings-form button[type="submit"]').isDisabled(), false);
});

test('connection failure shows a reopen notice', async t => {
  const page = await setup(t, {faults: {connect: true}});
  await page.waitForFunction(() => !document.querySelector('#notice').hidden);
  assert.match(await page.locator('#notice').textContent(), /Anna에 연결하지 못했어요/);
});

test('mobile width has no horizontal overflow', async t => {
  const page = await setup(t, {viewport: {width: 360, height: 740}});
  await ready(page);
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
```

- [ ] **Step 7: 실패 확인**

Run: `cd anna; node --test tests/browser/settings.browser.mjs`
Expected: FAIL (임시 `app.js`에는 역할 카드가 없어 `fieldset.role`을 찾지 못함)

- [ ] **Step 8: 구현** `anna/bundle/app.js` 전체 교체

```js
import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';
import {createStore} from './store.mjs';
import {ROLE_IDS, ROLES, TEMPERAMENTS, FAMILIES} from './roles.mjs';
import {t, setLanguage, getLanguage} from './i18n.mjs';

const $ = selector => document.querySelector(selector);
let store;
let settings;

function notice(text) {
  const element = $('#notice');
  element.textContent = text;
  element.hidden = !text;
}

function option(value, label, selected) {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  element.selected = selected;
  return element;
}

function field(label, select) {
  const wrapper = document.createElement('label');
  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(caption, select);
  return wrapper;
}

function select(name, entries) {
  const element = document.createElement('select');
  element.name = name;
  element.append(...entries);
  return element;
}

function renderText() {
  document.documentElement.lang = getLanguage();
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
}

function renderRoles() {
  const language = getLanguage();
  const cards = ROLE_IDS.map(id => {
    const role = settings.roles[id];
    const models = role.model && !settings.seenModels.includes(role.model) ? [role.model, ...settings.seenModels] : settings.seenModels;
    const card = document.createElement('fieldset');
    card.className = `role role-${id}`;
    card.dataset.role = id;
    const legend = document.createElement('legend');
    legend.textContent = ROLES[id].name[language];
    const persona = document.createElement('p');
    persona.textContent = ROLES[id].persona[language];
    const model = select(`${id}-model`, [
      option('', models.length ? t('noModel') : t('noSeen'), !role.model),
      ...models.map(name => option(name, name, role.model === name)),
    ]);
    model.disabled = !models.length;
    card.append(
      legend,
      persona,
      field(t('temperament'), select(`${id}-temperament`, Object.keys(TEMPERAMENTS).map(key => option(key, t(key), role.temperament === key)))),
      field(t('family'), select(`${id}-family`, FAMILIES.map(key => option(key, t(key), role.family === key)))),
      field(t('model'), model),
    );
    return card;
  });
  $('#roles').replaceChildren(...cards);
}

function render() {
  renderText();
  renderRoles();
}

function readForm() {
  const data = new FormData($('#settings-form'));
  return {
    ...settings,
    roles: Object.fromEntries(ROLE_IDS.map(id => [id, {
      temperament: data.get(`${id}-temperament`),
      family: data.get(`${id}-family`),
      model: data.get(`${id}-model`) || '',
    }])),
  };
}

async function save(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    settings = await store.saveSettings(readForm());
    render();
    notice(t('saved'));
  } catch {
    notice(t('saveFailed'));
  } finally {
    button.disabled = false;
  }
}

async function changeLanguage() {
  setLanguage($('#language').value);
  settings = {...readForm(), language: getLanguage()};
  render();
  try {
    settings = await store.saveSettings(settings);
  } catch {
    notice(t('saveFailed'));
  }
}

async function main() {
  renderText();
  try {
    const anna = await AnnaAppRuntime.connect();
    store = createStore(anna.storage);
    settings = await store.loadSettings();
    setLanguage(settings.language);
    $('#language').value = settings.language;
    render();
    $('#settings-form').addEventListener('submit', save);
    $('#language').addEventListener('change', changeLanguage);
    anna.window.set_title({title: 'Agent Hub Radio'}).catch(() => {});
    document.body.dataset.ready = 'true';
  } catch {
    notice(t('loadFailed'));
  }
}

main();
```

- [ ] **Step 9: 통과 확인**

Run: `cd anna; npm test; node --test tests/browser/settings.browser.mjs; npm run validate`
Expected: 단위 14 tests pass, 브라우저 7 tests pass, `validate passed`

- [ ] **Step 10: Commit**

```bash
git add anna/bundle/i18n.mjs anna/bundle/app.js anna/tests/i18n.test.mjs anna/tests/browser
git commit -m "feat(anna): add bilingual role and model settings screen"
```

---

### Task 6: CI와 Windows 출력 인코딩 수정

**Files:**
- Create: `.github/workflows/anna.yml`, `tests/test_cli_encoding.py`
- Modify: `src/agent_hub/__main__.py:26` (`main()` 시작 부분)

**Interfaces:**
- Produces: GitHub Actions "Anna app" 작업(ubuntu·windows), 기존 "Tests" 작업의 Windows 실패 해소

- [ ] **Step 1: 실패하는 회귀 테스트 작성** `tests/test_cli_encoding.py`

```python
import os
from pathlib import Path
import subprocess
import sys
import unittest


class HelpEncodingTests(unittest.TestCase):
    def test_help_survives_a_legacy_output_encoding(self):
        env = dict(os.environ, PYTHONIOENCODING='cp1252', PYTHONPATH=str(Path(__file__).resolve().parents[1] / 'src'))
        env.pop('PYTHONUTF8', None)
        result = subprocess.run([sys.executable, '-m', 'agent_hub', 'chat', '--help'],
                                env=env, capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(b'agent-hub chat', result.stdout)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `$env:PYTHONPATH='src'; python -m unittest tests.test_cli_encoding -v`
Expected: FAIL (`UnicodeEncodeError: 'charmap' codec can't encode characters`)

- [ ] **Step 3: 구현** `src/agent_hub/__main__.py`의 `def main():` 바로 아래 첫 줄에 추가

```python
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,'reconfigure'):stream.reconfigure(errors='replace')
```

- [ ] **Step 4: 통과 확인**

Run: `$env:PYTHONPATH='src'; python -m unittest tests.test_cli_encoding tests.test_manual -v`
Expected: 모두 통과

- [ ] **Step 5: Anna CI 작성** `.github/workflows/anna.yml`

```yaml
name: Anna app

on:
  push:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: anna-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Anna / ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
    timeout-minutes: 15
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    defaults:
      run:
        working-directory: anna
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install locked tooling
        run: npm ci --ignore-scripts
      - name: Validate app manifest
        run: npm run validate
      - name: Unit tests
        run: npm test
      - name: Install browser
        run: npx playwright-core install chromium
      - name: Browser tests
        env:
          ANNA_BROWSER_CHANNEL: chromium
        run: npm run test:browser
```

- [ ] **Step 6: 전체 로컬 검증**

Run: `$env:PYTHONPATH='src'; python -m unittest discover -s tests; cd anna; npm test; npm run test:browser; npm run validate`
Expected: Python 215 tests OK(skipped=1), Anna 단위·브라우저 통과, `validate passed`

- [ ] **Step 7: Commit과 push, CI 확인**

```bash
git add .github/workflows/anna.yml tests/test_cli_encoding.py src/agent_hub/__main__.py
git commit -m "ci: add Anna app checks and fix legacy console help encoding"
git push -u origin release-anna
gh run list --branch release-anna -L 4
```

Expected: "Anna app"과 "Tests" 워크플로가 모두 성공. 실패하면 `gh run view <id> --log-failed`로 원인을 확인하고 수정 후 다시 push한다.

---

## 1단계 완료 기준

- `anna/`에서 `npm run validate`, `npm test`, `npm run test:browser`가 통과한다.
- 역할 3개의 성향·계열·사용해 본 모델을 저장하고 새로고침 후 유지된다.
- `ai.mjs`가 스트림·대체 경로·중단·오류 분류를 가짜 AI로 검증받는다.
- `store.mjs`가 설정·기록·색인 저장과 색인 복구를 검증받는다.
- GitHub "Anna app"·"Tests" 워크플로가 `release-anna`에서 성공한다.
- Anna 배포는 2단계(토론·투표·내보내기) 후에 한다.
