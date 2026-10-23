# Agent Hub Radio 인수인계

## 현재 상태 — 0.8.0 (2026-10-23)

- 앱 `agent-hub-radio` / app ID **561**, 브랜치 `release-anna`, 배포 코드 **`145cd06`**.
- **UI 0.8.0**, working revision **8**, bundle **ready**, **27파일 / 169,860 bytes**.
- Content hash: `c872e5da617798a601bf2bb2de8f49f43aaa5da01f9ec42818d6815ea9657ba9`.
- 소유자 Install draft를 완료하고 실제 설치 경로 `/anna-apps/kdkrkwhr/agent-hub-radio/0.0.0-draft/index.html`에서 버전·언어 전환·재접속을 확인했다. Executa 패키지는 없다.
- immutable 최신 cut **0.6.0 / ID 1391**, `status=draft`, `review_candidate_version=null`, 공개 버전 없음. **0.8.0 cut·심사·공개 출시는 하지 않았다. 첫 심사는 1.0.0이다.**

### 변경 및 검증

- 새 사용자·잘못된 언어 값은 **영어 기본값**이다. 저장된 한국어 등 유효한 선택은 유지한다. 모델 설정에서 **English / 한국어 / 简体中文 / 日本語**를 고른다.
- UI·역할·도움말·오류·사무실·예시·날짜·Markdown 내보내기와 새 요청 프롬프트를 네 언어로 지원한다. 기존 응답은 번역하거나 덮어쓰지 않으며 중단 기록은 시작할 때의 언어로 재개한다. 언어만 바꾸면 AI를 호출하지 않는다.
- **단위 101개 / 브라우저 58개 / strict validation 통과**. [Anna Windows·Ubuntu CI](https://github.com/kdkrkwhr/agent-hub/actions/runs/39883564320)와 [로컬 제품 6개 환경 CI](https://github.com/kdkrkwhr/agent-hub/actions/runs/39883564244)도 모두 성공했다.
- 실제 설치본에서 네 언어의 역할명·동작·사무실 표기, 입력 초안과 완료 응답 보존, 새로고침 후 원래 한국어 복원을 확인했다. 실제 내부 폭 1178px에서 가로 넘침이 없었다. 26개 정적 파일의 SHA-256이 로컬과 일치한다. HTML은 별도 fetch 403 때문에 정상 탐색으로 로드한 DOM·실제 화면으로 확인했다.
- 배포 전 **12개 APS 행의 값·ETag 보존**, **6개 채널 / 5개 기록** 유지. 실제 언어 전환과 복원으로 언어 변경 행 6개만 추가됐다. 유효 모델 설정과 원래 한국어 선택은 배포 전과 같다. 이번 검증에서 **새 AI 요청은 없었다**.
- 등록정보 7개 필드가 로컬과 일치하고 공개 안내·문의·데이터 처리 링크와 기존 스크린샷 4장 URL의 HTTP 200을 확인했다. 기존 0.7.1 캡처는 촬영 버전을 명시한 상태로 유지한다.

근거·제한은 [VALIDATION_080.md](VALIDATION_080.md), 변경 사항은 [RELEASE_080.md](RELEASE_080.md). 중국어·일본어 실제 모델 응답 품질 및 원어민 감수, 별도 계정 격리, 실제 모바일 호스트 검증은 수행하지 않았다.

Git 제외 증거는 `runtime/review-plan/`의 `snapshot-080-*.json`, `push-080-result.json`, `install-080-result.json`, `ui-080-result.json`, `reopened-080.json`, `installed-hashes-080.json`, `installed-080-visible.png`, 테스트 로그다. 검증용 Orca 페이지는 `67306e7b-3dbe-4cf0-88cc-58a5925c9f64`이다. 기존 0.7.1 탭의 미전송 입력과 NoteBuddy 데이터·배포는 건드리지 않았다.


## 이전 배포 — 0.7.1 (2026-10-22)

- 앱 `agent-hub-radio` / app ID **561**, 브랜치 `release-anna`, 배포 코드 **`c41bd7a`** (주요 구현 `8396323`).
- **UI 0.7.1**, working revision **7**, bundle **ready**, 24파일 / **141,051 bytes**.
- Content hash: `2fa666a2d82a89579ad92bc70c1f22393f322149ea704f44751ce5fae13a0108`.
- 소유자 **Install draft** 후 실제 `/anna-apps/kdkrkwhr/agent-hub-radio/0.0.0-draft/index.html`에서 v0.7.1, 최신 기록 새로고침 성공 안내, 기존 결과·모델 설정 및 MD 저장을 확인했다.
- immutable 최신 cut은 **0.6.0 / ID 1391** 그대로다. `status=draft`, `is_published=false`, `review_candidate_version=null`. **cut·심사 제출·공개 출시를 하지 않았다. 첫 심사는 1.0.0이다.**

### 변경 및 검증

- 개별 기록+목록 메타데이터의 원자적 저장, ETag 조건부 수정·삭제, 새 채널 독립 저장, 필드별 설정 변경 기록을 적용했다. 기존 본문·채널·설정은 보존한다. 구버전은 새 채널·설정 형식을 모르므로 임의 다운그레이드하지 않는다.
- 실제 APS에서 **256 KiB/행** 제한, UTF-8 바이트 계산, 오래된 ETag의 HTTP 412 거부를 확인했다. 최대 한국어 심층 기록 **229,158 bytes** 저장·복원에 성공했다. 앱은 248 KiB 경계를 안내하고 후속 AI를 멈춘다.
- 다른 창에서 진행 중인 기록을 열어도 서버에 중단 상태를 덮지 않는다. 최대 150초 실행 소유권으로 중복 시작을 막고, 충돌 시 답변 복사와 최신 기록 불러오기를 제공한다. 저장만 재시도에는 AI를 호출하지 않는다.
- **단위 95개 / 브라우저 51개 / strict validation 통과**. 실제 설치 검증에서 발견한 복구 후 오래된 경고 문구를 고친 뒤 관련 브라우저 4개+i18n 3개와 strict validation을 다시 통과했다.
- 실제 심층 토론 **9개 응답 완료**: 2개 완료 후 중단 → 앱 다시 열기 → 완료한 2개 원문 유지 → 나머지 7개 재개. 실제 모델은 `google/gemini-3-flash-preview`, 최종안과 동료 검토 2개를 확인했다.
- 실제 Anna 두 탭에서 동일한 중단 기록을 재개했을 때 첫 창만 진행하고 두 번째는 `busy` 안내로 멈췄다. 첫 창 완료 후 최신 기록을 불러와 두 번째 창에서도 9개 응답을 확인했다.
- GPT 계열 정리자 1인 투표는 당시 계정의 모델 가용성 문제로 `provider` 오류를 표시하고 중단했다. 자동 재시도하지 않았다. 정리자 설정은 원래 **fast / gpt**로 복원했으므로 같은 오류가 나면 자동 또는 사용 가능한 모델을 선택해야 한다.
- 실제 Markdown 다운로드 **10,305 bytes**, 모델 표기 9개·동료 검토·실패한 모델 검증 기록 모두 포함. 실제 내부 폭 1,178px 가로 넘침 없음. 360px 검증은 모의 브라우저다.
- 새 테스트 채널 **0.7.1 안정성 검증** (`78e0f57a-8c1c-47f4-993b-bf936d220af4`). 심층 기록 `e1c1c032-8ce4-4b7f-adeb-ee97944589cf`, 모델 오류 기록 `d1d7b916-49e5-439b-b819-6921ea5977d7`. 기존 기록 3개와 채널 4개에 이 기록 2개·채널 1개만 추가됐다.

실제 AI 검증은 revision 6에서, 경고 해제만 수정한 최종 설치 확인은 revision 7에서 수행했다. 실제 두 계정 격리·서버 생성 취소/과금은 확인하지 않았다. [검증 근거·제한](VALIDATION_071.md), [변경 사항](RELEASE_071.md), [사용자 안내](README.md)를 참고한다.

Git 제외 증거는 `runtime/review-plan/`에 있다: `live-storage-071.json`, `installed-071.json`, `anna-071-final.png`, `installed-export-071.md`, 테스트 로그. 마지막 테스트 앱은 Orca 페이지 `70540d87-7654-4b7c-83de-3e8fee57ac31`에 열려 있다. 기존 NoteBuddy 데이터·설치는 변경하지 않았다.

### 소개 자료 준비 및 Anna 등록정보 동기화 (2026-10-22)

- 자료 커밋 **`8969f22`**를 `origin/release-anna`에 푸시했다. 한·영 사용자 안내, 한·영 데이터 처리 안내, 스토어 소개, 심사자 테스트 순서를 작성했다. [사용자 안내](README.md), [스토어 원고](store/LISTING.md), [심사 메모](store/REVIEW_NOTES.md).
- 실제 설치된 0.7.1에서 **1178 × 750 PNG 4장**을 직접 촬영했다: 예시 입력, 결정 요약, 완료 투표, 완료 후 사무실. 0.7.0에서 만든 실제 결과를 보존된 기록으로 열었으며, 이번에는 추가 AI 호출을 하지 않았다. [이미지·촬영 근거](store/screenshots/README.md).
- 촬영용 빈 채널 **나의 첫 출시** (`2a1d6b59-1c64-4fe2-9a24-7ba4d54fe7ec`)를 하나 추가하고 예시만 채웠다. 기존 채널·5개 기록·역할 모델 설정은 변경하지 않았다. 앱 내부 창 높이는 캡처 시 750px로 조절했다.
- 공식 CLI `runAppsSyncMeta`로 영문 소개, 안내·문의·데이터 처리 링크와 스크린샷 4장을 Anna 등록정보에 반영했다. API 재조회에서 7개 텍스트/링크 필드가 로컬과 일치했고, 이미지 URL 4개의 순서와 HTTP 200을 확인했다. Developer Console의 Listing에서도 새 설명과 4개 URL을 확인했다.
- **strict validation, 등록정보 dry-run, 내부 파일 링크 42개 검사 통과**. 공개 안내·데이터 처리·문의 링크 HTTP 200, 이미지 4장 시각 확인과 CDN 변환본 확인 완료. UI 코드 변경이 없어 단위·브라우저 전체 테스트는 반복하지 않았다.
- 번들·manifest는 변경하지 않았다. 실제 서버의 **revision 7 / ready / 기존 hash** 유지, 최신 cut **0.6.0 / 1391**, `draft`, `is_published=false`, `review_candidate_version=null`을 재확인했다. **1.0 후보 생성·심사 제출·공개 출시는 하지 않았다.**
- 로컬 확인 결과: `runtime/review-plan/listing-verification.json`, `listing-cdn-*.webp`. 등록정보 확인용 Orca 페이지: `0081a25d-db25-4193-840a-4c1de40945bf`.

## 배포 순서

```powershell
cd anna
npm test
npm run test:browser
npm run validate
# 검증 성공 후 Git 커밋·푸시한다.
# 현재 working revision을 확인하고 앱 테스트 draft만 갱신한다.
# anna-app apps push --no-install-local --if-match <현재 revision>
```

스토어 아이콘과 등록 정보는 번들과 별개다. `app.json`(`logo_file: store/logo.jpg`)을 고친 뒤 `npx anna-app apps sync-meta --dry-run`으로 확인하고 `npx anna-app apps sync-meta`로 올린다.

그다음 Developer Console 또는 `POST /api/v1/developer/apps/561/working/install`로 소유자 설치를 하고, 대시보드에서 앱을 열어 실제 화면을 확인한다. `npx anna`는 다른 공개 패키지이므로 쓰지 않는다. `anna/.anna/`는 CLI가 만드는 로컬 파일이라 커밋하지 않는다.

테스트 배포에서 `apps cut`, `submit-review`, `publish`는 실행하지 않는다. `apps push`만으로 설치 앱이 바뀌었다고 판단하지 않는다.

이 환경(Node 24.14.1 / CLI 0.1.57)에서 `anna-app apps push --dry-run`은 종료 시 libuv assertion으로 실패했다. 패키지 내부의 동일한 `runAppsPush` 함수를 호출하고 `process.exitCode`로 자연 종료시켜 dry-run과 업로드를 완료했다. 0.7.0에는 `ifMatch:4`를 사용했다. 0.7.1 업로드는 `ifMatch:5` → revision 6, 표시 수정 후 `ifMatch:6` → revision 7로 진행했다. 0.8.0에는 `ifMatch:7`로 revision 8을 올렸다. 각 최종 설치본의 실제 화면까지 대조했다. 이 우회는 로컬 실행용이며 제품 의존성이나 인증 방식을 변경하지 않았다.

Orca에서는 `orca tab switch --page <id> --focus`로 실제 탭을 보이게 한 뒤 캡처한다. 배경 탭의 캡처가 전환 애니메이션에 멈춘 사례가 있었다. UI DOM·실제 화면을 모두 확인하고, iframe URL에는 단기 인증값이 있으므로 경로만 기록한다.

## 남은 일

- 설치형 방향 (2026-10-23 추가 요청): 사용자가 **Windows와 macOS 모두**에서 Claude Code·Codex·Cursor를 연결하는 로컬 에이전트 허브를 원한다. 기존 Python·SQLite·CLI 연결을 재사용하고 공통 전용 창, 실행 환경 패키징, 설치·제거, 창 종료 시 소유 프로세스 정리를 구현한다. 목표는 Windows `.exe` 설치 프로그램과 **Apple Silicon(arm64)·Intel(x86_64) Mac 각각의 `.app`/`.dmg`**다. 현재 `--desktop`은 Windows에서 Edge 앱 창, Mac에서 일반 브라우저를 여는 수준이며 설치 파일은 아직 없다. Anna판과 로컬판의 버전·저장·AI 연결을 구분한다.
- Mac 추가 검증 범위: Finder에서 실행해도 CLI를 찾을 수 있도록 PATH와 실행 파일 직접 지정 지원을 점검한다. GUI 앱은 셸의 PATH를 그대로 상속하지 않을 수 있다. 한글·공백 경로, `~/Library/Application Support/AgentHub` 데이터 보존, Cmd 단축키, 창 닫기·앱 종료·재실행, 작업 프로세스 종료, 각 CPU용 Python 및 필요한 Java/Coral 실행 환경을 확인한다. 기존 macOS Python CI 성공은 설치 앱이나 실제 CLI 인증 검증을 대신하지 않는다.
- 설치 빌드는 Windows와 macOS CI에서 각각 수행하고, 두 Mac CPU에 맞는 의존성을 포함한다. 공개 Mac 배포 전 Developer ID 서명·notarization을 준비한다. 인증서·개발자 계정 설정과 실제 Mac 설치·실행 검증은 아직 수행하지 않았다. [macOS 앱 및 GUI PATH](https://v2.tauri.app/distribute/macos-application-bundle/), [DMG 배포](https://v2.tauri.app/distribute/dmg/), [서명·notarization](https://v2.tauri.app/distribute/sign/macos/)은 패키징 후보 기술의 공식 참고 자료이며, Tauri 채택이나 구현 완료를 뜻하지 않는다.
- 외부 사용자 3~5명의 가치·재사용 의향 검증은 사용자의 요청으로 보류한다. 단일 AI보다 낫다고 아직 주장하지 않는다.
- 별도 로그인 계정으로 첫 사용과 실제 계정 간 데이터 격리를 확인한다. 이번에는 두 번째 계정이 없어 권한(app/self) 검토와 모의 첫 사용, 같은 계정 두 탭 검증까지 수행했다.
- 소개·안내·심사 재현 메모는 0.8.0 다국어 지원을 반영했다. 실제 소개 캡처는 촬영 버전이 명시된 0.7.1 자료를 유지한다. 최종 1.0 후보와 자료를 대조하고, 새 지시로 **1.0.0** 후보 생성·제출을 진행한다. 0.x에서 제출하지 않는다.
- 실제 사용 중 quota 소진은 의도적으로 만들지 않았다. 모의 테스트는 통과했으나 서버 측 취소와 정확히 한 번 과금은 보장하지 않는다. 연결 종료 후 재개 전 미완료 요청 안내를 유지한다.
- 재설치 후에는 대시보드를 새로 불러와 현재 앱 창을 확인한다. Orca의 닫힘 애니메이션 중 이전 iframe이 DOM에 남을 수 있어 첫 iframe이 현재 런타임이라고 가정하지 않는다. 이번 오래된 종료 창의 timeout은 정상 활성 앱 오류로 집계하지 않았다.
- 이전부터 있던 사용자 파일 `.claude/`, `skills-lock.json`은 변경·커밋하지 않았다. 오래된 인수인계는 [HANDOFF_HISTORY.md](HANDOFF_HISTORY.md)에 보존한다.
