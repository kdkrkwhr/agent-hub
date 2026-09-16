# AGENT HUB RADIO

**Claude · Codex · Cursor를 한 채널에서 함께 쓰는 로컬 에이전트 허브.**

여러 창에 같은 질문을 복사하는 대신, Coral로 연결한 에이전트에게 토론·독립 투표·역할 분담 작업을 맡기고 과정을 한 화면에서 확인합니다.

[빠른 시작](#빠른-시작) · [Coral 연결](docs/coral-setup.md) · [사용 가이드](docs/user-guide.md)

![에이전트별 색상과 말풍선으로 보는 대화](docs/screenshots/chat.png)

> **0.1.0 Alpha** · Windows 중심으로 검증했습니다. 화면은 공개용 예시 데이터를 넣어 실제 GUI에서 캡처했습니다. 실제 모델 실행 결과나 성능 측정 화면은 아닙니다.

## 세 가지 사용 방식

| 하고 싶은 일 | 사용 방식 | 결과 |
| --- | --- | --- |
| 함께 검토해 결론 내기 | **합의 토론** — 멘션한 에이전트들이 제안·질문·교차 검토 | 참여자 전원이 같은 안을 승인한 최종안 |
| 서로 영향 없이 의견 비교 | **독립 비밀 투표** — 같은 지문에 개별 판단 | 마감 후 선택과 근거 공개 |
| 코드·문서 등 결과물 만들기 | **역할 분담 작업** — 계획 → 구현 → 검토 담당자 지정 | 작업 사본, 변경 패치·ZIP·보고서 |

역할은 고정되지 않습니다. 사용자가 담당자와 순서를 정하며 같은 역할에 여러 명을 배정하면 순차 실행합니다. 검증 명령은 선택 사항이고, 생략하면 **테스트 미실행**으로 표시합니다.

같은 채널의 후속 대화에는 최근 작업 결과와 보류 이유를 전달합니다. 반대 방향은 토론의 **‘이 합의안으로 작업 준비’** 버튼으로 연결합니다.

## 화면 둘러보기

**대화 / 사무실 / 작업** 탭으로 대화, 에이전트 상태, 결과물을 오갑니다. Markdown, 멘션 강조, 채널 고정·닫기, 모델 설정을 지원합니다.

<details>
<summary><strong>사무실 — 에이전트 상태를 공간으로 보기</strong></summary>

![업무 사무실과 에이전트 상태](docs/screenshots/office.png)

작업석·회의 공간·리뷰룸·라운지로 상태를 표현합니다. 독립 투표에는 별도 투표실이 있습니다. 화면은 약 3초마다 갱신되며 비공개 추론이나 실시간 키 입력을 보여주지는 않습니다.

</details>

<details>
<summary><strong>작업 — 역할 배정부터 결과물 확인까지</strong></summary>

![역할별 단계와 결과물 다운로드](docs/screenshots/workflow.png)

단계별 인계 기록, 검토 결과, 테스트 실행 여부와 결과물을 확인합니다. 완료 후 **후속 작업 요청**으로 같은 사본에서 이어서 작업하고, 사무실에서는 특정 에이전트에게 개별 작업·읽기 전용 질문을 맡길 수 있습니다. **‘이 작업에 대해 대화하기’**로 특정 작업을 질문할 수 있습니다.

</details>

## 빠른 시작

**Python 3.11+**가 필요합니다. Python 런타임 외부 패키지 의존성은 없습니다.

```sh
git clone https://github.com/kdkrkwhr/agent-hub.git
cd agent-hub
```

Windows:

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e .
.venv\Scripts\agent-hub --desktop
```

macOS / Linux:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/agent-hub
```

첫 화면에서 **데모로 둘러보기**를 선택하면 계정·Coral 서버·모델 호출 없이 UI를 체험할 수 있습니다. 기본 주소는 `http://127.0.0.1:8768`입니다. Windows의 `--desktop`은 Edge 앱 창을 사용합니다.

### 실제 에이전트와 연결하려면

1. 사용할 **Claude Code / Codex CLI / Cursor Agent**를 설치하고 각 CLI에서 로그인합니다.
2. 호환되는 **Coral 메시지 서버**를 별도로 실행하고 허브·에이전트 신원을 등록합니다.
3. Hub의 **기존 Coral 연결**에서 MCP 연결 정보를 입력하고 연결을 확인합니다.
4. **허브 자동 응답**을 켜고 채널에서 참여할 에이전트를 멘션합니다.

서버·CLI·계정은 이 저장소에 포함되지 않습니다. 서버 호환 범위와 설치 절차는 **[Coral 설치 가이드](docs/coral-setup.md)**에 정리했습니다.

## 알아둘 점

- **속도와 비용:** 여러 에이전트의 호출·검토로 단독 실행보다 느리거나 사용량이 늘 수 있습니다. 합의가 정답을 보장하지는 않습니다.
- **파일 변경:** 토론·투표는 읽기 전용입니다. 역할 작업은 커밋된 Git 저장소의 별도 사본을 수정하며 원본 반영·커밋·푸시는 자동으로 하지 않습니다.
- **보관:** 작업 사본·로그·결과물은 자동 삭제되지 않습니다. 접속 설정과 로그는 비공개 데이터로 관리하세요.
- **실험 기능:** Claude·Codex의 0-turn 수신은 별도 수신 호출을 줄이기 위한 선택 기능입니다. 메시지 토큰은 사용하며 전체 비용 절감을 보장하지 않습니다. Cursor는 다음 호출에서 묶어 전달합니다.

## 더 알아보기

| 문서 | 내용 |
| --- | --- |
| [사용 가이드](docs/user-guide.md) | 연결 설정, 채널, 모델, 데이터 위치, 종료 방법 |
| [합의 토론](docs/collaboration.md) | 참여자·승인·재검토, 0-turn 설정과 제한 |
| [독립 투표](docs/voting.md) | 투표 생성, 공개 시점, 비밀 보장 범위 |
| [역할 분담 작업](docs/pipeline.md) | 담당자·작업 사본·검증·후속 대화 |
| [실험 기록](docs/benchmarks/2026-09-16-zero-turn/report.md) | 0-turn 비교 결과와 측정 한계 |

<details>
<summary>개발 및 테스트</summary>

Windows PowerShell:

```powershell
$env:PYTHONPATH = 'src'
python -m unittest discover -s tests -q
node --test tests/test_office.mjs
```

테스트는 모의 환경을 사용하며 유료 CLI를 호출하지 않습니다. macOS/Linux의 실제 CLI·GUI는 별도 검증이 필요합니다. 공개 전 [릴리스 체크리스트](RELEASE_CHECKLIST.md)를 참고하세요.

</details>

## 라이선스

[MIT](LICENSE). Coral·Claude·Codex·Cursor의 공식 제품이 아닙니다. 외부 구성 요소에는 각각의 라이선스와 이용약관이 적용됩니다. [서드파티 고지](THIRD_PARTY_NOTICES.md)를 참고하세요.
