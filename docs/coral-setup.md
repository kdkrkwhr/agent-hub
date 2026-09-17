# 공식 Coral 서버 구성

AGENT HUB는 **공식 coral-server v1.4.0 JAR**을 사용합니다. AgentRadio 설치나 배포물은 필요하지 않습니다.

- 공식 릴리스: https://github.com/Coral-Protocol/coral-server/releases/tag/v1.4.0
- 파일: coral-server-1.4.0.jar
- 검증 SHA-256: `1e83a383f35b55367a3f337f39ae66c2a6f09c24a58503fe97281beeb4e1863d`
- 실행 검증: Java 24.0.2, Windows. 기본 Java가 21이면 24 이상 실행 파일 경로를 지정하세요.
- 2026-09-17 검증: 서버 시작, 세션 생성, MCP 접속, 채널 생성·조회, 메시지·멘션·답장, 채널 닫기, 관리형 시작 시 기존 세션 재사용. 유료 모델 호출 없음.

## 저장 위치

첫 데스크톱 실행 시 빈 저장 폴더 또는 기존 새 구조 폴더를 선택합니다. 다음 실행에는 선택한 위치를 사용합니다. `start.cmd --choose-data-dir`로 다른 저장 폴더를 선택할 수 있습니다. 폴더 선택은 데이터 이동 기능이 아니므로 기존 데이터는 아래의 오프라인 이전 절차를 사용하세요.

```text
선택한 저장 폴더/
  storage.json
  config/       Hub 연결·모델·Coral 실행·실행 포트 설정
  database/     queue.sqlite3: 대화·요약·작업·알림
  logs/runs/    에이전트 실행 기록
  logs/server/  Hub 서버 로그
  workspaces/   프로젝트 작업 사본
  artifacts/    결과물
  backups/      이전 전 DB 백업
  cache/        모델 목록·데스크톱 브라우저 프로필
  coral/
    config/     관리 키
    runtime/    공식 JAR·에이전트 URL 수신 프로그램
    session/    세션 식별자·MCP URL
    logs/       Coral 로그
    home/       Coral의 캐시와 기타 홈 데이터
```

선택 위치를 기억하는 작은 `AgentHubLauncher/location.json` 파일은 기본 로컬 앱 데이터 위치에 둡니다. 일반 브라우저의 화면 설정은 브라우저 localStorage에 남으며, 외부 CLI 로그인·자체 기록과 원본 Git 저장소는 Hub가 이동하지 않습니다. 연결 키가 포함되어 있으므로 저장 폴더 전체를 공개 저장소에 올리지 마세요.

## 설치 및 기존 데이터 이전

Hub를 종료한 뒤 저장소에서 실행합니다. 아래 경로는 본인 경로로 바꾸세요. 대상은 빈 폴더여야 합니다. 원본은 삭제하지 않으며 파일 해시·SQLite 무결성을 검사합니다.

```powershell
$env:PYTHONPATH = 'src'
python -m agent_hub.setup_official --source '기존 Hub 데이터 폴더' --data-dir '새 저장 폴더' --jar '공식 JAR 경로' --java 'JDK 24 이상/bin/java.exe' --port 5568
python -m agent_hub --data-dir '새 저장 폴더' --desktop
```

새로 설치할 때는 `--source`를 생략합니다. 기본 에이전트는 Codex이며 자동 응답은 꺼져 있습니다. 기존 데이터 이전 시 에이전트 선택과 자동 응답 설정을 유지합니다. 첫 실행 후 같은 저장 위치를 기억하려면 `start.cmd --choose-data-dir`로 해당 폴더를 선택하세요.

공식 서버가 꺼져 있으면 Hub 시작 시 같은 저장 폴더의 설정으로 실행합니다. 정상 세션은 재사용하고, 더 이상 유효하지 않으면 새 세션을 준비합니다. 서버 재시작으로 원래 Coral 스레드가 없어지면 Hub의 보관 채널에서 새 채널로 이어가기를 사용합니다. 세션은 인메모리이며 서버 자체의 재시작 복원은 보장하지 않습니다.

기존 AgentRadio 서버는 자동으로 종료하거나 삭제하지 않습니다. 독립 검증 후 더 이상 다른 클라이언트가 사용하지 않을 때 별도로 정리하세요. 예전 설치법은 [이전 JAR 설치 기록](coral-setup-legacy.md)에 남깁니다.
