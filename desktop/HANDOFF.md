# Desktop preview 0.4.0a1 — 2026-10-23

## 브랜치와 배포 경계

- 소스: `release-desktop`, 패키지 기준 커밋 `bb1bbbbea5eb03b44b25ff4b3951e2ea0a5aca62`.
- Anna `release-anna`의 0.8.0 테스트 앱·심사 상태는 변경하지 않았다. 데스크톱 버전은 독립적으로 관리한다.
- 공개 GitHub Release는 만들지 않았다. 설치 파일은 [Desktop packages 실행](https://github.com/kdkrkwhr/agent-hub/actions/runs/39888156662)의 artifacts와 로컬 `dist/installers/`에 보관한다.

## 구현 범위

Python 엔진을 PyInstaller로 묶고 pywebview 전용 창을 추가했다. Windows는 WebView2, Mac은 WKWebView를 사용한다. Python은 포함하며, Claude Code·Codex CLI·Cursor Agent는 사용자가 별도로 설치·로그인한 것을 연결한다.

새 화면은 영어이며 프로젝트 폴더 선택 → 별도 사본 생성 → 단일 에이전트 요청 또는 여러 에이전트 토론 → 진행 확인·중단 → 결과와 변경 내보내기를 지원한다. 대화와 사본은 로컬 데이터 폴더에 저장한다. 창을 닫으면 이 앱이 시작한 작업과 서버를 종료한다. 기존 Coral 자동 작업은 시작하지 않는다.

## 검증

- 로컬 Python 전체 테스트: 220개 실행, 219개 성공·1개 건너뜀. 이후 저장 폴더 오류 안내 회귀 검사를 추가했고 데스크톱 전용 6개도 성공했다.
- 최종 Mac 패키지 CI: 각 221개 실행, 220개 성공·1개 건너뜀. Apple Silicon·Intel 모두 패키징, ad-hoc 서명 검증, 실제 네이티브 UI 초기화, JS↔Python bridge 응답, 정상 종료와 같은 저장소 재실행을 통과했다.
- Playwright: 프로젝트 사본 수정, 원본 보존, 응답의 HTML 비실행, 내보내기, 작업 중단, 기록 복원, 미전송 초안 유지, 860px/1320px 레이아웃, 보관 처리 확인.
- Mac에서 pywebview의 네이티브 응답 반환이 CSP에 막히는 문제를 수정했다. 네이티브 서버의 `/desktop.html`에만 `unsafe-eval`을 허용하며 일반 웹 화면에는 적용하지 않는다. 외부·인라인 스크립트 차단과 로컬 origin 검사, CSRF 검사는 유지한다. 노출한 일반 브리지는 폴더 선택뿐이다.
- Windows 최종 패키지 CI: Python 221개 모두 성공, Playwright와 네이티브 UI·bridge·종료·재실행 성공. 세 대상의 패키지 CI가 모두 성공했다.
- Windows 설치 프로그램을 개발 PC의 별도 경로에 실제 설치하고 두 번 실행했다. 제거 후 실행 파일은 없어졌으며 데이터베이스와 보존 확인 파일은 유지됐다. 기존 설치가 있으면 검사를 중단하도록 했고 사용자의 기본 데이터 폴더는 사용하지 않았다. 상세 로그: `runtime/desktop-installer-verification.json`.
- [일반 테스트 CI](https://github.com/kdkrkwhr/agent-hub/actions/runs/39888156674)의 Windows·macOS·Ubuntu × Python 3.11·3.13 여섯 조합과 [Anna 앱 회귀 CI](https://github.com/kdkrkwhr/agent-hub/actions/runs/39888156680)도 성공했다. Anna 배포는 실행하지 않았다.
- 세 설치 파일을 CI에서 내려받아 각 SHA-256과 대조했다. 로컬 `dist/installers/SHA256SUMS.txt`에 통합 해시를 보관한다.
- 자동 검사는 모의 CLI를 사용하며 실제 AI 요청·과금은 발생시키지 않았다. 사용자의 원본 프로젝트와 기존 저장소를 변경하지 않았다.

## 남은 제품화 작업

- Windows 코드 서명, Mac Developer ID 서명·notarization. 현재는 서명 전 테스트 배포이며 Mac의 ad-hoc 서명은 정식 배포 서명이 아니다.
- 사용자 Mac에서 Finder를 통한 설치·폴더 권한·실제 CLI 로그인 상태로 작업하는 과정 확인. CI 대상은 macOS 15의 두 CPU다.
- 새 설치판의 다국어 UI, 자동 업데이트, CLI 설치·로그인 안내 개선.
- 기존 웹판의 사무실·독립 투표·Coral 자동 실행 기능은 새 데스크톱 화면에 아직 포함하지 않았다.

사용법과 데이터 위치, 빌드 명령은 [README](README.md)에 정리했다.
