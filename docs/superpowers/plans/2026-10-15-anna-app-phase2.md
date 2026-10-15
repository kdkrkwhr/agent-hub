# Anna 앱 2단계 구현 계획 · 토론, 투표, 내보내기, 소유자 테스트 배포

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 역할 토론·독립 투표를 실행·중지·재시도·이어하기하고, 기록을 보관·삭제·Markdown으로 내보내는 화면을 만든 뒤 `agent-hub-radio` 0.4.0을 Anna 소유자 테스트 앱으로 배포한다.

**Architecture:** DOM을 모르는 진행 모듈(`runner.mjs`·`discussion.mjs`·`voting.mjs`·`export.mjs`)이 `ai.speak`와 `store`만 받아 단계를 진행·저장한다. 화면은 탭(토론·투표·기록·설정)과 기록 상세 화면으로 나누고, 화면 모듈(`view.mjs`·`settings-view.mjs`·`threads-view.mjs`·`compose-view.mjs`)이 공유 상태 `ctx`를 통해 진행 모듈을 호출한다.

**Tech Stack:** 브라우저 ES 모듈, `@anna-ai/cli` 0.1.57, `playwright-core` 1.64.0, Node 22 `node:test`, GitHub Actions.

**설계 문서:** `docs/superpowers/specs/2026-10-15-anna-app-design.md` · **1단계 계획:** `docs/superpowers/plans/2026-10-15-anna-app-phase1.md`

## Global Constraints

- 브랜치: `release-anna`. `main`에는 커밋하지 않는다. `.claude/`, `skills-lock.json`은 스테이징하지 않는다(경로를 지정해 `git add`).
- 앱 slug `agent-hub-radio`, 버전 `0.4.0`.
- Anna AI 실제 호출 금지. 모든 테스트는 가짜 AI·가짜 저장소·가짜 SDK를 쓴다.
- Anna 번들 CSP: 인라인 `<script>`·인라인 이벤트 처리기·HTML `style=""` 속성 금지. `element.style` 조작도 쓰지 않는다.
- 저장 키: `settings`, `threads`, `thread/<id>`. 기록 id는 `/^[A-Za-z0-9_-]{1,64}$/`.
- 발언 본문은 8000자에서 자른다. 토론 발언 `maxTokens` 600(자세히 1000), 최종안 1200, 투표 400.
- 토론 호출 수: 참여 역할 N이면 N + N + 1 + (N−1). 3명이면 9회. 토론은 역할 2개 이상, 투표는 1개 이상, 선택지 2~6개.
- 독립 의견(토론 1회차)과 투표 프롬프트에는 다른 역할의 발언·표를 넣지 않는다.
- UI 문구는 한국어·영어 모두 `i18n.mjs`에 두고 기본은 한국어. 키는 두 언어가 같아야 한다(`tests/i18n.test.mjs`).
- `anna-app apps submit-review`, `apps release`는 실행하지 않는다. 노트버디 앱·데이터는 건드리지 않는다.
- 토큰·자격 증명·IP는 어디에도 기록하지 않는다.

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `anna/bundle/runner.mjs` (신규) | 기록 id, 빈 발언, 단계 진행·저장·실제 모델 기록, 역할 건너뛰기 |
| `anna/bundle/discussion.mjs` (신규) | 토론 단계·프롬프트·생성 |
| `anna/bundle/voting.mjs` (신규) | 투표 생성·프롬프트·표 해석·집계 |
| `anna/bundle/export.mjs` (신규) | Markdown 내보내기 |
| `anna/bundle/view.mjs` (신규) | DOM 공통 도우미(`$`, `node`, `button`, `notice`, `renderText`) |
| `anna/bundle/settings-view.mjs` (신규) | 역할·모델 설정 화면(기존 `app.js`에서 이동) |
| `anna/bundle/threads-view.mjs` (신규) | 화면 전환, 기록 목록, 기록 상세, 실행·중지·재시도·건너뛰기, 내보내기·보관·삭제 |
| `anna/bundle/compose-view.mjs` (신규) | 토론·투표 시작 양식, 참여 역할, 예상 호출 수 |
| `anna/bundle/app.js` | SDK 연결, `ctx` 구성, 탭 연결 |
| `anna/bundle/index.html`, `style.css` | 탭과 각 화면 마크업·스타일 |
| `anna/bundle/i18n.mjs` | 문구 추가, `{n}` 채우기, 언어 지정 조회 `tr` |
| `anna/bundle/roles.mjs` | `modelMismatch` 추가 |
| `anna/bundle/ai.mjs`, `store.mjs` | 1단계 재리뷰 Minor 수정 |
| `anna/tests/*.test.mjs` | 단위 테스트 |
| `anna/tests/browser/harness.mjs` (신규) | 브라우저 테스트 공통 준비(기존 `settings.browser.mjs`에서 이동) |
| `anna/tests/browser/threads.browser.mjs`, `runs.browser.mjs` (신규) | 기록 화면, 실행 흐름 브라우저 테스트 |
| `anna/tests/browser/mock-sdk.mjs` | 가짜 `llm.stream` 추가 |
| `anna/HANDOFF.md`, `anna/RELEASE_040.md` (신규) | 배포 기록 |

### 공유 데이터 형태 (모든 Task가 따른다)

```js
// 발언(turn)
{step: 'opinion'|'rebuttal'|'final'|'review'|'ballot', role: 'analyst'|'critic'|'editor',
 status: 'pending'|'running'|'done'|'failed'|'stopped'|'skipped',
 text: string, model: string /* 응답의 실제 모델 */, requested: string /* requestedLabel */, error: ''|'quota'|'provider'|'timeout'|'unavailable'|'format'}

// 기록(thread)
{id, kind: 'discussion'|'vote', title, roles: string[], language: 'ko'|'en', detail: boolean,
 status: 'ready'|'running'|'done'|'failed'|'stopped', created, updated, archived: boolean, turns: turn[],
 request /* discussion */, passage, options: [{id: 'A', text}] /* vote */}

// 화면 공유 상태(ctx), app.js가 만든다
{store, ai, settings, threads: indexEntry[], thread: thread|null, view: string,
 running: {thread, controller: AbortController}|null, rerender(): void, onSettings(): void}
```

---

### Task 1: 1단계 재리뷰 Minor 정리 (`ai.mjs`, `store.mjs`)

**Files:**
- Modify: `anna/bundle/ai.mjs` (`finally` 블록)
- Modify: `anna/bundle/store.mjs` (`loadThread`, `saveThread`, `deleteThread`, `repairIndex`)
- Test: `anna/tests/ai.test.mjs`, `anna/tests/store.test.mjs`

**Interfaces:**
- Consumes: 기존 `createAi`, `createStore`.
- Produces: `store.loadThread(id)`와 `store.deleteThread(id)`는 잘못된 id에 `Error('Invalid thread id')`로 거부한다. 나머지 시그니처는 그대로.

- [ ] **Step 1: 실패 테스트 추가** — `anna/tests/ai.test.mjs` 끝에:

```js
test('a throwing iterator.return does not replace the reply', async () => {
  const llm = {stream: () => ({[Symbol.asyncIterator]: () => ({
    next: async () => ({value: {event: 'complete', content: {text: 'ok'}, model: 'm'}, done: false}),
    return() { throw new Error('boom'); },
  })})};
  assert.deepEqual(await createAi(llm).speak(ask), {text: 'ok', model: 'm'});
});

test('abort applies to the complete fallback after a thrown unsupported stream', async () => {
  const controller = new AbortController();
  const llm = {
    stream() { throw Object.assign(new Error('nope'), {code: -32601}); },
    complete: () => new Promise(resolve => setTimeout(() => resolve({content: {text: 'late'}, model: 'm'}), 50)),
  };
  const pending = createAi(llm).speak({...ask, signal: controller.signal});
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, error => error instanceof AiError && error.kind === 'aborted');
});
```

`anna/tests/store.test.mjs` 끝에:

```js
test('loading or deleting an invalid id is rejected without storage access', async () => {
  const m = memory({'thread/a/b': {x: 1}});
  const store = createStore(m.storage);
  await assert.rejects(store.loadThread('a/b'), /Invalid thread id/);
  await assert.rejects(store.deleteThread('a/b'), /Invalid thread id/);
  assert.equal(Object.hasOwn(m.kv, 'thread/a/b'), true);
  assert.deepEqual(m.log, []);
});

test('repair skips listing items without a key', async () => {
  const m = memory({[threadKey('a')]: thread('a', 1)});
  const list = m.storage.list;
  m.storage.list = async query => { const page = await list(query); return {...page, items: [null, {}, ...page.items]}; };
  assert.deepEqual((await createStore(m.storage).repairIndex()).map(t => t.id), ['a']);
});
```

- [ ] **Step 2: 실패 확인** — `cd anna; npm test`. 기대: `a throwing iterator.return…`(boom), `loading or deleting an invalid id…`, `repair skips listing items…`(TypeError) 실패. 두 번째 ai 테스트는 이미 통과할 수 있다(회귀 테스트).

- [ ] **Step 3: 구현** — `ai.mjs`의 `finally`를 다음으로 바꾼다:

```js
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try {
        iterator?.return?.()?.catch?.(() => {});
      } catch {}
    }
```

`store.mjs`: `ID_PATTERN` 아래에 추가하고 세 함수에서 사용한다.

```js
function assertId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Invalid thread id');
}
```

```js
    async loadThread(id) {
      assertId(id);
      return read(threadKey(id));
    },
    async saveThread(thread) {
      assertId(thread?.id);
      return serial(async () => {
        await storage.set({key: threadKey(thread.id), value: thread});
        const items = (await listThreads()).filter(item => item.id !== thread.id);
        items.push(summary(thread));
        return writeIndex(items);
      });
    },
    async deleteThread(id) {
      assertId(id);
      return serial(async () => {
        try {
          await storage.delete({key: threadKey(id)});
        } catch (error) {
          if (!missing(error)) throw error;
        }
        return writeIndex((await listThreads()).filter(item => item.id !== id));
      });
    },
```

`repairIndex`의 매칭 줄: `const match = THREAD_PATTERN.exec(String(item?.key ?? ''));`

- [ ] **Step 4: 통과 확인** — `npm test` 전부 통과.
- [ ] **Step 5: 커밋** — `git add anna/bundle/ai.mjs anna/bundle/store.mjs anna/tests/ai.test.mjs anna/tests/store.test.mjs; git commit -m "fix(anna): guard iterator cleanup and validate ids on load and delete"`

---

### Task 2: 진행기와 토론 (`runner.mjs`, `discussion.mjs`, `roles.modelMismatch`)

**Files:**
- Create: `anna/bundle/runner.mjs`, `anna/bundle/discussion.mjs`
- Modify: `anna/bundle/roles.mjs` (함수 추가)
- Test: `anna/tests/discussion.test.mjs` (신규), `anna/tests/roles.test.mjs`

