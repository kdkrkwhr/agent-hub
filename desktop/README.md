# Agent Hub Radio Desktop · 0.4.0a1

Claude Code·Codex·Cursor Agent를 연결하는 **Windows·macOS 로컬 설치판 미리보기**입니다. Python 실행 환경과 UI가 함께 들어 있습니다. Anna 계정이나 Anna SDK를 사용하지 않습니다.

## 설치와 첫 작업

1. Windows는 `AgentHub-0.4.0a1-windows-x64-setup.exe`를 실행합니다. 현재 사용자에게 설치하며 관리자 권한을 요구하지 않습니다. **WebView2 Runtime**이 필요합니다. 없다면 [Microsoft 공식 설치 페이지](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)에서 설치하세요.
2. Mac은 CPU에 맞는 `macos-arm64`(Apple Silicon) 또는 `macos-x64`(Intel) DMG를 열어 **Agent Hub Radio.app**을 Applications로 옮깁니다. 빌드·검증 대상은 macOS 15입니다.
3. 사용할 AI CLI를 별도로 설치하고 해당 도구에서 로그인합니다. 앱의 **CLI detected**는 실행 파일 탐지를 뜻하며 로그인·사용량 검증은 아닙니다. 계정 인증 파일을 가져오거나 앱에 복사하지 않습니다.
4. **Choose a project → Browse**에서 프로젝트 폴더를 선택합니다. 처음은 읽기 전용입니다. 코드 수정을 원하면 **Allow this session to edit its workspace copy**를 선택합니다.
5. `@codex 프로젝트를 설명해 줘`처럼 한 에이전트를 호출합니다. `@claude @codex 장단점을 비교해 줘`처럼 여러 에이전트를 지정하면 두 회차로 토론합니다. 2명은 4회, 3명은 6회 요청입니다. 각 CLI의 계정과 사용량을 사용합니다.
6. 결과를 읽고 **Export changes**를 누릅니다. 표시된 폴더에 패치·ZIP·보고서가 저장됩니다. 원본 적용·Git 커밋·푸시는 자동으로 하지 않습니다.

현재 파일 상태를 별도 작업 폴더로 복사하므로 미커밋 변경이나 Git 없는 폴더도 쓸 수 있습니다. 이 화면은 항상 폴더 복사 방식을 사용합니다. `.git`, 의존성·캐시와 흔한 비밀 폴더 일부가 제외되며, 프로젝트에 필요한 추가 제외는 `.agent-hub-ignore`에 작성하세요. 전체 범위는 [기존 CLI 안내](../docs/manual-cli.md#일반-폴더의-복사-범위)를 참고하세요.

## 기록과 종료

- 대화·작업 사본은 로컬에 저장됩니다. 다시 실행한 뒤 왼쪽 Workspaces에서 이어갈 작업을 선택하세요. 입력 중인 미전송 초안은 현재 창 안에서만 유지됩니다.
- **Stop**은 현재 작업을 중단합니다. 중단 전 일부 파일 변경은 사본에 남을 수 있습니다. 중단 상태라면 내용을 검토한 뒤 **Review & resume**으로 현재 사본을 승인합니다. 자동 재시도는 없습니다.
- 실행 중 창을 닫으면 중단 여부를 묻고, 이 앱이 시작한 작업과 로컬 서버를 정리합니다. 사용자가 별도로 실행한 CLI 프로세스를 종료하지 않습니다.
- **Archive workspace**는 종료된 작업으로 표시하며 파일과 기록을 보존합니다.
- 기본 저장소: Windows `%LOCALAPPDATA%\AgentHub`, macOS `~/Library/Application Support/AgentHub`. 기존에 지정한 저장 폴더가 있으면 그 위치를 이어 씁니다. 이미 같은 저장소를 사용하는 Hub가 실행 중이면 먼저 종료하세요.
- 앱 제거는 기록·사본·CLI 로그인 정보를 삭제하지 않습니다. 다른 컴퓨터로 옮기려면 앱을 종료한 상태에서 데이터 폴더를 백업하세요.

## 이번 설치판의 범위

- 전용 창, 설치된 CLI 탐지, 프로젝트 사본, 한 에이전트 작업·여러 에이전트 토론, 진행 표시·중단, 저장된 기록, 변경 내보내기를 제공합니다.
- 새 데스크톱 화면은 영어입니다. 요청·답변은 기존 엔진의 요청 언어 지침을 사용합니다. Anna판의 네 언어 UI와는 별개입니다.
- Coral 없이 사용할 수 있습니다. 기존 웹판의 사무실·독립 투표·Coral 자동 작업 설정을 이 화면에 옮기지는 않았습니다. 설치판을 열 때 기존 Coral 자동 작업을 시작하지 않습니다.
- 앱에 Python은 포함하지만 사용자의 개발 프로젝트가 필요로 하는 Git·Node·Python 및 각 AI CLI는 별도입니다. 프로젝트 가상환경을 앱의 내장 Python으로 대체하지 않습니다.
- Windows·Mac 패키지는 **정식 서명 전 미리보기**입니다. Mac은 로컬 ad-hoc 서명이며 Developer ID 서명·Apple notarization을 완료한 배포가 아닙니다. Gatekeeper를 끄는 방법은 안내하지 않습니다. 공개 배포용 서명과 실제 사용자 Mac 검증은 후속 단계입니다.
- 자동 업데이트는 아직 없습니다. 후속 설치 파일로 갱신하며 데이터는 유지합니다.

## 개발·빌드

대상 OS·CPU에서 Python 3.11을 이용합니다. 빌드 환경은 제품에 포함되므로 최종 사용자가 Python을 설치할 필요는 없습니다.

```sh
python -m venv .venv
# 해당 OS의 .venv를 활성화한 뒤:
python -m pip install -r desktop/requirements-build.txt -e .
python -m agent_hub.desktop_app
python -m unittest discover -s tests -v
npm ci --prefix desktop
npx --prefix desktop playwright-core install chromium
npm test --prefix desktop
python desktop/build.py
```

Windows 설치 프로그램 생성에는 Inno Setup 6이 필요합니다. `python desktop/build.py --app-only`는 실행 폴더만 만듭니다. Mac은 `hdiutil`로 DMG를 생성합니다. 결과는 `dist/<target>/`입니다. [GitHub Actions](../.github/workflows/desktop.yml)는 세 대상에서 패키지를 만들고 실제 네이티브 창의 초기화·종료·재실행을 확인합니다. 자동 테스트는 AI를 호출하지 않습니다.

기존 셸의 PATH가 없는 Finder 실행을 위해 사용자 `.local/bin`, `.npm-global/bin`, Homebrew의 표준 경로를 추가 탐색합니다. 사용자 셸 초기화 스크립트를 실행하지는 않습니다. 별도 버전 관리 도구에만 설치한 CLI는 표준 PATH에 연결하거나 기존 설정의 실행 파일 경로를 지정해야 할 수 있습니다.

기술: [pywebview의 Windows·Mac 렌더러](https://pywebview.flowrl.com/guide/web_engine.html), [PyInstaller](https://pyinstaller.org/en/stable/), [Inno Setup](https://jrsoftware.org/isinfo.php). 각 라이브러리의 라이선스는 설치 폴더의 `licenses`에 함께 포함합니다.
