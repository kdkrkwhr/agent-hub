# Agent Hub Radio 0.8.0 검증 기록

검증일: 2026-10-23. 코드 `145cd06`, Anna app **561**, 소유자 테스트 draft. 첫 심사는 **1.0.0**에서 진행한다.

## 자동 검증

- 단위 테스트 **101/101**, 브라우저 시나리오 **58/58**, strict manifest validation 통과.
- 네 언어의 번역 키·치환값 일치, 영어 기본값, 저장된 언어 유지, 새 토론·투표 프롬프트, 결과 제목 파싱, Markdown 내보내기, 언어 전환 중 입력·기존 결과 보존을 검사했다.
- 중국어로 시작한 중단 기록을 일본어 UI에서 재개해도 원래 요청 언어를 유지한다. 언어 저장 실패 시 복원, 기존 한국어 기록 호환, 360px 모의 화면도 검사했다.
- 로컬 전체 브라우저 검증은 자원 경합을 줄이기 위해 `node --test --test-concurrency=2 tests/browser/*.browser.mjs`로 실행했다. 연결 전에 표시되는 오류의 옛 한국어 기대값을 새 영어 기본값에 맞춰 수정했다.
- [Anna CI](https://github.com/kdkrkwhr/agent-hub/actions/runs/39883564320): Windows·Ubuntu 모두 성공.
- [로컬 제품 회귀 CI](https://github.com/kdkrkwhr/agent-hub/actions/runs/39883564244): Windows·Ubuntu·macOS × Python 3.11·3.13, 6개 환경 모두 성공.

## 실제 Anna 설치 확인

- 공식 CLI의 `runAppsPush`로 `ifMatch:7` 업로드 후 working revision **8**, bundle **ready**. **27파일 / 169,860 bytes**.
- Content hash: `c872e5da617798a601bf2bb2de8f49f43aaa5da01f9ec42818d6815ea9657ba9`.
- 소유자 Install draft 성공. 실제 경로 `/anna-apps/kdkrkwhr/agent-hub-radio/0.0.0-draft/index.html`에서 **v0.8.0 · Anna AI**, 준비 완료와 빈 오류 안내를 확인했다. Executa 패키지는 없다.
- 실제 설치본의 JS·CSS·SVG 등 **26개 정적 파일**을 내려받아 로컬 SHA-256과 모두 일치함을 확인했다. `index.html`은 별도 fetch가 403이어서 이 해시 대조에서 제외했고, 정상 앱 탐색으로 로드한 DOM·버전·설정 화면으로 확인했다.
- 실제 UI에서 **English → 简体中文 → 日本語 → 한국어**를 전환했다. 역할명, 전송·내보내기·닫기, 사무실 표기가 바뀌고 기존 완료 응답 원문과 입력 중 초안은 유지됐다. 내부 폭 1178px에서 가로 넘침이 없었다.
- 새로고침 후 한국어 선택·네 개 활성 채널·v0.8.0이 복원됐다. 실제 역할 설정 화면을 캡처해 확인했다. 최초 배경 캡처는 호스트의 빈 화면이어서 증거로 쓰지 않았고, Anna 작업 표시줄에서 앱을 앞으로 가져온 뒤 다시 촬영했다.
- 이 배포 검증에서는 **새 AI 요청을 실행하지 않았다**. 실제 중국어·일본어 응답 품질과 원어민 감수는 별도 확인이 필요하다. 기존 실제 AI 검증은 [0.7.0](VALIDATION_070.md), [0.7.1](VALIDATION_071.md)에 있다.

## 데이터·등록정보 보존

- 배포 전 APS **12개 행**의 값과 ETag가 모두 그대로다. **채널 6개(보관 2개), 기록 5개**, 유효 모델 설정이 유지됐다.
- 언어 UI 확인과 원래 한국어 복원 과정에서 언어 변경 기록 **6개**만 추가됐다. 최초 검증 스크립트가 번역되는 투표 UI 제목까지 원문 비교에 포함해 중단했으며, 비교 대상을 완료된 AI 응답으로 좁힌 뒤 네 언어 검증을 통과했다. 제품 응답이나 기록을 수정한 것은 아니다.
- 소개 텍스트와 안내 링크 7개 필드가 로컬 `app.json`과 일치한다. 공개 안내·문의·데이터 처리 링크와 기존 스크린샷 4개 URL은 HTTP 200이다. 스크린샷은 촬영 버전이 명시된 기존 0.7.1 자료를 유지한다.
- immutable 최신 cut **0.6.0 / ID 1391**, 앱 상태 **draft**, 심사 후보 **없음**, 공개 버전 **없음**. 0.8.0 cut·심사 제출·공개 출시는 하지 않았다.

## 증거와 남은 제한

개인 데이터가 포함된 원본은 Git 제외 경로 `runtime/review-plan/`에 보관한다: `unit-080.log`, `browser-080-final.log`, `snapshot-080-before.json`, `snapshot-080-final.json`, `push-080-result.json`, `install-080-result.json`, `ui-080-result.json`, `reopened-080.json`, `installed-hashes-080.json`, `installed-080-visible.png`, `listing-verification.json`.

별도 로그인 계정 간 격리, 외부 사용자 가치 검증, 실제 모바일 호스트, 네 언어의 실제 AI 응답 품질은 이번 검증 범위에 포함하지 않았다. 영어 첫 사용은 새 저장소를 쓰는 자동 테스트로 확인했으며 기존 소유자 데이터를 초기화하지 않았다. 서버 측 생성 취소와 정확히 한 번 과금을 보장하지 않는다.