**Interfaces:**
- Consumes: `AiError`(ai.mjs), `ROLE_IDS`, `ROLES`, `modelPreferences(role)`, `requestedLabel(role)`, `recordModel(settings, model)`(roles.mjs). `ai.speak({system, messages, maxTokens, preferences, signal, onToken}) → {text, model}`. `store.saveThread(thread)`, `store.updateSettings(change) → settings`.
- Produces:
  - `roles.modelMismatch(turn) → boolean`
  - `runner.newId(now?, random?) → string`, `runner.blankTurn(step, role) → turn`, `runner.settled(turn) → boolean`, `runner.skipTurn(thread, index) → thread`
  - `runner.runThread({thread, plan, ai, store, settings, signal, onUpdate?, now?}) → Promise<{thread, settings, saveFailed}>`; `plan = {prompt(thread, index) → {system, messages, maxTokens}, accept?(thread, index) → '' | errorKind}`; `onUpdate(thread, {saveFailed})`. 실패해도 throw하지 않는다.
  - `discussion.discussionSteps(roles)`, `finalAuthor(roles)`, `createDiscussion({id, request, roles, language?, detail?, now?})`, `discussionPrompt(thread, index)`, `canSkip(turn)`, `discussionPlan`

- [ ] **Step 1: 실패 테스트** — `anna/tests/roles.test.mjs`의 import에 `modelMismatch`를 추가하고 끝에:

```js
test('a requested model or family missing from the actual model is a mismatch', () => {
  assert.equal(modelMismatch({requested: 'claude', model: 'google/gemini-3-flash-preview'}), true);
  assert.equal(modelMismatch({requested: 'gemini', model: 'google/gemini-3-flash-preview'}), false);
  assert.equal(modelMismatch({requested: 'openai/gpt-5-mini', model: 'openai/gpt-5-mini'}), false);
  assert.equal(modelMismatch({requested: '', model: 'x'}), false);
  assert.equal(modelMismatch({requested: 'gpt', model: ''}), false);
});
```

`anna/tests/discussion.test.mjs`:

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canSkip, createDiscussion, discussionPlan, discussionSteps} from '../bundle/discussion.mjs';
import {newId, runThread, skipTurn} from '../bundle/runner.mjs';
import {AiError} from '../bundle/ai.mjs';
import {defaultSettings} from '../bundle/roles.mjs';

const MODEL = 'google/gemini-3-flash-preview';

function fakeAi(script = () => null) {
  const calls = [];
  return {calls, async speak(args) {
    calls.push(args);
    const planned = script(calls.length, args);
    if (planned instanceof Error) throw planned;
    args.onToken?.('…');
    return planned || {text: `reply ${calls.length}`, model: MODEL};
  }};
}

function fakeStore({failSaves = 0, settings = defaultSettings()} = {}) {
  const saved = [];
  return {
    saved,
    get settings() { return settings; },
    async saveThread(thread) {
      if (failSaves > 0) { failSaves -= 1; throw new Error('storage down'); }
      saved.push(structuredClone(thread));
    },
    async updateSettings(change) { settings = change(settings); return settings; },
  };
}

const lunch = (roles = ['analyst', 'critic', 'editor']) => createDiscussion({id: 'd1', request: '점심 메뉴를 정해 줘\n근처에서', roles, now: 1});
const run = (thread, ai, store, extra = {}) => runThread({thread, plan: discussionPlan, ai, store, settings: store.settings, now: () => 5, ...extra});

test('three roles take nine turns and the editor writes the final', () => {
  assert.deepEqual(discussionSteps(['analyst', 'critic', 'editor']).map(s => `${s.step}:${s.role}`), [
    'opinion:analyst', 'opinion:critic', 'opinion:editor',
    'rebuttal:analyst', 'rebuttal:critic', 'rebuttal:editor',
    'final:editor', 'review:analyst', 'review:critic',
  ]);
  assert.deepEqual(discussionSteps(['analyst', 'critic']).map(s => `${s.step}:${s.role}`), [
    'opinion:analyst', 'opinion:critic', 'rebuttal:analyst', 'rebuttal:critic', 'final:critic', 'review:analyst',
  ]);
});

test('a discussion needs a request and two roles, kept in role order', () => {
  assert.throws(() => createDiscussion({id: 'x', request: '  ', roles: ['analyst', 'critic']}), /Empty request/);
  assert.throws(() => createDiscussion({id: 'x', request: 'q', roles: ['critic']}), /Need two roles/);
  const thread = createDiscussion({id: 'x', request: `${'긴 제목'.repeat(40)}\n둘째 줄`, roles: ['editor', 'analyst'], now: 7});
  assert.deepEqual(thread.roles, ['analyst', 'editor']);
  assert.equal(thread.title.length, 80);
  assert.equal(thread.status, 'ready');
  assert.deepEqual(thread.turns[0], {step: 'opinion', role: 'analyst', status: 'pending', text: '', model: '', requested: '', error: ''});
});

test('first-round opinions never see other replies', async () => {
  const ai = fakeAi();
  await run(lunch(), ai, fakeStore());
  const user = i => ai.calls[i].messages[0].text;
  assert.equal(ai.calls.length, 9);
  for (const i of [0, 1, 2]) assert.doesNotMatch(user(i), /reply/);
  assert.match(ai.calls[0].system, /분석가/);
  for (const n of [1, 2, 3]) assert.match(user(3), new RegExp(`reply ${n}`));
  assert.match(user(6), /reply 6/);
  assert.match(user(7), /reply 7/);
  assert.doesNotMatch(user(7), /reply 1\b/);
  assert.deepEqual(ai.calls.map(c => c.maxTokens), [600, 600, 600, 600, 600, 600, 1200, 600, 600]);
});

test('each turn keeps the actual model and the seen-model list grows', async () => {
  const base = defaultSettings();
  const store = fakeStore({settings: {...base, roles: {...base.roles, critic: {temperament: 'deep', family: 'gpt', model: ''}}}});
  const ai = fakeAi();
  const {thread, settings} = await run(lunch(), ai, store);
  assert.equal(thread.status, 'done');
  assert.ok(thread.turns.every(t => t.status === 'done' && t.model === MODEL));
  assert.equal(thread.turns[1].requested, 'gpt');
  assert.deepEqual(ai.calls[1].preferences.hints, [{name: 'gpt'}]);
  assert.equal(ai.calls[0].preferences.hints, undefined);
  assert.deepEqual(settings.seenModels, [MODEL]);
  assert.equal(store.saved.at(-1).status, 'done');
  assert.equal(store.saved.at(-1).updated, 5);
});

test('a failed turn stops the run and a retry skips finished turns', async () => {
  const store = fakeStore();
  const thread = lunch();
  const result = await run(thread, fakeAi(n => n === 4 ? new AiError('quota', 'quota') : null), store);
  assert.equal(result.thread.status, 'failed');
  assert.deepEqual([thread.turns[3].status, thread.turns[3].error], ['failed', 'quota']);
  assert.equal(store.saved.at(-1).status, 'failed');
  const second = fakeAi();
  await run(thread, second, store);
  assert.equal(second.calls.length, 6);
  assert.equal(thread.status, 'done');
});

test('stopping keeps the partial reply as stopped', async () => {
  const {thread} = await run(lunch(), fakeAi(n => n === 2 ? new AiError('aborted', 'aborted', '부분') : null), fakeStore());
  assert.equal(thread.status, 'stopped');
  assert.deepEqual([thread.turns[1].status, thread.turns[1].text, thread.turns[1].error], ['stopped', '부분', '']);
});

test('a skipped role is left out and the run continues; the final cannot be skipped', async () => {
  const thread = lunch();
  const store = fakeStore();
  await run(thread, fakeAi(n => n === 4 ? new AiError('provider', 'down') : null), store);
  skipTurn(thread, 3);
  const ai = fakeAi();
  await run(thread, ai, store);
  assert.equal(ai.calls.length, 5);
  assert.equal(thread.turns[3].status, 'skipped');
  assert.equal(thread.status, 'done');
  assert.equal(canSkip(thread.turns[6]), false);
  assert.equal(canSkip(thread.turns[3]), true);
});

test('save failures are reported and retried on the next save', async () => {
  const flags = [];
  const store = fakeStore({failSaves: 1});
  const result = await run(lunch(), fakeAi(), store, {onUpdate: (thread, {saveFailed}) => flags.push(saveFailed)});
  assert.ok(flags.includes(true));
  assert.equal(result.saveFailed, false);
  assert.equal(store.saved.at(-1).status, 'done');
});

test('unexpected errors become unavailable failures', async () => {
  const {thread} = await run(lunch(), fakeAi(() => new Error('weird')), fakeStore());
  assert.deepEqual([thread.status, thread.turns[0].error], ['failed', 'unavailable']);
});

