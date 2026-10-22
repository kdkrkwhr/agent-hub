# Agent Hub Radio 인수인계

## 현재 상태 (2026-10-22)

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

## 이전 배포 (2026-10-15)

- 앱 `agent-hub-radio`(app_id 561), 브랜치 `release-anna`, 커밋 `6cdbfc8`.
- 최신 버전 0.6.0(version_id 1391), 작업 리비전 4, 소유자에게 `0.0.0-draft`로 설치됨. 상태는 draft이며 공개 출시·심사 제출은 하지 않았다.
- 0.6.0은 사무실·투표실 지도 탭을 더했다. 자세한 내용은 [RELEASE_060.md](RELEASE_060.md). 0.5.0 화면 개편은 [RELEASE_050.md](RELEASE_050.md), 이전 단계는 [RELEASE_041.md](RELEASE_041.md).

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

이 환경(Node 24.14.1 / CLI 0.1.57)에서 `anna-app apps push --dry-run`은 종료 시 libuv assertion으로 실패했다. 패키지 내부의 동일한 `runAppsPush` 함수를 호출하고 `process.exitCode`로 자연 종료시켜 dry-run과 업로드를 완료했다. 업로드에는 `ifMatch:4`를 사용했고 서버 revision 5와 실제 설치 UI를 대조했다. 이 우회는 로컬 실행용이며 제품 의존성이나 인증 방식을 변경하지 않았다.

Orca에서는 `orca tab switch --page <id> --focus`로 실제 탭을 보이게 한 뒤 캡처한다. 배경 탭의 캡처가 전환 애니메이션에 멈춘 사례가 있었다. UI DOM·실제 화면을 모두 확인하고, iframe URL에는 단기 인증값이 있으므로 경로만 기록한다.

## 남은 일

- 3~5명 실제 사용자에게 출시 고민을 검토하게 하고 단일 AI 응답 대비 유용성·재사용 의향을 확인한다. 한 사례에서는 두 방식의 추천이 같았으므로 우월성을 주장하지 않는다.
- 설치 환경의 심층 토론·모델 선호·중단/재접속, 별도 계정 격리, 여러 기기 충돌과 대량 기록 저장 한도 대응을 추가 검증한다. 스트리밍 가용성과 서버 측 취소 여부도 별도 확인 대상이다.
- 불확실한 비용·공수의 단정 표현을 줄이고, 첫 사용 안내와 결과 가독성을 사용자 반응에 맞춰 다듬는다.
- 최종 개인정보 안내·스토어 캡처·심사 재현 메모를 준비한다. 문서 파이프라인은 첫 출시 후 별도 범위다.
- 위 조건을 마친 뒤 **1.0.0** 후보를 생성해 심사를 요청한다. 현재 0.x는 테스트 단계다.
- 설치 확인 중 생긴 빈 채널 "설치 확인 0.5.0"과 "새 채널 3"(둘 다 닫힘, 기록 0건)이 소유자 데이터에 남아 있다.
- 대시보드에서 앱 아이콘을 누를 때 앱 창이 아이콘 위에 떠 있으면 클릭이 창 안으로 들어간다. 먼저 창 위치를 스크린샷으로 확인한다.
- 기존 사용자 파일 `.claude/`, `skills-lock.json`은 작업·커밋 대상에서 제외했다. 이전 인수인계 원문은 [HANDOFF_HISTORY.md](HANDOFF_HISTORY.md)에 보존했다.
