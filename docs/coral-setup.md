# Coral 설치 및 AGENT HUB 연결

[README로 돌아가기](../README.md)

이 문서는 **Coral 서버가 없는 Windows 사용자**를 위한 수동 설치 예시입니다. AGENT HUB는 서버 바이너리를 배포하거나 서버를 대신 운영하지 않습니다. 명령은 PowerShell에서 실행하며, 생성되는 서버·인증·세션 파일은 Git 저장소 밖에 둡니다. 기존 서버가 있다면 새 서버를 만들지 말고 6번의 연결 설정으로 이동하세요.

검증 기록(2026-09-15): 아래 PowerShell 예제의 구문을 검사하고, 기존에 받은 동일 JAR을 사용해 별도 임시 폴더·포트에서 서버 시작 → 네 신원 등록 → 네 MCP 접속을 확인했습니다. 다운로드를 다시 수행하거나 유료 모델을 호출한 테스트는 아닙니다.

## 1. 호환되는 서버와 준비물

| 구성 요소 | 준비 방법 |
| --- | --- |
| Python 3.11 이상 | [Python 공식 다운로드](https://www.python.org/downloads/windows/), `python --version`으로 확인 |
| Java | [Temurin JDK 25](https://adoptium.net/temurin/releases/?version=25), `java -version`으로 확인 |
| Coral 메시지 서버 | [AgentRadio README의 Message server JAR 항목](https://github.com/Coral-Protocol/AgentRadio#6-message-server-jar)에서 다운로드 |
| 에이전트 CLI | 7번에서 사용할 CLI만 설치·로그인 |

AGENT HUB 0.1.0은 AgentRadio가 링크한 메시지 서버 JAR과 연동을 확인했습니다. 해당 배포물의 명확한 릴리스 버전은 확인되지 않아, 검증한 파일의 SHA-256으로 구분합니다:

```text
8FE75914257590C9009E4B1FBC091265CCE94F05836DE156A1829DAE5A52A815
```

이는 **개발 환경에서 계산한 파일 식별값이며, 배포자의 서명이나 공식 체크섬은 아닙니다.** 내려받은 파일이 달라졌다면 같은 버전으로 간주하지 말고 출처와 호환성을 다시 확인하세요. 이 JAR은 Java 24 이상이 필요한 클래스 형식이며 이 가이드는 JDK 25를 사용합니다.

[Coral 서버의 일반 설치 안내](https://github.com/Coral-Protocol/coral-server#how-to-run)에는 Gradle·Docker 경로도 있습니다. **최신 서버나 Docker 이미지를 이 JAR의 호환 대체물로 검증하지는 않았습니다.** 아래 예시는 로컬 executable runtime과 `/api/v1/local/session` API가 있는 배포물용입니다. AgentRadio의 전체 벤치마크 환경, Modal, Harbor는 이 HUB 연결에 필요하지 않습니다.

## 2. 서버 폴더와 JAR 준비

아래 예제는 한 PowerShell 창에서 순서대로 실행합니다. 경로는 현재 사용자의 로컬 데이터 폴더에서 정하므로 저장소 위치와 무관합니다. 새 설치 전용 예제이며, 기존 `AgentHubCoral` 폴더가 있으면 덮어쓰지 않고 중단합니다.

```powershell
$ErrorActionPreference = 'Stop'
$coralDir = Join-Path $env:LOCALAPPDATA 'AgentHubCoral'
if (Test-Path -LiteralPath $coralDir) { throw 'Existing Coral folder: reuse it or choose a different folder.' }
New-Item -ItemType Directory -Path $coralDir | Out-Null
$probeDir = Join-Path $coralDir 'agents\hub-endpoint'
$urlDir = Join-Path $coralDir 'endpoints'
New-Item -ItemType Directory -Path $probeDir,$urlDir -Force | Out-Null
$javaExe = (Get-Command java -ErrorAction Stop).Source
$pythonExe = (python -c "import sys; print(sys.executable)").Trim()
$coralPort = 5555
$baseUrl = "http://127.0.0.1:$coralPort"
$utf8 = New-Object System.Text.UTF8Encoding($false)
```

공식 프로젝트의 [다운로드 안내](https://github.com/Coral-Protocol/AgentRadio#6-message-server-jar)를 열어 현재 링크를 확인하고, 받은 파일을 `$coralDir\coral-server.jar`로 저장하세요. 2026-09-15에 확인한 안내의 다운로드 명령은 다음과 같습니다. Google Drive 주소는 업스트림이 안내한 배포 경로이며 AGENT HUB가 운영하는 주소가 아닙니다.

```powershell
$jarUrl = 'https://drive.usercontent.google.com/download?id=17b40_1kXFrAC0pnN8w_7PPY13O7pYVke&export=download&confirm=t'
curl.exe --fail --location --output "$coralDir\coral-server.jar" $jarUrl
if ($LASTEXITCODE -ne 0) { throw 'Download failed.' }
$actualHash = (Get-FileHash "$coralDir\coral-server.jar" -Algorithm SHA256).Hash
if ($actualHash -ne '8FE75914257590C9009E4B1FBC091265CCE94F05836DE156A1829DAE5A52A815') {
    throw 'Different server artifact. Verify the upstream download and compatibility before proceeding.'
}
```

JDK를 ZIP으로 설치했다면 `$javaExe`를 실제 `bin\java.exe`의 절대 경로로 바꾸세요. JAR과 JDK의 이용·재배포 조건은 각각의 제공자가 정합니다.

## 3. 신원별 접속 URL을 받는 작은 프로세스 준비

이 서버는 등록된 executable을 실행하면서 `CORAL_AGENT_ID`와 `CORAL_CONNECTION_URL`을 전달합니다. 아래 프로세스는 URL을 파일로 저장하고 신원을 유지할 뿐, 모델을 실행하지 않습니다. 실제 Claude·Codex·Cursor 호출은 HUB가 담당합니다. 따라서 Hermes 설치도 필수가 아닙니다.

```powershell
$captureCode = @'
import os
from pathlib import Path
import re
import sys
import time

name = os.environ['CORAL_AGENT_ID']
if not re.fullmatch(r'[a-zA-Z0-9_-]{1,40}', name):
    raise ValueError('Invalid agent identity')
folder = Path(sys.argv[1])
folder.mkdir(parents=True, exist_ok=True)
target = folder / (name + '.url')
temporary = folder / (name + '.url.new')
temporary.write_text(os.environ['CORAL_CONNECTION_URL'], encoding='utf-8')
os.replace(temporary, target)
while True:
    time.sleep(3600)
'@
[IO.File]::WriteAllText((Join-Path $probeDir 'capture.py'), $captureCode, $utf8)
$pythonToml = $pythonExe.Replace('\','/') | ConvertTo-Json -Compress
$urlDirToml = $urlDir.Replace('\','/') | ConvertTo-Json -Compress
$definition = @"
edition = 3
[agent]
name = "hub-endpoint"
version = "0.1.0"
description = "Local endpoint holder for AGENT HUB"
readme = "Captures the assigned MCP URL; no model execution."
summary = "AGENT HUB endpoint holder"
[agent.license]
type = "spdx"
expression = "MIT"
[runtimes.executable]
path = $pythonToml
arguments = ["capture.py", $urlDirToml]
transport = "streamable_http"
"@
[IO.File]::WriteAllText((Join-Path $probeDir 'coral-agent.toml'), $definition, $utf8)
```

## 4. 서버 실행 및 상태 확인

관리 API 키는 서버 관리용입니다. HUB 입력란의 에이전트 MCP URL과는 다른 값입니다. 아래 코드는 키를 생성해 로컬 폴더에 보관하고, 서버를 숨겨진 백그라운드 프로세스로 시작합니다. 같은 포트에 서버가 있으면 새로 실행하지 않습니다.

```powershell
if (Get-NetTCPConnection -LocalPort $coralPort -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port already in use. Reuse the existing server or choose a different coralPort.'
}
$adminKey = python -c "import secrets; print(secrets.token_urlsafe(32))"
[IO.File]::WriteAllText((Join-Path $coralDir 'admin-key.txt'), $adminKey, $utf8)
$serverArgs = @(
    '-Dfile.encoding=UTF-8', '-Dsun.jnu.encoding=UTF-8',
    '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
    '-jar', ('"' + (Join-Path $coralDir 'coral-server.jar') + '"'),
    "--auth.keys=$adminKey", "--network.bind_port=$coralPort",
    '--network.bind_address=127.0.0.1', '--network.allow_any_host=true',
    '--session.defaultWaitTimeout=300000', '--registry.include_debug_agents=true',
    ('--registry.local_agents="' + $probeDir.Replace('\','/') + '"')
)
$server = Start-Process -FilePath $javaExe -ArgumentList $serverArgs -WorkingDirectory $probeDir `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput "$coralDir\server.log" `
    -RedirectStandardError "$coralDir\server-error.log"
$server.Id | Set-Content "$coralDir\server.pid"
$headers = @{ Authorization = "Bearer $adminKey" }
$ready = $false
for ($i=0; $i -lt 30; $i++) {
    try {
        $null = Invoke-RestMethod "$baseUrl/api/v1/local/namespace" -Headers $headers -TimeoutSec 2
        $ready = $true
        break
    } catch { Start-Sleep -Seconds 1 }
}
if (-not $ready) { throw 'Server did not become ready. Inspect server.log and server-error.log.' }
'Coral server ready'
```

`allow_any_host`는 허용 Host 검사 설정이며 외부 공개 설정으로 쓰면 안 됩니다. 이 예제는 `bind_address=127.0.0.1`로 로컬에만 바인딩합니다. 실제 수신 주소는 `Get-NetTCPConnection -LocalPort $coralPort -State Listen`으로 확인하세요.

## 5. 같은 세션에 신원 등록 및 URL 파일 생성

아래에서 `$agentNames`에는 허브 관찰자 `ops`와 사용할 작업자 이름을 넣습니다. 예를 들어 Codex만 쓰면 `@('ops','codex')`입니다. `ops`는 여기서는 허브 신원 이름이며 Discord 봇이나 Hermes가 자동 설치된다는 의미는 아닙니다.

**이 명령은 새 세션을 만듭니다. HUB를 열 때마다 실행하지 마세요.** 기존에 유효한 세션과 URL 파일이 있다면 재사용합니다. 등록 JSON의 필드 구조는 [업스트림 세션 생성 예제](https://github.com/Coral-Protocol/AgentRadio/blob/main/multi_agent/coral_multi_agent.py)를 참조했습니다.

```powershell
$agentNames = @('ops','claude','codex','cursor')
$agents = @($agentNames | ForEach-Object {
    @{
        id = @{ name='hub-endpoint'; version='0.1.0'; registrySourceId=@{type='local'} }
        name = $_
        provider = @{ type='local'; runtime='executable' }
        description = "AGENT HUB participant $_"
        options = @{}
        blocking = $false
    }
})
$sessionRequest = @{
    agentGraphRequest = @{ agents=$agents; groups=@(,$agentNames) }
    namespaceProvider = @{
        type='create_if_not_exists'
        namespaceRequest=@{ name='agent-hub'; deleteOnLastSessionExit=$false }
    }
    execution = @{ mode='immediate'; runtimeSettings=@{ttl=86400000} }
}
$json = $sessionRequest | ConvertTo-Json -Depth 12
$receipt = Invoke-RestMethod "$baseUrl/api/v1/local/session" -Method Post -Headers $headers `
    -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($json))
if (-not $receipt.sessionId -or -not $receipt.namespace) { throw 'Unexpected session response.' }
[IO.File]::WriteAllText((Join-Path $coralDir 'session.json'), ($receipt | ConvertTo-Json -Depth 12), $utf8)
$allReady = $false
for ($i=0; $i -lt 30; $i++) {
    $missing = @($agentNames | Where-Object { -not (Test-Path (Join-Path $urlDir "$_.url")) })
    if ($missing.Count -eq 0) { $allReady = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $allReady) { throw 'Missing agent URL files. Inspect server logs and Python executable path.' }
$lines = @($agentNames | ForEach-Object {
    $url = [IO.File]::ReadAllText((Join-Path $urlDir "$_.url")).Trim()
    if ($url -notmatch '^https?://') { throw 'Invalid MCP URL.' }
    "$_|$url"
})
[IO.File]::WriteAllText((Join-Path $coralDir 'coral-urls.txt'), ($lines -join "`n") + "`n", $utf8)
'Coral identities registered. Use the coral-urls.txt file in AGENT HUB.'
```

`ttl=86400000`은 이 배포물의 예제에서 사용하는 24시간 세션 수명입니다. 무기한 영속 세션을 보장하지 않습니다. 만료·서버 재시작 후 복구는 8번을 참조하세요. 신원별 `.url` 파일과 통합 URL 파일, 관리 키, 서버 로그는 모두 비공개 로컬 파일입니다.

## 6. AGENT HUB 입력값

README의 실행 방법으로 HUB를 연 뒤 다음 값을 설정하세요.

| 화면 항목 | 값 |
| --- | --- |
| 연결 방식 | 기존 Coral 연결 |
| 사용할 에이전트 | 5번에서 등록한 Claude / Codex / Cursor 중 선택 |
| 실행 파일 경로 | 설치 감지 시 비워두기. 미감지 시 실제 native 실행 파일 지정 |
| 허브의 Coral 신원 | `ops` |
| 갱신되는 URL 파일 경로 | `$coralDir\coral-urls.txt`의 **실제 절대 경로** |
| 개별 MCP URL | URL 파일을 쓰면 비워두기 |
| 읽기 전용 프로젝트 폴더 | 분석할 폴더의 절대 경로, 없으면 비워두기 |
| CLI 자동 실행 | 최초 연결 확인까지 꺼두기 |

GUI 입력란은 PowerShell 변수를 해석하지 않습니다. `Join-Path $coralDir 'coral-urls.txt'`의 출력 경로를 복사하세요. 관리 API 키를 MCP URL 입력란에 넣지 마세요.

**연결 테스트 → 성공 메시지 → 시작하기** 순서로 진행합니다. 이 테스트는 MCP 접속과 상태 조회를 확인하며 유료 모델을 호출하지 않습니다. 서버만 실행한 상태에서는 성공하지 않고, 선택한 모든 신원의 URL이 있어야 합니다.

## 7. CLI 설치·로그인 및 첫 실제 요청

사용할 서비스만 설치하세요. 로그인은 HUB와 같은 OS 사용자·환경의 터미널에서 직접 합니다. Windows HUB에서 WSL 내부에만 설치된 CLI를 자동 감지하지는 않습니다. Cursor 편집기 설치와 Cursor CLI 설치도 별개입니다.

| CLI | 공식 설치 안내 | 설치 후 확인 / 첫 실행 |
| --- | --- | --- |
| Claude Code | [공식 설치 문서](https://code.claude.com/docs/en/setup) | `claude --version`, `claude` 실행 후 로그인 |
| Codex CLI | [공식 CLI 문서](https://learn.chatgpt.com/docs/codex/cli) | `codex --version`, `codex` 실행 후 로그인 |
| Cursor Agent | [공식 CLI 설치 문서](https://cursor.com/docs/cli/installation) | `agent --version`, `agent` 실행 후 인증 안내 진행 |

설치 후 새 터미널에서 버전을 확인하고 HUB를 재실행해 감지 상태를 갱신하세요. 실행 파일 직접 지정은 `.cmd`·`.bat` 래퍼가 아닌 native 실행 파일용입니다. Windows Cursor는 지원되는 설치 위치의 `node.exe`와 `index.js` 조합을 자동 감지하므로 우선 자동 감지를 사용하세요.

각 CLI에서 짧은 질문이 정상 응답하는지 확인한 다음, 같은 Coral 신원에 다른 자동 응답기가 없는 경우에만 HUB의 자동 응답을 켭니다. 새 채널을 만들고 입력창 위 에이전트 체크박스 하나를 선택한 후 `연결 확인입니다. 짧게 답해 주세요.`를 전송합니다. 체크박스가 멘션이며 실제 계정 사용량이 발생합니다. 작업 탭에서 실행 상태와 결과를 확인하세요.

기존 메시지는 처음 연결할 때 다시 실행되지 않습니다. 기존 채널에서도 새 메시지와 멘션을 보내야 합니다. CLI는 요청마다 새 작업 세션으로 실행되며 Coral의 최근 대화 문맥을 전달받습니다.

## 8. 종료·재부팅·토큰 변경

- **HUB만 종료:** 실행 터미널에서 Ctrl+C. Coral 서버가 유지된다면 같은 URL 파일로 다시 연결합니다. 브라우저 창만 닫으면 HUB 서버는 계속 실행됩니다.
- **Coral 종료:** 위 4번을 실행한 같은 PowerShell 창에서 `$server.HasExited`를 확인한 후 `Stop-Process -Id $server.Id`로 자신이 시작한 서버만 종료합니다. 저장된 PID는 재사용될 수 있으므로 나중에 `server.pid`만 보고 다른 프로세스를 종료하지 마세요.
- **PC 재부팅:** 이 가이드는 자동 시작을 등록하지 않습니다. 2번의 변수 설정을 기존 폴더 기준으로 다시 준비하고, `admin-key.txt`에서 기존 키를 읽어 4번의 서버 실행·상태 확인 부분을 실행하세요. 폴더 생성·다운로드·키 생성 단계는 다시 실행하지 않습니다.
- **기존 세션 확인:** `session.json`의 `namespace`와 `sessionId`로 아래 조회를 시도합니다. 세션이 유효하고 HUB 연결 테스트도 성공하면 재등록하지 않습니다.

```powershell
$coralDir = Join-Path $env:LOCALAPPDATA 'AgentHubCoral'
$baseUrl = 'http://127.0.0.1:5555'
$adminKey = [IO.File]::ReadAllText((Join-Path $coralDir 'admin-key.txt')).Trim()
$headers = @{ Authorization = "Bearer $adminKey" }
$receipt = Get-Content "$coralDir\session.json" -Raw | ConvertFrom-Json
$namespace = [uri]::EscapeDataString($receipt.namespace)
$sessionId = [uri]::EscapeDataString($receipt.sessionId)
$state = Invoke-RestMethod "$baseUrl/api/v1/local/session/$namespace/$sessionId/extended" -Headers $headers
$state.agents | Select-Object name,status
```

404나 세션 만료라면 기존 기록이 서버에서 복구되는지 먼저 확인하세요. 새 세션을 만들 때는 새 `endpoints-날짜` 폴더를 사용하도록 3번의 `$urlDir`와 정의 파일을 바꾸고 서버를 다시 시작한 뒤 5번을 실행합니다. **기존 `.url` 파일을 새 세션 발급 결과로 오인하지 않기 위해 빈 폴더를 사용합니다.** 생성한 통합 `coral-urls.txt` 경로는 유지하면 HUB가 다음 연결 때 갱신된 내용을 읽습니다.

HUB는 토큰 재발급이나 서버 대화 복구를 자동 수행하지 않습니다. 이전 세션의 대화가 새 세션으로 자동 복사되는 것도 아닙니다.

## 9. 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `UnsupportedClassVersionError` | 실제 `$javaExe`가 JDK 24 이상인지 확인. 이 가이드는 25 기준 |
| 포트 사용 중 | 기존 서버가 있으면 재사용. 새 서버는 다른 포트 지정 후 URL도 해당 포트 사용 |
| 관리 API 401/403 | 서버 시작 시 키와 요청의 Bearer 관리 키가 같은지 확인 |
| MCP 401/404 | 신원 URL·세션 만료 여부 확인. 관리 키를 MCP 주소 대신 사용하지 않았는지 확인 |
| `.url` 파일 누락 | `coral-agent.toml` 경로, Python 실행 파일, `capture.py` 및 서버 오류 로그 확인 |
| `Unsupported Coral state format` | 다른 서버 배포물/API 형식일 수 있음. 검증 JAR 해시와 비교 |
| 설치 감지는 되지만 작업 실패 | 같은 사용자 터미널에서 CLI 로그인·사용량·버전 확인. HUB 작업 결과와 로컬 `runs/` 로그 확인 |
| 같은 답변이 두 번 옴 | 동일 신원을 처리하는 다른 HUB/dispatcher 실행 여부 확인 |
| 연결 성공인데 답변이 없음 | 자동 응답 상태, 받는 에이전트 체크, 새 메시지인지, CLI 인증 및 작업 제한 확인 |
| 한글이 깨짐 | 서버의 UTF-8 JVM 옵션과 URL 파일 UTF-8 인코딩 확인 |

macOS/Linux에서는 동일한 신원·MCP 원리를 사용하지만 이 PowerShell 예제를 그대로 실행할 수 없습니다. 해당 OS의 Java·Python 경로와 프로세스 실행 방식으로 변환해야 하며, 본 가이드는 Windows 중심입니다. 서버의 다운로드 링크나 API가 변경되면 최신 업스트림 문서와 함께 호환성을 다시 확인하세요.