test('thread ids are storage-safe and unique', () => {
  const a = newId(1760000000000, () => 0.1), b = newId(1760000000000, () => 0.2);
  assert.match(a, /^[A-Za-z0-9_-]{1,64}$/);
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: 실패 확인** — `npm test`. 기대: `discussion.test.mjs` 모듈 없음, `modelMismatch` import 실패.

- [ ] **Step 3: 구현** — `roles.mjs` 끝에:

```js
export function modelMismatch(turn) {
  const requested = String(turn?.requested || '').toLowerCase();
  const model = String(turn?.model || '').toLowerCase();
  return Boolean(requested && model && !model.includes(requested));
}
```

`anna/bundle/runner.mjs`:

```js
import {AiError} from './ai.mjs';
import {modelPreferences, recordModel, requestedLabel} from './roles.mjs';

const MAX_TEXT = 8000;

export function newId(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

export const blankTurn = (step, role) => ({step, role, status: 'pending', text: '', model: '', requested: '', error: ''});

export const settled = turn => turn.status === 'done' || turn.status === 'skipped';

export function skipTurn(thread, index) {
  const turn = thread.turns[index];
  if (turn && !settled(turn)) Object.assign(turn, {status: 'skipped', error: ''});
  return thread;
}

export async function runThread({thread, plan, ai, store, settings, signal, onUpdate = () => {}, now = Date.now}) {
  let latest = settings;
  let saveFailed = false;
  const update = () => onUpdate(thread, {saveFailed});
  async function save() {
    thread.updated = now();
    try {
      await store.saveThread(thread);
      saveFailed = false;
    } catch {
      saveFailed = true;
    }
    update();
  }
  thread.status = 'running';
  for (let index = 0; index < thread.turns.length; index += 1) {
    const turn = thread.turns[index];
    if (settled(turn)) continue;
    const role = latest.roles[turn.role];
    Object.assign(turn, {status: 'running', text: '', model: '', error: '', requested: requestedLabel(role)});
    update();
    try {
      const {system, messages, maxTokens} = plan.prompt(thread, index);
      const reply = await ai.speak({
        system,
        messages,
        maxTokens,
        signal,
        preferences: modelPreferences(role),
        onToken: text => {
          turn.text = text.slice(0, MAX_TEXT);
          update();
        },
      });
      Object.assign(turn, {text: String(reply.text || '').slice(0, MAX_TEXT), model: reply.model || ''});
      turn.error = plan.accept ? plan.accept(thread, index) : '';
      turn.status = turn.error ? 'failed' : 'done';
      if (turn.model) {
        try {
          latest = await store.updateSettings(current => recordModel(current, turn.model));
        } catch {}
      }
    } catch (error) {
      const kind = error instanceof AiError ? error.kind : 'unavailable';
      Object.assign(turn, {
        status: kind === 'aborted' ? 'stopped' : 'failed',
        error: kind === 'aborted' ? '' : kind,
        text: String(error?.partial ?? turn.text).slice(0, MAX_TEXT),
      });
    }
    if (turn.status !== 'done') {
      thread.status = turn.status;
      await save();
      return {thread, settings: latest, saveFailed};
    }
    await save();
  }
  thread.status = 'done';
  await save();
  return {thread, settings: latest, saveFailed};
}
```

`anna/bundle/discussion.mjs`:

```js
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
```

- [ ] **Step 4: 통과 확인** — `npm test` 전부 통과.
- [ ] **Step 5: 커밋** — `git add anna/bundle/runner.mjs anna/bundle/discussion.mjs anna/bundle/roles.mjs anna/tests/discussion.test.mjs anna/tests/roles.test.mjs; git commit -m "feat(anna): run role discussions step by step with resume and skip"`

---

### Task 3: 독립 투표 (`voting.mjs`)

**Files:**
- Create: `anna/bundle/voting.mjs`
- Test: `anna/tests/voting.test.mjs` (신규)

**Interfaces:**
- Consumes: `ROLE_IDS`, `ROLES`(roles.mjs); `blankTurn`, `settled`, `runThread`, `skipTurn`(runner.mjs).
- Produces: `createVote({id, passage, options: string[], roles, language?, now?}) → thread`, `votePrompt(thread, index)`, `parseBallot(text, options) → {choice, reason, concern} | null`, `tally(thread) → {counts: {A.., ABSTAIN}, ballots: [{role, model, choice, reason, concern}]} | null`(모든 발언이 `settled`일 때만), `votePlan = {prompt, accept}`. 해석할 수 없는 표는 `accept`가 `'format'`을 돌려 실패로 남긴다.

- [ ] **Step 1: 실패 테스트** — `anna/tests/voting.test.mjs`:

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createVote, parseBallot, tally, votePlan} from '../bundle/voting.mjs';
import {runThread, skipTurn} from '../bundle/runner.mjs';
import {defaultSettings} from '../bundle/roles.mjs';

const lunch = (roles = ['analyst', 'critic', 'editor']) => createVote({id: 'v1', passage: '점심은 무엇으로?', options: [' 짜장 ', '', '짬뽕'], roles, now: 1});
const ballot = (choice, reason = '빠르다') => JSON.stringify({choice, reason, concern: '없음'});
function replies(...texts) {
  const calls = [];
  return {calls, async speak(args) { calls.push(args); return {text: texts[calls.length - 1], model: 'openai/gpt-5-mini'}; }};
}
function memoryStore() {
  let settings = defaultSettings();
  return {get settings() { return settings; }, async saveThread() {}, async updateSettings(change) { settings = change(settings); return settings; }};
}
const run = (thread, ai, store = memoryStore()) => runThread({thread, plan: votePlan, ai, store, settings: store.settings, now: () => 9});

test('a vote needs a passage, two options and a voter', () => {
  const thread = lunch();
  assert.deepEqual(thread.options, [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}]);
  assert.deepEqual(thread.turns.map(t => [t.step, t.role]), [['ballot', 'analyst'], ['ballot', 'critic'], ['ballot', 'editor']]);
  assert.throws(() => createVote({id: 'x', passage: ' ', options: ['a', 'b'], roles: ['analyst']}), /Empty passage/);
  assert.throws(() => createVote({id: 'x', passage: 'p', options: ['a'], roles: ['analyst']}), /Need two options/);
  assert.throws(() => createVote({id: 'x', passage: 'p', options: ['a', 'b'], roles: []}), /Need a voter/);
  assert.equal(createVote({id: 'x', passage: 'p', options: ['1', '2', '3', '4', '5', '6', '7'], roles: ['critic']}).options.at(-1).id, 'F');
});

test('ballot prompts hold only the passage and options', async () => {
  const ai = replies(ballot('A', '첫 번째 근거'), ballot('B'), ballot('A'));
  await run(lunch(), ai);
  const user = ai.calls[1].messages[0].text;
  assert.match(user, /점심은 무엇으로\?/);
  assert.match(user, /A\. 짜장/);
  assert.match(user, /B\. 짬뽕/);
  assert.doesNotMatch(user, /첫 번째 근거/);
  assert.match(ai.calls[0].system, /JSON/);
  assert.equal(ai.calls[0].maxTokens, 400);
});

test('ballots parse from plain or fenced JSON and reject unknown choices', () => {
  const options = [{id: 'A', text: 'x'}, {id: 'B', text: 'y'}];
  assert.deepEqual(parseBallot('{"choice":"b","reason":" r ","concern":"c"}', options), {choice: 'B', reason: 'r', concern: 'c'});
  assert.equal(parseBallot('```json\n{"choice":"ABSTAIN","reason":"r","concern":"c"}\n```', options).choice, 'ABSTAIN');
  assert.equal(parseBallot('{"choice":"C"}', options), null);
  assert.equal(parseBallot('I pick A', options), null);
  assert.equal(parseBallot('{bad json}', options), null);
});

test('results stay hidden until every ballot is settled', async () => {
  const thread = lunch();
  assert.equal(tally(thread), null);
  await run(thread, replies(ballot('A'), ballot('B'), ballot('ABSTAIN')));
  assert.equal(thread.status, 'done');
  const result = tally(thread);
  assert.deepEqual(result.counts, {A: 1, B: 1, ABSTAIN: 1});
  assert.deepEqual(result.ballots.map(b => [b.role, b.choice, b.model]), [['analyst', 'A', 'openai/gpt-5-mini'], ['critic', 'B', 'openai/gpt-5-mini'], ['editor', 'ABSTAIN', 'openai/gpt-5-mini']]);
});

test('an unreadable ballot fails as a format error and can be skipped', async () => {
  const thread = lunch();
  const store = memoryStore();
  await run(thread, replies(ballot('A'), 'I pick B'), store);
  assert.equal(thread.status, 'failed');
  assert.deepEqual([thread.turns[1].status, thread.turns[1].error], ['failed', 'format']);
  assert.deepEqual(store.settings.seenModels, ['openai/gpt-5-mini']);
  assert.equal(tally(thread), null);
  skipTurn(thread, 1);
  await run(thread, replies(ballot('A')), store);
  assert.deepEqual(tally(thread).counts, {A: 2, B: 0, ABSTAIN: 0});
});
```

- [ ] **Step 2: 실패 확인** — `npm test`. 기대: `voting.mjs` 없음.

- [ ] **Step 3: 구현** — `anna/bundle/voting.mjs`:

```js
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
```

- [ ] **Step 4: 통과 확인** — `npm test` 전부 통과.
- [ ] **Step 5: 커밋** — `git add anna/bundle/voting.mjs anna/tests/voting.test.mjs; git commit -m "feat(anna): add sealed independent role votes"`

---

### Task 4: 문구 확장과 Markdown 내보내기 (`i18n.mjs`, `export.mjs`)

**Files:**
- Modify: `anna/bundle/i18n.mjs` (전체 교체)
- Create: `anna/bundle/export.mjs`
- Test: `anna/tests/i18n.test.mjs`, `anna/tests/export.test.mjs` (신규)

**Interfaces:**
- Consumes: `ROLES`, `modelMismatch`(roles.mjs); `tally`, `parseBallot`(voting.mjs).
- Produces: `i18n.tr(lang, key, values?)`, `i18n.t(key, values?)`(`{n}` 같은 자리 채움), 아래 문구 키 전체. `export.toMarkdown(thread, lang?) → string`, `export.exportName(thread) → 'agent-hub-<kind>-<id>.md'`.

- [ ] **Step 1: 실패 테스트** — `anna/tests/i18n.test.mjs`의 import를 `import {TEXT, t, tr, setLanguage, getLanguage} from '../bundle/i18n.mjs';`로 바꾸고 끝에:

```js
test('placeholders are filled and every status, step and error has text', () => {
  setLanguage('ko');
  assert.equal(t('estimate', {n: 9}), 'AI 호출 9회 예정');
  assert.equal(tr('en', 'votes', {n: 2}), '2 vote(s)');
  assert.equal(tr('en', 'no-such-key'), 'no-such-key');
  for (const key of ['ready', 'pending', 'running', 'done', 'failed', 'stopped', 'skipped']) assert.ok(TEXT.en[`status-${key}`]);
  for (const key of ['opinion', 'rebuttal', 'final', 'review', 'ballot']) assert.ok(TEXT.ko[`step-${key}`]);
  for (const key of ['quota', 'provider', 'timeout', 'unavailable', 'format']) assert.ok(TEXT.ko[`error-${key}`]);
});
```

`anna/tests/export.test.mjs`:

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportName, toMarkdown} from '../bundle/export.mjs';

const turn = (step, role, extra = {}) => ({step, role, status: 'done', text: `${role} ${step} 본문`, model: 'google/gemini-3-flash-preview', requested: '', error: '', ...extra});
const discussion = {
  id: 'd1', kind: 'discussion', title: '점심\n메뉴', request: '점심 메뉴를 정해 줘', roles: ['analyst', 'critic', 'editor'],
  language: 'ko', status: 'failed', updated: Date.UTC(2026, 9, 15),
  turns: [
    turn('opinion', 'analyst'), turn('opinion', 'critic', {requested: 'claude'}), turn('opinion', 'editor'),
    turn('rebuttal', 'analyst', {status: 'failed', error: 'quota', text: '부분', model: ''}),
    turn('rebuttal', 'critic', {status: 'pending', text: '', model: ''}),
  ],
};

test('a discussion exports by step with actual models and failures', () => {
  const md = toMarkdown(discussion);
  assert.match(md, /^# 점심 메뉴\n/);
  assert.match(md, /- 상태: 실패/);
  assert.match(md, /- 수정 시각: 2026-10-15T00:00:00.000Z/);
  assert.match(md, /## 요청\n\n점심 메뉴를 정해 줘/);
  assert.match(md, /## 1회차 독립 의견\n\n### 분석가 · 완료\n\n실제 모델: `google\/gemini-3-flash-preview`\n\nanalyst opinion 본문/);
  assert.match(md, /실제 모델: `google\/gemini-3-flash-preview` · 요청: `claude` \(요청과 다름\)/);
  assert.match(md, /### 분석가 · 실패\n\n실제 모델: 확인 안 됨\n\n_Anna AI 사용량이 부족해요\./);
  assert.match(md, /부분/);
  assert.doesNotMatch(md, /비판자 · 대기/);
  assert.doesNotMatch(md, /## 최종안/);
});

test('English export uses English labels', () => {
  const md = toMarkdown(discussion, 'en');
  assert.match(md, /## First-round independent opinions/);
  assert.match(md, /### Analyst · Done/);
  assert.match(md, /Actual model:/);
});

const ballot = (role, choice, extra = {}) => turn('ballot', role, {text: JSON.stringify({choice, reason: `${role} 근거`, concern: '없음'}), ...extra});
const vote = turns => ({id: 'v1', kind: 'vote', title: '점심은?', passage: '점심은?', options: [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}], roles: ['analyst', 'critic'], language: 'ko', status: 'done', updated: 0, turns});

test('vote ballots stay sealed in exports until every role has voted', () => {
  const md = toMarkdown(vote([ballot('analyst', 'A'), ballot('critic', 'B', {status: 'running', text: ''})]));
  assert.match(md, /모든 투표가 끝나면 공개됩니다/);
  assert.doesNotMatch(md, /analyst 근거/);
  assert.doesNotMatch(md, /— \d+표/);
});

test('a finished vote exports counts, choices and reasons', () => {
  const md = toMarkdown(vote([ballot('analyst', 'A'), ballot('critic', 'ABSTAIN')]));
  assert.match(md, /- A\. 짜장 — 1표/);
  assert.match(md, /- B\. 짬뽕 — 0표/);
  assert.match(md, /- 기권 — 1표/);
  assert.match(md, /### 분석가 · A\n\n실제 모델: `google\/gemini-3-flash-preview`\n\n- 근거: analyst 근거\n- 우려: 없음/);
  assert.match(md, /### 비판자 · 기권/);
});

test('export file names are stable', () => {
  assert.equal(exportName({kind: 'vote', id: 'abc-1'}), 'agent-hub-vote-abc-1.md');
});
```

