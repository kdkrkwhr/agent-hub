# Agent Hub Radio · 데이터 처리 안내 / Data use

Updated: 2026-10-22 · Anna app 0.7.1

## 한국어

이 문서는 **Anna 안에서 실행하는 Agent Hub Radio**의 현재 데이터 흐름을 설명합니다. 같은 저장소의 로컬 CLI 제품에는 별도 실행 방식이 적용됩니다.

| 데이터 | 사용 목적과 처리 위치 |
|---|---|
| 요청, 판단할 지문, 선택지 | 역할별 AI 응답을 만들기 위해 Anna Host API를 통해 Anna AI로 전달합니다. |
| 생성된 의견·반박·최종안·투표 | 화면에 표시하고, 같은 실행의 후속 단계에 필요한 의견을 전달합니다. 비밀 투표에서는 다른 역할의 표를 프롬프트에 넣지 않습니다. |
| 채널, 요청·응답, 진행 상태, 모델 이름, 시간 | 다시 열기·중단 후 재개·내보내기를 위해 Anna의 사용자 앱 저장소에 저장합니다. |
| 언어, 역할 성향, 모델 선호 | 이후 실행에 적용하기 위해 같은 앱 저장소에 저장합니다. |
| 복사·Markdown 내보내기 | 사용자가 요청할 때 클립보드 또는 다운로드 파일로 전달합니다. 공유 여부는 사용자가 결정합니다. |

개발자가 운영하는 별도 AI 프록시·데이터 서버나 앱 자체의 광고·분석 추적기는 사용하지 않습니다. Anna 계정 로그인은 Anna에서 처리하며 앱은 별도 계정 가입이나 API 키 입력을 요구하지 않습니다. 이전 채널 대화 전체를 다음 요청에 자동으로 전달하지 않습니다.

**기록 관리:** 각 실행의 삭제 버튼은 해당 앱 저장 기록을 삭제합니다. 먼저 필요한 내용은 복사하거나 **MD 저장**으로 내보낼 수 있습니다. **채널 닫기**는 보관 상태 변경이며 기록을 삭제하지 않습니다. 현재 앱에는 채널·설정을 포함한 계정 전체 데이터를 한 번에 삭제하는 버튼은 없습니다. 삭제 전에 필요한 범위를 확인하려면 아래 문의 경로로 요청해 주세요.

앱은 자체적인 자동 보관 만료를 두지 않습니다. 실제 보관·복구·계정 삭제는 Anna 플랫폼의 정책과 저장소 상태에도 영향을 받습니다. 앱에서 삭제했다는 이유로 Anna의 백업·로그나 모델 제공자 측 데이터까지 즉시 삭제됐다고 보장하지 않습니다. Anna 및 모델 제공자의 보관 기간·학습 사용 여부는 이 앱에서 정하지 않으며, 이 문서에서 별도로 보장하지 않습니다.

문의: [GitHub Issues](https://github.com/kdkrkwhr/agent-hub/issues). 공개 게시물에는 비밀키나 민감한 요청·응답을 적지 말고 필요한 조치를 먼저 설명해 주세요. 이 문서의 변경은 저장소 이력으로 확인할 수 있습니다.

## English

This notice covers **Agent Hub Radio running inside Anna**, not the separate local CLI product in this repository.

- Your request, decision passage and options go through Anna's Host API to Anna AI to generate role responses. Later steps in the same discussion use the earlier opinions they need. A secret ballot does not pass another role's vote into a voter's prompt.
- Channels, requests, generated responses, run state, model names and timestamps are saved through Anna's user app storage so you can reopen, resume or export them. Language, role and model preferences are also saved there.
- Copying and Markdown export place the requested content in your clipboard or a downloaded file. The app does not publish these records for you.
- The app uses no separate developer-operated AI proxy or data server, and includes no app-specific advertising or analytics tracker. Anna handles account login; the app asks for no separate account or API key. Earlier channel conversations are not automatically carried into a new request.

**Your controls:** delete an individual run with its Delete button; copy it or use **Save MD** first if you want a copy. **Close channel** archives the channel and does not delete its records. There is currently no single in-app action to erase all channels and settings. Use the contact below to discuss the scope of a data request without publishing its contents.

The app has no automatic retention expiry of its own. Actual retention, recovery and account deletion also depend on Anna's platform policies and storage. Removing an app record does not guarantee immediate deletion from platform backups, logs or model-provider systems. The app does not set or independently guarantee Anna's or its model providers' retention and training-use policies.

Contact: [GitHub Issues](https://github.com/kdkrkwhr/agent-hub/issues). Describe the request without including secret keys or sensitive prompts/responses in a public issue. Changes to this notice are visible in repository history.
