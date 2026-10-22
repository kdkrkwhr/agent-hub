# Agent Hub Radio 인수인계

## 현재 상태 — 0.7.1 (2026-10-22)

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

## 이전 배포 — 0.7.0 (2026-10-22)

- 앱 `agent-hub-radio` / app ID **561**, 브랜치 `release-anna`, 배포 코드 커밋 **`2b07165`**.
- **UI 0.7.0**, working revision **5**, bundle **ready**, 24개 파일 / 129,865 bytes.
- Content hash: `7abcfc9fe18aad77eefc2a2ea18b0ce6beb3863dc097f37b214d99e904d17c3c`.
- Console의 **Install draft** 실행 후 Orca의 실제 설치 경로 `/anna-apps/kdkrkwhr/agent-hub-radio/0.0.0-draft/index.html`에서 **v0.7.0**과 새 기능을 확인했다.
- 최신 immutable cut은 **0.6.0 / version ID 1391** 그대로다. 서버 상태 `draft`, `is_published=false`, `review_candidate_version=null`. **0.7.0 cut·심사·공개 출시를 하지 않았다. 첫 심사는 1.0.0으로 진행한다.**
- 앱 설명·태그라인·Anna 안내 링크도 동기화했다. 공개 GitHub 안내 링크 HTTP 200을 확인했다.

### 실제 설치 검증

- 새 채널 **0.7 출시 검토 테스트**에 빠른 검토 1건과 독립 투표 1건을 UI에서 실행했다. 정상 완료된 응답은 총 7개이며 실제 모델은 `google/gemini-3-flash-preview`였다.
- 빠른 검토는 의견 3개+최종안 1개, 결과는 5개 항목으로 표시됐다. 투표는 1/3 제출 중 선택이 비공개였고, 완료 후 A 3표 / B 0표 / C 0표 / 기권 0표였다.
- 요약 복사 성공 및 클립보드의 결과 텍스트를 확인했다. **MD 저장**으로 `agent-hub-channel-mvitcg7u-dgluzg.md`(6,945 bytes)를 Downloads에 내려받아 토론·투표·실제 모델을 확인했다.
- 앱 창을 닫고 다시 열어 완료 기록 2건, 결정 요약과 기존 채널이 복원되는 것을 확인했다. 자동 재실행은 없었다.
- 사무실/투표실의 3역할과 결과 표시, 실제 설치 창(내부 폭 1,178px)의 가로 넘침 없음을 확인했다. 360px 검증은 모의 브라우저에서 완료했다. 실제 Anna의 좁은 창 캡처는 호스트가 창 크기를 복원해 최종 증거로 사용하지 않는다.
- 기존 데이터는 유지했다. 테스트 동안 정리자 계열만 `gpt` → `auto`로 바꾸고 검증 후 **원래 `gpt`로 복구·저장**했다. 기존 실패 기록에는 GPT 요청의 모델 가용성 오류가 있으므로 같은 오류가 나면 자동 또는 사용 가능한 모델을 선택한다. 이번에 GPT 가용성을 새로 검증하지는 않았다.
- 실제 설치 앱의 저장 장애는 의도적으로 만들지 않았다. 저장만 재시도·빈 응답·중단·회복은 모의 테스트로 검증했다.

자동 검증: **단위 86개 / 브라우저 47개 시나리오 / strict validation 통과**. 기존 영문 문구를 기대하던 브라우저 테스트 한 개를 수정해 재실행했다. 실제 개발 API에서는 별도로 빠른 검토·단일 응답 비교·투표도 실행했다. 근거와 제한은 [VALIDATION_070.md](VALIDATION_070.md), 기능은 [RELEASE_070.md](RELEASE_070.md), 사용자 안내는 [README.md](README.md).

비공개 로컬 산출물은 `runtime/review-plan/`(Git 제외)에 있다. 실제 UI 캡처 `anna-070-brief.png`, `anna-070-visible.png`, `anna-070-office.png`, 다운로드 복사본 `installed-export.md`, 실제 API 결과 `live-validation.json`. 캡처에는 Anna 데스크톱이 함께 보여 스토어 이미지로 등록하지 않았다.

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

이 환경(Node 24.14.1 / CLI 0.1.57)에서 `anna-app apps push --dry-run`은 종료 시 libuv assertion으로 실패했다. 패키지 내부의 동일한 `runAppsPush` 함수를 호출하고 `process.exitCode`로 자연 종료시켜 dry-run과 업로드를 완료했다. 0.7.0에는 `ifMatch:4`를 사용했다. 이번 0.7.1 업로드는 `ifMatch:5` → revision 6, 표시 수정 후 `ifMatch:6` → revision 7로 진행했다. 최종 실제 설치본의 새로고침 성공 문구까지 대조했다. 이 우회는 로컬 실행용이며 제품 의존성이나 인증 방식을 변경하지 않았다.

Orca에서는 `orca tab switch --page <id> --focus`로 실제 탭을 보이게 한 뒤 캡처한다. 배경 탭의 캡처가 전환 애니메이션에 멈춘 사례가 있었다. UI DOM·실제 화면을 모두 확인하고, iframe URL에는 단기 인증값이 있으므로 경로만 기록한다.

## 남은 일

- 외부 사용자 3~5명의 가치·재사용 의향 검증은 사용자의 요청으로 보류한다. 단일 AI보다 낫다고 아직 주장하지 않는다.
- 별도 로그인 계정으로 첫 사용과 실제 계정 간 데이터 격리를 확인한다. 이번에는 두 번째 계정이 없어 권한(app/self) 검토와 모의 첫 사용, 같은 계정 두 탭 검증까지 수행했다.
- 소개 캡처·데이터 처리 안내·심사 재현 메모는 0.7.1 기준으로 준비·등록했다. 최종 1.0 후보와 자료를 대조하고, 새 지시로 **1.0.0** 후보 생성·제출을 진행한다. 0.x에서 제출하지 않는다.
- 실제 사용 중 quota 소진은 의도적으로 만들지 않았다. 모의 테스트는 통과했으나 서버 측 취소와 정확히 한 번 과금은 보장하지 않는다. 연결 종료 후 재개 전 미완료 요청 안내를 유지한다.
- 재설치 후에는 대시보드를 새로 불러와 현재 앱 창을 확인한다. Orca의 닫힘 애니메이션 중 이전 iframe이 DOM에 남을 수 있어 첫 iframe이 현재 런타임이라고 가정하지 않는다. 이번 오래된 종료 창의 timeout은 정상 활성 앱 오류로 집계하지 않았다.
- 이전부터 있던 사용자 파일 `.claude/`, `skills-lock.json`은 변경·커밋하지 않았다. 오래된 인수인계는 [HANDOFF_HISTORY.md](HANDOFF_HISTORY.md)에 보존한다.