- [ ] **Step 2: 실패 확인** — `npm test`. 기대: `tr` 없음, `export.mjs` 없음.

- [ ] **Step 3: 구현** — `anna/bundle/i18n.mjs` 전체:

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
    'tab-discussion': '토론',
    'tab-vote': '투표',
    'tab-history': '기록',
    'tab-settings': '설정',
    discussionTitle: '역할 토론',
    discussionHint: '역할들이 각자 의견을 낸 뒤 서로 반박하고, 정리자가 최종안을 쓰면 나머지 역할이 검토합니다.',
    voteTitle: '독립 투표',
    voteHint: '각 역할이 다른 표를 보지 않고 고릅니다. 모든 표가 끝나면 결과를 공개합니다.',
    request: '요청',
    passage: '지문',
    optionsInput: '선택지 (한 줄에 하나, 2~6개)',
    optionsTitle: '선택지',
    participants: '참여 역할',
    detail: '자세히 답하기',
    estimate: 'AI 호출 {n}회 예정',
    start: '토론 시작',
    startVote: '투표 시작',
    needText: '내용을 입력해 주세요.',
    needRoles: '토론에는 역할이 두 개 이상 필요해요.',
    needRole: '역할을 하나 이상 골라 주세요.',
    needOptions: '선택지를 두 개 이상 적어 주세요.',
    busy: '다른 작업이 진행 중이에요. 끝나거나 중지한 뒤 시작해 주세요.',
    historyTitle: '기록',
    showArchived: '보관한 기록 보기',
    empty: '아직 기록이 없어요.',
    kind: '종류',
    'kind-discussion': '토론',
    'kind-vote': '투표',
    status: '상태',
    updated: '수정 시각',
    'status-ready': '시작 전',
    'status-pending': '대기',
    'status-running': '진행 중',
    'status-done': '완료',
    'status-failed': '실패',
    'status-stopped': '중단됨',
    'status-skipped': '빠짐',
    'step-opinion': '1회차 독립 의견',
    'step-rebuttal': '2회차 반박·보완',
    'step-final': '최종안',
    'step-review': '동료 검토',
    'step-ballot': '투표',
    back: '목록으로',
    resume: '이어하기',
    stop: '중지',
    retry: '다시 시도',
    skip: '이 역할 빼고 계속',
    exportFile: 'Markdown 저장',
    copy: '복사',
    copied: '복사했어요',
    copyFailed: '복사하지 못했어요. 아래 내용을 직접 복사해 주세요.',
    archive: '보관',
    unarchive: '보관 해제',
    remove: '삭제',
    confirmRemove: '한 번 더 누르면 삭제',
    removed: '삭제했어요',
    actualModel: '실제 모델',
    requestedModel: '요청',
    mismatch: '요청과 다름',
    unknownModel: '확인 안 됨',
    'error-quota': 'Anna AI 사용량이 부족해요. 사용량을 확인한 뒤 다시 시도해 주세요.',
    'error-provider': '사용할 수 있는 모델이 응답하지 못했어요. Anna 설정에서 켠 모델을 확인해 주세요.',
    'error-timeout': '응답 시간이 초과됐어요.',
    'error-unavailable': 'AI에 연결하지 못했어요.',
    'error-format': '투표 답변 형식이 올바르지 않아요.',
    sealed: '제출 완료 · 모든 투표가 끝나면 공개',
    voteHidden: '모든 투표가 끝나면 공개됩니다.',
    resultTitle: '결과',
    votes: '{n}표',
    abstain: '기권',
    reason: '근거',
    concern: '우려',
    saveRetry: '기록을 저장하지 못했어요. 다음 단계에서 다시 저장합니다.',
    openFailed: '기록을 불러오지 못했어요.',
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
    'tab-discussion': 'Discuss',
    'tab-vote': 'Vote',
    'tab-history': 'History',
    'tab-settings': 'Settings',
    discussionTitle: 'Role discussion',
    discussionHint: 'Each role gives an opinion, then rebuts the others. The editor writes the final proposal and the other roles review it.',
    voteTitle: 'Independent vote',
    voteHint: 'Each role chooses without seeing other ballots. Results appear when every ballot is in.',
    request: 'Request',
    passage: 'Passage',
    optionsInput: 'Options (one per line, 2 to 6)',
    optionsTitle: 'Options',
    participants: 'Roles taking part',
    detail: 'Answer in detail',
    estimate: '{n} AI calls planned',
    start: 'Start discussion',
    startVote: 'Start vote',
    needText: 'Please enter some text.',
    needRoles: 'A discussion needs at least two roles.',
    needRole: 'Pick at least one role.',
    needOptions: 'Write at least two options.',
    busy: 'Another run is in progress. Start after it finishes or is stopped.',
    historyTitle: 'History',
    showArchived: 'Show archived',
    empty: 'Nothing here yet.',
    kind: 'Type',
    'kind-discussion': 'Discussion',
    'kind-vote': 'Vote',
    status: 'Status',
    updated: 'Updated',
    'status-ready': 'Not started',
    'status-pending': 'Waiting',
    'status-running': 'Running',
    'status-done': 'Done',
    'status-failed': 'Failed',
    'status-stopped': 'Stopped',
    'status-skipped': 'Skipped',
    'step-opinion': 'First-round independent opinions',
    'step-rebuttal': 'Second-round rebuttals',
    'step-final': 'Final proposal',
    'step-review': 'Peer review',
    'step-ballot': 'Ballots',
    back: 'Back to list',
    resume: 'Resume',
    stop: 'Stop',
    retry: 'Try again',
    skip: 'Continue without this role',
    exportFile: 'Save Markdown',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Could not copy. Please copy the text below by hand.',
    archive: 'Archive',
    unarchive: 'Unarchive',
    remove: 'Delete',
    confirmRemove: 'Click again to delete',
    removed: 'Deleted',
    actualModel: 'Actual model',
    requestedModel: 'Requested',
    mismatch: 'Differs from request',
    unknownModel: 'Not reported',
    'error-quota': 'Your Anna AI allowance has run out. Check it and try again.',
    'error-provider': 'No available model replied. Check the models enabled in your Anna settings.',
    'error-timeout': 'The reply timed out.',
    'error-unavailable': 'Could not reach the AI.',
    'error-format': 'The ballot was not in the expected format.',
    sealed: 'Submitted · revealed when every ballot is in',
    voteHidden: 'Revealed when every ballot is in.',
    resultTitle: 'Result',
    votes: '{n} vote(s)',
    abstain: 'Abstain',
    reason: 'Reason',
    concern: 'Concern',
    saveRetry: 'Could not save the record. It will be saved again at the next step.',
    openFailed: 'Could not open the record.',
  },
};

let language = 'ko';

export function setLanguage(value) {
  language = value === 'en' ? 'en' : 'ko';
}

export const getLanguage = () => language;

const fill = (text, values = {}) => text.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));

export const tr = (lang, key, values) => fill(TEXT[lang]?.[key] ?? TEXT.ko[key] ?? key, values);

export const t = (key, values) => tr(language, key, values);
```

`anna/bundle/export.mjs`:

```js
import {ROLES, modelMismatch} from './roles.mjs';
import {tr} from './i18n.mjs';
import {parseBallot, tally} from './voting.mjs';

const line = text => String(text ?? '').replace(/\s+/g, ' ').trim();

function modelNote(turn, lang) {
  const parts = [`${tr(lang, 'actualModel')}: ${turn.model ? `\`${line(turn.model)}\`` : tr(lang, 'unknownModel')}`];
  if (turn.requested) parts.push(`${tr(lang, 'requestedModel')}: \`${line(turn.requested)}\`${modelMismatch(turn) ? ` (${tr(lang, 'mismatch')})` : ''}`);
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
```

- [ ] **Step 4: 통과 확인** — `npm test` 전부 통과.
- [ ] **Step 5: 커밋** — `git add anna/bundle/i18n.mjs anna/bundle/export.mjs anna/tests/i18n.test.mjs anna/tests/export.test.mjs; git commit -m "feat(anna): add run texts and Markdown export"`

---

### Task 5: 탭, 기록 목록, 기록 상세 화면

**Files:**
- Create: `anna/bundle/view.mjs`, `anna/bundle/settings-view.mjs`, `anna/bundle/threads-view.mjs`, `anna/tests/browser/harness.mjs`, `anna/tests/browser/threads.browser.mjs`
- Modify: `anna/bundle/app.js`(전체 교체), `anna/bundle/index.html`(전체 교체), `anna/bundle/style.css`(추가), `anna/bundle/i18n.mjs`(`comingSoon` 두 줄 삭제), `anna/tests/browser/settings.browser.mjs`

**Interfaces:**
- Consumes: Task 1~4 전부. `ctx` 형태는 "공유 데이터 형태" 참고.
- Produces (Task 6이 쓴다):
  - `view.mjs`: `$`, `node(tag, className?, text?)`, `button(label, onClick, className?)`, `notice(text)`, `renderText()`
  - `settings-view.mjs`: `renderSettings(ctx)`, `mountSettings(ctx)`
  - `threads-view.mjs`: `showView(ctx, name)`, `showThread(ctx, thread)`, `openThread(ctx, id)`, `refreshHistory(ctx)`, `renderHistory(ctx)`, `renderThread(ctx)`, `run(ctx, thread)`, `mountThreads(ctx)`
  - 마크업 id: `#tabs [data-view]`, `#view-discussion|vote|history|thread|settings`, `#discussion-form`, `#vote-form`(각각 `[data-picks]`, `[data-estimate]`, 제출 버튼은 `disabled`로 시작), `#thread-list`, `#show-archived`, `#back`, `#thread-title`, `#thread-meta`, `#thread-actions`, `#turns`, `#vote-result`, `#export-text`
  - 버튼 클래스: `#thread-actions`의 `button.stop|resume|export|copy|archive|remove`, 발언 안의 `button.retry|skip`. 발언 `li.turn`은 `data-status`, `data-step`, 클래스 `role-<id>`, 자식 `.model`, `.mismatch`, `.text`, `.sealed`, `.choice`, `.error`.
  - 테스트: `harness.mjs`의 `setup(t, {faults, kv, viewport})`, `ready(page)`, `openTab(page, view)`

- [ ] **Step 1: 테스트 준비 이동** — `anna/tests/browser/harness.mjs`를 만들고, 기존 `settings.browser.mjs`의 상단(`bundle`, `mock`, `TYPES`, `CSP`, `setup`, `ready`)을 그대로 옮겨 `export`한다. 추가:

```js
export const openTab = (page, view) => page.click(`#tabs [data-view="${view}"]`);
```

`settings.browser.mjs` 상단은 다음만 남긴다:

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, ready, openTab} from './harness.mjs';

const stored = page => page.evaluate(() => window.hostTest.state.kv.settings);
```

그리고 `connection failure…`를 제외한 모든 테스트에서 `await ready(page);` 바로 다음 줄에 `await openTab(page, 'settings');`를 추가한다.

- [ ] **Step 2: 실패 테스트** — `anna/tests/browser/threads.browser.mjs`:

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {setup, ready, openTab} from './harness.mjs';

const MODEL = 'google/gemini-3-flash-preview';
const turn = (step, role, extra = {}) => ({step, role, status: 'done', text: `${role} ${step}`, model: MODEL, requested: '', error: '', ...extra});
const discussion = {
  id: 'd1', kind: 'discussion', title: '점심 메뉴', request: '점심 메뉴를 정해 줘', roles: ['analyst', 'critic', 'editor'],
  language: 'ko', detail: false, status: 'done', created: 1, updated: 2000, archived: false,
  turns: [
    turn('opinion', 'analyst'), turn('opinion', 'critic', {requested: 'claude'}), turn('opinion', 'editor'),
    turn('rebuttal', 'analyst'), turn('rebuttal', 'critic'), turn('rebuttal', 'editor'),
    turn('final', 'editor', {text: '최종안 본문'}), turn('review', 'analyst'), turn('review', 'critic'),
  ],
};
const vote = {
  id: 'v1', kind: 'vote', title: '어느 쪽', passage: '어느 쪽', options: [{id: 'A', text: '짜장'}, {id: 'B', text: '짬뽕'}],
  roles: ['analyst', 'critic'], language: 'ko', detail: false, status: 'failed', created: 1, updated: 1000, archived: false,
  turns: [
    turn('ballot', 'analyst', {text: '{"choice":"A","reason":"빠름","concern":"없음"}'}),
    turn('ballot', 'critic', {status: 'failed', error: 'quota', text: '', model: ''}),
  ],
};
const entry = thread => ({id: thread.id, title: thread.title, kind: thread.kind, status: thread.status, updated: thread.updated, archived: false});
const seeded = () => ({threads: [entry(discussion), entry(vote)], 'thread/d1': discussion, 'thread/v1': vote});
const titles = page => page.locator('#thread-list .thread-item strong').allTextContents();
const visible = page => page.evaluate(() => [...document.querySelectorAll('.view')].filter(v => !v.hidden).map(v => v.id));
async function open(page, id) {
  await openTab(page, 'history');
  await page.click(`.thread-item[data-id="${id}"]`);
}

test('tabs switch views and the history lists newest first', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  assert.deepEqual(await visible(page), ['view-discussion']);
  await openTab(page, 'history');
  assert.deepEqual(await visible(page), ['view-history']);
  assert.deepEqual(await titles(page), ['점심 메뉴', '어느 쪽']);
  assert.match(await page.locator('.thread-item[data-id="v1"] .meta').textContent(), /투표 · 실패/);
  await openTab(page, 'settings');
  assert.deepEqual(await visible(page), ['view-settings']);
  assert.equal(await page.locator('#tabs [data-view="settings"]').getAttribute('aria-pressed'), 'true');
});

test('an opened discussion shows every turn with the actual model', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  assert.deepEqual(await visible(page), ['view-thread']);
  assert.equal(await page.locator('#thread-title').textContent(), '점심 메뉴');
  assert.equal(await page.locator('#turns .turn').count(), 9);
  for (const text of await page.locator('#turns .turn .model').allTextContents()) assert.match(text, /실제 모델: google\/gemini-3-flash-preview/);
  assert.equal(await page.locator('#turns .turn .mismatch').count(), 1);
  assert.match(await page.locator('#turns .turn[data-step="opinion"]').nth(1).textContent(), /요청: claude.*요청과 다름/);
  assert.match(await page.locator('#turns .turn[data-step="final"] .text').textContent(), /최종안 본문/);
  assert.equal(await page.evaluate(() => window.hostTest.calls.some(c => c.method.startsWith('llm'))), false);
});

test('vote ballots stay sealed while a ballot is unfinished', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'v1');
  const first = page.locator('#turns .turn').nth(0);
  assert.match(await first.textContent(), /제출 완료/);
  assert.doesNotMatch(await first.textContent(), /빠름/);
  const failed = page.locator('#turns .turn').nth(1);
  assert.match(await failed.textContent(), /사용량이 부족해요/);
  assert.equal(await failed.locator('button.retry').count(), 1);
  assert.equal(await failed.locator('button.skip').count(), 1);
  assert.equal(await page.locator('#vote-result').isHidden(), true);
});

test('a thread exports as a Markdown file', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#thread-actions button.export')]);
  assert.equal(download.suggestedFilename(), 'agent-hub-discussion-d1.md');
  const text = await readFile(await download.path(), 'utf8');
  assert.match(text, /^# 점심 메뉴/);
  assert.match(text, /## 최종안/);
  assert.match(text, /최종안 본문/);
});

test('when the clipboard is blocked the Markdown is shown to copy by hand', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: () => Promise.reject(new Error('blocked'))}}));
  await open(page, 'd1');
  await page.click('#thread-actions button.copy');
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('직접 복사'));
  assert.equal(await page.locator('#export-text').isVisible(), true);
  assert.match(await page.locator('#export-text').inputValue(), /^# 점심 메뉴/);
});

test('archived threads move to the archived list', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  await page.click('#thread-actions button.archive');
  await page.waitForFunction(() => window.hostTest.state.kv['thread/d1'].archived === true);
  await page.click('#back');
  await page.waitForFunction(() => !document.querySelector('.thread-item[data-id="d1"]'));
  assert.deepEqual(await titles(page), ['어느 쪽']);
  await page.check('#show-archived');
  assert.deepEqual(await titles(page), ['점심 메뉴']);
});

test('deleting needs a second click', async t => {
  const page = await setup(t, {kv: seeded()});
  await ready(page);
  await open(page, 'd1');
  await page.click('#thread-actions button.remove');
  assert.equal(await page.locator('#thread-actions button.remove').textContent(), '한 번 더 누르면 삭제');
  assert.equal(await page.evaluate(() => Boolean(window.hostTest.state.kv['thread/d1'])), true);
  await page.click('#thread-actions button.remove');
  await page.waitForFunction(() => document.querySelector('#notice').textContent === '삭제했어요');
  assert.deepEqual(await visible(page), ['view-history']);
  assert.equal(await page.evaluate(() => Boolean(window.hostTest.state.kv['thread/d1'])), false);
  assert.deepEqual(await titles(page), ['어느 쪽']);
});

test('threads missing from the index are recovered on start', async t => {
  const page = await setup(t, {kv: {'thread/d1': discussion}});
  await ready(page);
  await openTab(page, 'history');
  assert.deepEqual(await titles(page), ['점심 메뉴']);
});

test('thread view fits a 360px screen', async t => {
  const page = await setup(t, {kv: seeded(), viewport: {width: 360, height: 740}});
  await ready(page);
  await open(page, 'd1');
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
```

- [ ] **Step 3: 실패 확인** — `npm run test:browser`. 기대: 설정 테스트는 `#tabs` 없음으로, 기록 테스트는 화면 없음으로 실패.

- [ ] **Step 4: 마크업** — `anna/bundle/index.html` 전체:

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
  <nav id="tabs" class="tabs">
    <button type="button" data-view="discussion" data-t="tab-discussion" aria-pressed="true">토론</button>
    <button type="button" data-view="vote" data-t="tab-vote" aria-pressed="false">투표</button>
    <button type="button" data-view="history" data-t="tab-history" aria-pressed="false">기록</button>
    <button type="button" data-view="settings" data-t="tab-settings" aria-pressed="false">설정</button>
  </nav>
  <label class="language"><span data-t="language">언어</span>
    <select id="language"><option value="ko">한국어</option><option value="en">English</option></select>
  </label>
</header>
<main>
  <section id="view-discussion" class="panel view" aria-labelledby="discussion-title">
    <h2 id="discussion-title" data-t="discussionTitle">역할 토론</h2>
    <p class="hint" data-t="discussionHint"></p>
    <form id="discussion-form" class="compose">
      <label><span data-t="request">요청</span><textarea name="request" rows="4" maxlength="4000"></textarea></label>
      <fieldset class="picks"><legend data-t="participants">참여 역할</legend><div data-picks></div></fieldset>
      <label class="check"><input type="checkbox" name="detail"><span data-t="detail">자세히 답하기</span></label>
      <p class="estimate" data-estimate></p>
      <button type="submit" data-t="start" disabled>토론 시작</button>
    </form>
  </section>
  <section id="view-vote" class="panel view" aria-labelledby="vote-title" hidden>
    <h2 id="vote-title" data-t="voteTitle">독립 투표</h2>
    <p class="hint" data-t="voteHint"></p>
    <form id="vote-form" class="compose">
      <label><span data-t="passage">지문</span><textarea name="passage" rows="4" maxlength="4000"></textarea></label>
      <label><span data-t="optionsInput">선택지</span><textarea name="options" rows="4" maxlength="2000"></textarea></label>
      <fieldset class="picks"><legend data-t="participants">참여 역할</legend><div data-picks></div></fieldset>
      <p class="estimate" data-estimate></p>
      <button type="submit" data-t="startVote" disabled>투표 시작</button>
    </form>
  </section>
  <section id="view-history" class="panel view" aria-labelledby="history-title" hidden>
    <h2 id="history-title" data-t="historyTitle">기록</h2>
    <label class="check"><input type="checkbox" id="show-archived"><span data-t="showArchived">보관한 기록 보기</span></label>
    <ul id="thread-list" class="thread-list"></ul>
  </section>
  <section id="view-thread" class="panel view" aria-labelledby="thread-title" hidden>
    <button type="button" id="back" data-t="back">목록으로</button>
    <h2 id="thread-title"></h2>
    <p id="thread-meta" class="hint"></p>
    <div id="thread-actions" class="actions"></div>
    <ol id="turns" class="turns"></ol>
    <div id="vote-result" class="vote-result" hidden></div>
    <textarea id="export-text" class="export-text" rows="10" readonly hidden></textarea>
  </section>
  <section id="view-settings" class="panel view" aria-labelledby="settings-title" hidden>
    <h2 id="settings-title" data-t="settings">역할과 모델</h2>
    <p class="hint" data-t="settingsHint"></p>
    <form id="settings-form">
      <div id="roles" class="roles"></div>
      <button type="submit" data-t="save" disabled>저장</button>
    </form>
  </section>
</main>
<p id="notice" role="status" hidden></p>
</body>
</html>
```

`i18n.mjs`에서 `comingSoon` 줄을 ko·en 모두 삭제한다. `style.css`의 `.hint,.soon` 선택자를 `.hint`로 바꾸고 끝에 추가:

```css
.bar{flex-wrap:wrap}
.tabs{display:flex;flex-wrap:wrap;gap:6px}
.tabs button[aria-pressed="true"]{background:var(--frame);color:#fffaf0}
.compose{display:grid;gap:12px}
.compose label{display:grid;gap:4px}
textarea{font:inherit;width:100%;border:2px solid var(--frame);border-radius:6px;padding:8px;background:#fff;resize:vertical}
.picks{margin:0;border:2px solid var(--frame);border-radius:8px;padding:8px 12px}
.picks [data-picks]{display:flex;flex-wrap:wrap;gap:12px}
.compose .pick,.check{display:flex;align-items:center;gap:6px}
.estimate{margin:0;color:var(--muted)}
.thread-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}
.thread-item{width:100%;display:grid;gap:2px;padding:8px 12px;text-align:left;background:#fff}
.thread-item strong{overflow-wrap:anywhere}
.thread-item .meta,.model{color:var(--muted);font-size:.88rem}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.turns{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.turn{min-width:0;border:2px solid var(--frame);border-left-width:8px;border-radius:8px;padding:8px 12px;background:#fff}
.turn p{margin:4px 0;overflow-wrap:anywhere}
.turn-head{font-weight:700}
.turn .text{white-space:pre-wrap}
.mismatch{margin-left:8px;padding:0 6px;border-radius:4px;background:#f3d9a4;color:var(--ink)}
.error{color:var(--critic)}
.sealed{color:var(--muted);font-style:italic}
.remove.armed{background:var(--critic);color:#fff}
.vote-result,.export-text{margin-top:12px}
```

- [ ] **Step 5: 화면 모듈** — `anna/bundle/view.mjs`:

```js
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
  const element = $('#notice');
  element.textContent = text;
  element.hidden = !text;
}

export function renderText() {
  document.documentElement.lang = getLanguage();
  for (const element of document.querySelectorAll('[data-t]')) element.textContent = t(element.dataset.t);
}
```

`anna/bundle/settings-view.mjs` (기존 `app.js` 설정 코드 이동, 언어 저장 중에는 언어 선택을 잠근다):

```js
import {$, node, notice} from './view.mjs';
import {FAMILIES, ROLE_IDS, ROLES, TEMPERAMENTS} from './roles.mjs';
import {getLanguage, setLanguage, t} from './i18n.mjs';

function option(value, label, selected) {
  const element = node('option', '', label);
  element.value = value;
  element.selected = selected;
  return element;
}

function field(label, control) {
  const wrapper = node('label');
  wrapper.append(node('span', '', label), control);
  return wrapper;
}

function select(name, entries) {
  const element = node('select');
  element.name = name;
  element.append(...entries);
  return element;
}

export function renderSettings(ctx) {
  const language = getLanguage();
  const {settings} = ctx;
  $('#roles').replaceChildren(...ROLE_IDS.map(id => {
    const role = settings.roles[id];
    const models = role.model && !settings.seenModels.includes(role.model) ? [role.model, ...settings.seenModels] : settings.seenModels;
    const card = node('fieldset', `role role-${id}`);
    card.dataset.role = id;
    const model = select(`${id}-model`, [
      option('', models.length ? t('noModel') : t('noSeen'), !role.model),
      ...models.map(name => option(name, name, role.model === name)),
    ]);
    model.disabled = !models.length;
    card.append(
      node('legend', '', ROLES[id].name[language]),
      node('p', '', ROLES[id].persona[language]),
      field(t('temperament'), select(`${id}-temperament`, Object.keys(TEMPERAMENTS).map(key => option(key, t(key), role.temperament === key)))),
      field(t('family'), select(`${id}-family`, FAMILIES.map(key => option(key, t(key), role.family === key)))),
      field(t('model'), model),
    );
    return card;
  }));
}

function readRoles() {
  const data = new FormData($('#settings-form'));
  return Object.fromEntries(ROLE_IDS.map(id => [id, {
    temperament: data.get(`${id}-temperament`),
    family: data.get(`${id}-family`),
    model: data.get(`${id}-model`) || '',
  }]));
}

export function mountSettings(ctx) {
  const form = $('#settings-form');
  const submit = form.querySelector('button[type="submit"]');
  const picker = $('#language');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const roles = readRoles();
      ctx.settings = await ctx.store.updateSettings(current => ({...current, roles}));
      renderSettings(ctx);
      notice(t('saved'));
    } catch {
      notice(t('saveFailed'));
    } finally {
      submit.disabled = false;
    }
  });
  picker.addEventListener('change', async () => {
    const previous = getLanguage();
    const roles = readRoles();
    setLanguage(picker.value);
    const language = getLanguage();
    ctx.settings = {...ctx.settings, roles, language};
    ctx.rerender();
    picker.disabled = true;
    try {
      ctx.settings = await ctx.store.updateSettings(current => ({...current, roles, language}));
    } catch {
      picker.value = previous;
      setLanguage(previous);
      ctx.settings = {...ctx.settings, language: previous};
      ctx.rerender();
      notice(t('saveFailed'));
    } finally {
      picker.disabled = false;
    }
  });
  submit.disabled = false;
}
```

`anna/bundle/threads-view.mjs`:

```js
import {$, button, node, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLES, modelMismatch} from './roles.mjs';
import {runThread, skipTurn} from './runner.mjs';
import {canSkip, discussionPlan} from './discussion.mjs';
import {parseBallot, tally, votePlan} from './voting.mjs';
import {exportName, toMarkdown} from './export.mjs';

const PLANS = {discussion: discussionPlan, vote: votePlan};
const when = value => new Date(Number(value) || 0).toLocaleString(getLanguage() === 'en' ? 'en-US' : 'ko-KR');

export function showView(ctx, name) {
  ctx.view = name;
  if (name !== 'thread') ctx.thread = null;
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${name}`;
  for (const tab of document.querySelectorAll('#tabs [data-view]')) tab.setAttribute('aria-pressed', String(tab.dataset.view === name));
}

export function renderHistory(ctx) {
  const archived = $('#show-archived').checked;
  const items = (ctx.threads || []).filter(item => (item.archived === true) === archived);
  const list = $('#thread-list');
  if (!items.length) return list.replaceChildren(node('li', 'empty', t('empty')));
  list.replaceChildren(...items.map(item => {
    const open = button('', () => openThread(ctx, item.id), 'thread-item');
    open.dataset.id = item.id;
    open.append(node('strong', '', item.title), node('span', 'meta', `${t(`kind-${item.kind}`)} · ${t(`status-${item.status}`)} · ${when(item.updated)}`));
    const entry = node('li');
    entry.append(open);
    return entry;
  }));
}

export async function refreshHistory(ctx) {
  try {
    ctx.threads = await ctx.store.listThreads();
  } catch {}
  renderHistory(ctx);
}

export function showThread(ctx, thread) {
  showView(ctx, 'thread');
  ctx.thread = thread;
  renderThread(ctx);
}

export async function openThread(ctx, id) {
  let thread = null;
  try {
    thread = ctx.running?.thread.id === id ? ctx.running.thread : await ctx.store.loadThread(id);
  } catch {}
  if (!thread) return notice(t('openFailed'));
  showThread(ctx, thread);
}

function modelLine(turn) {
  const parts = [`${t('actualModel')}: ${turn.model || t('unknownModel')}`];
  if (turn.requested) parts.push(`${t('requestedModel')}: ${turn.requested}`);
  const element = node('p', 'model', parts.join(' · '));
  if (modelMismatch(turn)) element.append(node('span', 'mismatch', t('mismatch')));
  return element;
}

function turnItem(ctx, thread, turn, index, revealed) {
  const item = node('li', `turn role-${turn.role}`);
  item.dataset.status = turn.status;
  item.dataset.step = turn.step;
  item.append(node('p', 'turn-head', `${t(`step-${turn.step}`)} · ${ROLES[turn.role].name[getLanguage()]} · ${t(`status-${turn.status}`)}`));
  if (turn.status !== 'pending') item.append(modelLine(turn));
  if (thread.kind === 'vote') {
    const ballot = revealed && turn.status === 'done' ? parseBallot(turn.text, thread.options) : null;
    if (ballot) {
      const choice = thread.options.find(option => option.id === ballot.choice);
      item.append(
        node('p', 'choice', choice ? `${choice.id}. ${choice.text}` : t('abstain')),
        node('p', 'text', `${t('reason')}: ${ballot.reason}`),
        node('p', 'text', `${t('concern')}: ${ballot.concern}`),
      );
    } else if (turn.status === 'done') {
      item.append(node('p', 'sealed', t('sealed')));
    }
  } else if (turn.text) {
    item.append(node('p', 'text', turn.text));
  }
  if (turn.error) item.append(node('p', 'error', t(`error-${turn.error}`)));
  if (!ctx.running && (turn.status === 'failed' || turn.status === 'stopped')) {
    const actions = node('div', 'actions');
    actions.append(button(t('retry'), () => run(ctx, thread), 'retry'));
    if (thread.kind === 'vote' || canSkip(turn)) {
      actions.append(button(t('skip'), () => {
        skipTurn(thread, index);
        run(ctx, thread);
      }, 'skip'));
    }
    item.append(actions);
  }
  return item;
}

function renderTally(thread, result) {
  const box = $('#vote-result');
  box.hidden = !result;
  if (!result) return box.replaceChildren();
  const list = node('ul');
  for (const option of thread.options) list.append(node('li', '', `${option.id}. ${option.text} — ${t('votes', {n: result.counts[option.id]})}`));
  list.append(node('li', '', `${t('abstain')} — ${t('votes', {n: result.counts.ABSTAIN})}`));
  box.replaceChildren(node('h3', '', t('resultTitle')), list);
}

function download(thread) {
  const url = URL.createObjectURL(new Blob([toMarkdown(thread, getLanguage())], {type: 'text/markdown'}));
  const link = node('a');
  link.href = url;
  link.download = exportName(thread);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(thread) {
  const text = toMarkdown(thread, getLanguage());
  try {
    await navigator.clipboard.writeText(text);
    notice(t('copied'));
  } catch {
    const area = $('#export-text');
    area.value = text;
    area.hidden = false;
    area.select();
    notice(t('copyFailed'));
  }
}

async function archive(ctx, thread) {
  thread.archived = !thread.archived;
  try {
    ctx.threads = await ctx.store.saveThread(thread);
    renderThread(ctx);
  } catch {
    thread.archived = !thread.archived;
    notice(t('saveFailed'));
  }
}

function removeButton(ctx, thread) {
  let armed = false;
  let timer;
  const element = button(t('remove'), async () => {
    if (!armed) {
      armed = true;
      element.textContent = t('confirmRemove');
      element.classList.add('armed');
      timer = setTimeout(() => {
        armed = false;
        element.textContent = t('remove');
        element.classList.remove('armed');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    element.disabled = true;
    try {
      ctx.threads = await ctx.store.deleteThread(thread.id);
      showView(ctx, 'history');
      renderHistory(ctx);
      notice(t('removed'));
    } catch {
      element.disabled = false;
      notice(t('saveFailed'));
    }
  }, 'remove');
  return element;
}

export function renderThread(ctx) {
  const thread = ctx.thread;
  if (!thread || ctx.view !== 'thread') return;
  const running = ctx.running?.thread === thread;
  $('#thread-title').textContent = thread.title;
  $('#thread-meta').textContent = `${t(`kind-${thread.kind}`)} · ${t(`status-${thread.status}`)} · ${when(thread.updated)}`;
  const actions = [];
  if (running) actions.push(button(t('stop'), () => ctx.running.controller.abort(), 'stop'));
  if (!ctx.running && thread.status !== 'done') actions.push(button(t('resume'), () => run(ctx, thread), 'resume'));
  if (!running) {
    actions.push(
      button(t('exportFile'), () => download(thread), 'export'),
      button(t('copy'), () => copy(thread), 'copy'),
      button(thread.archived ? t('unarchive') : t('archive'), () => archive(ctx, thread), 'archive'),
      removeButton(ctx, thread),
    );
  }
  $('#thread-actions').replaceChildren(...actions);
  const result = thread.kind === 'vote' ? tally(thread) : null;
  $('#turns').replaceChildren(...thread.turns.map((turn, index) => turnItem(ctx, thread, turn, index, Boolean(result))));
  renderTally(thread, result);
  $('#export-text').hidden = true;
}

export async function run(ctx, thread) {
  if (ctx.running) return notice(t('busy'));
  const controller = new AbortController();
  ctx.running = {thread, controller};
  notice('');
  let warned = false;
  try {
    const result = await runThread({
      thread,
      plan: PLANS[thread.kind],
      ai: ctx.ai,
      store: ctx.store,
      settings: ctx.settings,
      signal: controller.signal,
      onUpdate: (current, {saveFailed}) => {
        if (saveFailed && !warned) {
          warned = true;
          notice(t('saveRetry'));
        }
        if (ctx.thread === current) renderThread(ctx);
      },
    });
    ctx.settings = result.settings;
    const failed = thread.turns.find(turn => turn.status === 'failed');
    if (failed) notice(t(`error-${failed.error}`));
    else if (result.saveFailed) notice(t('saveRetry'));
  } finally {
    ctx.running = null;
    renderThread(ctx);
    await refreshHistory(ctx);
    ctx.onSettings();
  }
}

export function mountThreads(ctx) {
  $('#show-archived').addEventListener('change', () => renderHistory(ctx));
  $('#back').addEventListener('click', () => {
    showView(ctx, 'history');
    refreshHistory(ctx);
  });
}
```

`anna/bundle/app.js` 전체:

```js
import {AnnaAppRuntime} from '/static/anna-apps/_sdk/latest/index.js';
import {createStore} from './store.mjs';
import {createAi} from './ai.mjs';
import {setLanguage, t} from './i18n.mjs';
import {$, notice, renderText} from './view.mjs';
import {mountSettings, renderSettings} from './settings-view.mjs';
import {mountThreads, refreshHistory, renderHistory, renderThread, showView} from './threads-view.mjs';

const ctx = {view: 'discussion', threads: [], thread: null, running: null};

function rerender() {
  renderText();
  renderSettings(ctx);
  renderHistory(ctx);
  renderThread(ctx);
}

async function main() {
  renderText();
  try {
    const anna = await AnnaAppRuntime.connect();
    ctx.store = createStore(anna.storage);
    ctx.ai = createAi(anna.llm);
    ctx.settings = await ctx.store.loadSettings();
    ctx.rerender = rerender;
    ctx.onSettings = () => renderSettings(ctx);
    setLanguage(ctx.settings.language);
    $('#language').value = ctx.settings.language;
    try {
      ctx.threads = await ctx.store.repairIndex();
    } catch {
      ctx.threads = await ctx.store.listThreads().catch(() => []);
    }
    for (const tab of document.querySelectorAll('#tabs [data-view]')) {
      tab.addEventListener('click', () => {
        showView(ctx, tab.dataset.view);
        if (tab.dataset.view === 'history') refreshHistory(ctx);
      });
    }
    mountSettings(ctx);
    mountThreads(ctx);
    rerender();
    showView(ctx, 'discussion');
    anna.window.set_title({title: 'Agent Hub Radio'}).catch(() => {});
    document.body.dataset.ready = 'true';
  } catch {
    notice(t('loadFailed'));
  }
}

main();
```

- [ ] **Step 6: 통과 확인** — `npm test`, `npm run test:browser`(설정 8개 + 기록 9개), `npm run validate` 모두 통과. 다운로드 테스트가 CSP나 브라우저 정책으로 실패하면 원인을 보고서에 적고, 구현을 바꾸기 전에 컨트롤러에게 알린다.
- [ ] **Step 7: 커밋** — `git add anna/bundle/view.mjs anna/bundle/settings-view.mjs anna/bundle/threads-view.mjs anna/bundle/app.js anna/bundle/index.html anna/bundle/style.css anna/bundle/i18n.mjs anna/tests/browser/harness.mjs anna/tests/browser/settings.browser.mjs anna/tests/browser/threads.browser.mjs; git commit -m "feat(anna): add tabs, history and thread view with export"`

---

### Task 6: 토론·투표 시작과 실행 흐름

**Files:**
- Create: `anna/bundle/compose-view.mjs`, `anna/tests/browser/runs.browser.mjs`
- Modify: `anna/bundle/app.js`, `anna/tests/browser/mock-sdk.mjs`

**Interfaces:**
- Consumes: Task 5의 `view.mjs`, `threads-view.mjs`(`run`, `showThread`), `createDiscussion`, `discussionSteps`, `createVote`, `newId`.
- Produces: `compose-view.renderPicks()`, `compose-view.mountCompose(ctx)`. 가짜 SDK의 `llm.stream`과 고장 스위치 `faults.quota`(모든 호출이 사용량 부족 오류), `faults.stallAt = n`(n번째 호출이 첫 토큰 뒤 멈춤). 브라우저 기록 `calls`에 `{method: 'llm.stream', system, text, hints}`.

- [ ] **Step 1: 가짜 SDK** — `mock-sdk.mjs`에서 `const calls = [];` 아래에 `let streams = 0;`를 두고 `llm`을 다음으로 바꾼다(`complete`는 그대로):

```js
  llm: {
    async complete() {
      calls.push({method: 'llm.complete'});
      throw Object.assign(new Error('AI disabled in UI tests'), {code: 'llm_disabled'});
    },
    stream(request) {
      const n = ++streams;
      calls.push({method: 'llm.stream', system: request.systemPrompt, text: request.messages?.[0]?.content?.text || '', hints: request.modelPreferences?.hints || []});
      const reply = /JSON/.test(request.systemPrompt) ? '{"choice":"A","reason":"가까워요","concern":"없음"}' : `응답 ${n}`;
      return (async function* () {
        await null;
        if (faults.quota) {
          yield {event: 'error', code: 'APP_QUOTA_EXCEEDED', message: 'quota exceeded'};
          return;
        }
        yield {event: 'model_token', text: reply.slice(0, 3)};
        if (faults.stallAt === n) await new Promise(() => {});
        yield {event: 'complete', content: {text: reply}, model: 'mock/gemini-test'};
      })();
    },
  },
```

- [ ] **Step 2: 실패 테스트** — `anna/tests/browser/runs.browser.mjs`:

```js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setup, ready, openTab} from './harness.mjs';

const llm = page => page.evaluate(() => window.hostTest.calls.filter(c => c.method === 'llm.stream'));
const meta = (page, pattern) => page.waitForFunction(source => new RegExp(source).test(document.querySelector('#thread-meta').textContent), pattern.source);
const fault = (page, values) => page.evaluate(values => Object.assign(window.hostTest.faults, values), values);

async function discuss(page, text = '점심 메뉴를 정해 줘') {
  await page.fill('#discussion-form textarea[name="request"]', text);
  await page.click('#discussion-form button[type="submit"]');
}

async function vote(page) {
  await openTab(page, 'vote');
  await page.fill('#vote-form textarea[name="passage"]', '점심은 무엇으로?');
  await page.fill('#vote-form textarea[name="options"]', '짜장\n짬뽕');
  await page.click('#vote-form button[type="submit"]');
}

test('a discussion runs nine turns and records the actual model', async t => {
  const page = await setup(t);
  await ready(page);
  assert.equal(await page.locator('#discussion-form [data-estimate]').textContent(), 'AI 호출 9회 예정');
  await discuss(page);
  await meta(page, /완료/);
  assert.equal((await llm(page)).length, 9);
  assert.equal(await page.locator('#turns .turn[data-status="done"]').count(), 9);
  for (const text of await page.locator('#turns .turn .model').allTextContents()) assert.match(text, /mock\/gemini-test/);
  assert.deepEqual(await page.evaluate(() => window.hostTest.state.kv.settings.seenModels), ['mock/gemini-test']);
  await openTab(page, 'settings');
  assert.equal(await page.locator('select[name="analyst-model"]').isDisabled(), false);
  await openTab(page, 'history');
  assert.match(await page.locator('.thread-item').first().textContent(), /점심 메뉴를 정해 줘.*토론 · 완료/);
});

test('first-round opinions are independent', async t => {
  const page = await setup(t);
  await ready(page);
  await discuss(page);
  await meta(page, /완료/);
  const calls = await llm(page);
  assert.doesNotMatch(calls[1].text, /응답 1/);
  assert.doesNotMatch(calls[2].text, /응답 [12]/);
  assert.match(calls[3].text, /응답 1[\s\S]*응답 2[\s\S]*응답 3/);
  assert.match(calls[0].system, /분석가/);
});

test('a requested family that Anna did not use is flagged', async t => {
  const settings = {version: 1, language: 'ko', detail: false, roles: {critic: {temperament: 'deep', family: 'claude', model: ''}}, seenModels: []};
  const page = await setup(t, {kv: {settings}});
  await ready(page);
  await discuss(page);
  await meta(page, /완료/);
  const calls = await llm(page);
  assert.deepEqual(calls[1].hints, [{name: 'claude'}]);
  assert.deepEqual(calls[0].hints, []);
  assert.equal(await page.locator('#turns .turn.role-critic .mismatch').count(), 3);
  assert.equal(await page.locator('#turns .turn.role-analyst .mismatch').count(), 0);
});

test('a quota failure explains the problem and can be retried', async t => {
  const page = await setup(t, {faults: {quota: true}});
  await ready(page);
  await discuss(page);
  await meta(page, /실패/);
  assert.match(await page.locator('#notice').textContent(), /사용량이 부족해요/);
  assert.equal(await page.locator('#turns .turn').first().getAttribute('data-status'), 'failed');
  await fault(page, {quota: false});
  await page.click('#turns .turn button.retry');
  await meta(page, /완료/);
  assert.equal((await llm(page)).length, 10);
});

test('stopping keeps the partial reply and a reopened thread resumes without repeating turns', async t => {
  const page = await setup(t, {faults: {stallAt: 2}});
  await ready(page);
  await discuss(page);
  await page.waitForSelector('#turns .turn[data-status="running"] .text');
  await page.click('#thread-actions button.stop');
  await meta(page, /중단됨/);
  const stopped = page.locator('#turns .turn').nth(1);
  assert.equal(await stopped.getAttribute('data-status'), 'stopped');
  assert.match(await stopped.locator('.text').textContent(), /응답/);
  await page.reload();
  await ready(page);
  await fault(page, {stallAt: 0});
  await openTab(page, 'history');
  assert.match(await page.locator('.thread-item').first().textContent(), /중단됨/);
  await page.locator('.thread-item').first().click();
  await page.click('#thread-actions button.resume');
  await meta(page, /완료/);
  assert.equal((await llm(page)).length, 8);
});

test('vote ballots stay sealed until every role has voted', async t => {
  const page = await setup(t, {faults: {stallAt: 3}});
  await ready(page);
  await vote(page);
  await page.waitForSelector('#turns .turn:nth-child(3)[data-status="running"]');
  assert.equal(await page.locator('#turns .turn .sealed').count(), 2);
  assert.equal(await page.locator('#turns .turn .choice').count(), 0);
  assert.equal(await page.locator('#vote-result').isHidden(), true);
  await page.click('#thread-actions button.stop');
  await meta(page, /중단됨/);
  await fault(page, {stallAt: 0});
  await page.click('#thread-actions button.resume');
  await meta(page, /완료/);
  assert.match(await page.locator('#vote-result').textContent(), /A\. 짜장 — 3표/);
  assert.equal(await page.locator('#turns .turn .choice').count(), 3);
});

test('a failed ballot can be skipped and the rest still count', async t => {
  const page = await setup(t, {faults: {quota: true}});
  await ready(page);
  await vote(page);
  await meta(page, /실패/);
  await fault(page, {quota: false});
  await page.click('#turns .turn button.skip');
  await meta(page, /완료/);
  assert.equal(await page.locator('#turns .turn').first().getAttribute('data-status'), 'skipped');
  assert.match(await page.locator('#vote-result').textContent(), /A\. 짜장 — 2표/);
});

test('starting checks the text, the roles and the options', async t => {
  const page = await setup(t);
  await ready(page);
  await page.click('#discussion-form button[type="submit"]');
  assert.equal(await page.locator('#notice').textContent(), '내용을 입력해 주세요.');
  await page.fill('#discussion-form textarea[name="request"]', '질문');
  await page.uncheck('#discussion-form input[name="roles"][value="critic"]');
  await page.uncheck('#discussion-form input[name="roles"][value="editor"]');
  assert.match(await page.locator('#discussion-form [data-estimate]').textContent(), /두 개 이상/);
  await page.click('#discussion-form button[type="submit"]');
  assert.equal(await page.locator('#notice').textContent(), '토론에는 역할이 두 개 이상 필요해요.');
  await openTab(page, 'vote');
  await page.fill('#vote-form textarea[name="passage"]', '지문');
  await page.fill('#vote-form textarea[name="options"]', '하나뿐');
  await page.click('#vote-form button[type="submit"]');
  assert.equal(await page.locator('#notice').textContent(), '선택지를 두 개 이상 적어 주세요.');
  assert.deepEqual(await llm(page), []);
});

test('an English discussion asks the roles in English', async t => {
  const page = await setup(t, {kv: {settings: {version: 1, language: 'en', detail: false, roles: {}, seenModels: []}}});
  await ready(page);
  assert.equal(await page.locator('#discussion-form [data-estimate]').textContent(), '9 AI calls planned');
  await discuss(page, 'Pick lunch');
  await page.waitForFunction(() => /Done/.test(document.querySelector('#thread-meta').textContent));
  assert.match((await llm(page))[0].system, /Answer in English/);
});

test('a finished discussion fits a 360px screen', async t => {
  const page = await setup(t, {viewport: {width: 360, height: 740}});
  await ready(page);
  await discuss(page);
  await meta(page, /완료/);
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= 360));
});
```

- [ ] **Step 3: 실패 확인** — `npm run test:browser`. 기대: `runs.browser.mjs`가 제출 버튼 비활성·참여 역할 없음으로 실패. 기존 17개는 통과.

- [ ] **Step 4: 구현** — `anna/bundle/compose-view.mjs`:

```js
import {$, node, notice} from './view.mjs';
import {getLanguage, t} from './i18n.mjs';
import {ROLE_IDS, ROLES} from './roles.mjs';
import {createDiscussion, discussionSteps} from './discussion.mjs';
import {createVote} from './voting.mjs';
import {newId} from './runner.mjs';
import {run, showThread} from './threads-view.mjs';

const forms = () => [$('#discussion-form'), $('#vote-form')];
const picked = form => [...form.querySelectorAll('input[name="roles"]:checked')].map(input => input.value);

function estimate() {
  const discussion = $('#discussion-form');
  const roles = picked(discussion);
  discussion.querySelector('[data-estimate]').textContent = roles.length < 2 ? t('needRoles') : t('estimate', {n: discussionSteps(roles).length});
  const vote = $('#vote-form');
  const voters = picked(vote);
  vote.querySelector('[data-estimate]').textContent = voters.length ? t('estimate', {n: voters.length}) : t('needRole');
}

export function renderPicks() {
  for (const form of forms()) {
    const box = form.querySelector('[data-picks]');
    const chosen = box.children.length ? picked(form) : ROLE_IDS;
    box.replaceChildren(...ROLE_IDS.map(id => {
      const input = node('input');
      input.type = 'checkbox';
      input.name = 'roles';
      input.value = id;
      input.checked = chosen.includes(id);
      const label = node('label', `pick role-${id}`);
      label.append(input, node('span', '', ROLES[id].name[getLanguage()]));
      return label;
    }));
  }
  estimate();
}

async function start(ctx, thread, form) {
  if (ctx.running) return notice(t('busy'));
  try {
    ctx.threads = await ctx.store.saveThread(thread);
  } catch {
    return notice(t('saveFailed'));
  }
  for (const area of form.querySelectorAll('textarea')) area.value = '';
  showThread(ctx, thread);
  await run(ctx, thread);
}

export function mountCompose(ctx) {
  for (const form of forms()) form.addEventListener('change', estimate);
  $('#discussion-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const request = form.elements.request.value;
    const roles = picked(form);
    if (!request.trim()) return notice(t('needText'));
    if (roles.length < 2) return notice(t('needRoles'));
    start(ctx, createDiscussion({id: newId(), request, roles, language: getLanguage(), detail: form.elements.detail.checked}), form);
  });
  $('#vote-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const passage = form.elements.passage.value;
    const options = form.elements.options.value.split('\n').map(line => line.trim()).filter(Boolean);
    const roles = picked(form);
    if (!passage.trim()) return notice(t('needText'));
    if (options.length < 2) return notice(t('needOptions'));
    if (!roles.length) return notice(t('needRole'));
    start(ctx, createVote({id: newId(), passage, options, roles, language: getLanguage()}), form);
  });
  for (const form of forms()) form.querySelector('button[type="submit"]').disabled = false;
}
```

`app.js`: import에 `import {mountCompose, renderPicks} from './compose-view.mjs';`를 추가하고, `rerender()`의 `renderSettings(ctx);` 다음 줄에 `renderPicks();`, `main()`의 `mountThreads(ctx);` 다음 줄에 `mountCompose(ctx);`를 추가한다.

- [ ] **Step 5: 통과 확인** — `npm test`, `npm run test:browser`(27개), `npm run validate` 모두 통과. 같은 브라우저 테스트를 3회 반복해 불안정하지 않은지 확인한다.
- [ ] **Step 6: 커밋·푸시** — `git add anna/bundle/compose-view.mjs anna/bundle/app.js anna/tests/browser/mock-sdk.mjs anna/tests/browser/runs.browser.mjs; git commit -m "feat(anna): start, stop, retry and resume discussions and votes"; git push origin release-anna`. `gh run list --branch release-anna -L 4`로 새 head의 "Anna app"·"Tests" 실행을 찾고 `gh run watch <id> --exit-status`로 성공을 확인한다.

---

### Task 7: 문서와 Anna 소유자 테스트 배포 (컨트롤러가 직접 수행)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-anna-app-design.md`
- Create: `anna/HANDOFF.md`, `anna/RELEASE_040.md`

이 Task는 Anna 로그인과 실제 설치 확인이 필요하므로 서브에이전트가 아니라 컨트롤러가 수행한다. AI 호출(토론·투표 실행)은 하지 않는다.

- [ ] **Step 1: 설계 문서 수정** — "3명이면 8회"를 "3명이면 9회"로 고친다. 저장 구조 절의 분할(`thread/<id>/<n>`)은 0.4.0에서 구현하지 않았고, 발언당 8000자 상한만 두었다고 적는다.
- [ ] **Step 2: 배포 전 확인** — `cd anna; npm ci; npm test; npm run test:browser; npm run validate`. 모두 통과해야 한다.
- [ ] **Step 3: 계정 확인** — `npx anna-app apps list`. 로그인되어 있지 않으면 사용자에게 `npx anna-app login --host https://anna.partners` 기기 인증을 요청하고 멈춘다(자격 증명을 대신 입력하지 않는다).
- [ ] **Step 4: 업로드** — `npx anna-app apps push --dry-run`으로 대상(slug `agent-hub-radio`, 새 앱)을 확인한 뒤 `npx anna-app apps push --no-install-local`. 결과의 working revision을 기록한다.
- [ ] **Step 5: 버전 고정** — `npx anna-app apps cut 0.4.0`, 이어서 `npx anna-app apps status agent-hub-radio`, `npx anna-app apps versions agent-hub-radio`, `npx anna-app apps grants agent-hub-radio`로 상태·버전·권한(llm, storage, window)을 확인한다. `submit-review`, `release`는 실행하지 않는다.
- [ ] **Step 6: 설치 확인** — Anna 대시보드에서 소유자로 설치해 실행한다. AI를 쓰지 않는 범위에서 확인: 앱 연결, 네 탭 전환, 설정 저장·재접속 후 유지, 기록 탭이 빈 목록으로 열림, 콘솔 CSP 오류 없음. 가능하면 이 과정에서 `storage.list` 응답 형태(`items/next_cursor` 또는 `entries/cursor`)와 `llm.stream` 권한 선언 필요 여부를 확인한다. 설치가 막히면 막힌 단계와 오류 메시지(토큰·IP 제외)를 기록하고 "배포 완료"로 보고하지 않는다.
- [ ] **Step 7: 기록** — `anna/RELEASE_040.md`: 버전 0.4.0, 브랜치 커밋, 기능 목록, 자동 검증 수(단위·브라우저·strict·CI 실행 번호), 남은 제한(실제 AI 미검증, 중지해도 서버 쪽 `llm.complete` 대체 호출은 계속 진행될 수 있음, 기록 분할 미구현, 문서 작업·사무실은 3단계). `anna/HANDOFF.md`: 배포한 앱 버전, working revision, 설치 확인 결과, 보류 검증 목록(설계 문서 "보류 검증" 절), 다음 단계.
- [ ] **Step 8: 커밋·푸시** — `git add docs/superpowers/specs/2026-10-15-anna-app-design.md anna/HANDOFF.md anna/RELEASE_040.md; git commit -m "docs(anna): record 0.4.0 owner test deployment"; git push origin release-anna`. CI 성공 확인.

## 2단계 완료 기준

- 단위·브라우저·strict 검사와 Windows/Ubuntu CI가 모두 통과한다.
- 가짜 AI로 토론 9회 호출, 독립 의견 분리, 실제 모델 표시와 불일치 표시, 사용량 부족 안내와 재시도, 중지 후 재접속 이어하기, 투표 비공개와 집계, 역할 건너뛰기, Markdown 저장·복사 대체, 보관·삭제, 색인 복구, 360px 폭이 테스트로 확인된다.
- `agent-hub-radio` 0.4.0이 Anna에 소유자 테스트 앱으로 올라가 설치·실행이 확인되었거나, 막힌 지점이 `anna/HANDOFF.md`에 기록되어 있다.
