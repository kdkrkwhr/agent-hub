# Agent Hub Radio 인수인계

## 현재 상태 (2026-10-15)

- 앱 `agent-hub-radio`(app_id 561), 브랜치 `release-anna`, 커밋 `6cdbfc8`.
- 최신 버전 0.6.0(version_id 1391), 작업 리비전 4, 소유자에게 `0.0.0-draft`로 설치됨. 상태는 draft이며 공개 출시·심사 제출은 하지 않았다.
- 0.6.0은 사무실·투표실 지도 탭을 더했다. 자세한 내용은 [RELEASE_060.md](RELEASE_060.md). 0.5.0 화면 개편은 [RELEASE_050.md](RELEASE_050.md), 이전 단계는 [RELEASE_041.md](RELEASE_041.md).

## 배포 순서

```powershell
cd anna
npm test; npm run test:browser; npx anna-app validate --strict
npx anna-app apps push --no-install-local
npx anna-app apps cut <새 버전>     # 버전 번호는 재사용하지 않는다
```

스토어 아이콘과 등록 정보는 번들과 별개다. `app.json`(`logo_file: store/logo.jpg`)을 고친 뒤 `npx anna-app apps sync-meta --dry-run`으로 확인하고 `npx anna-app apps sync-meta`로 올린다.

그다음 Developer Console 또는 `POST /api/v1/developer/apps/561/working/install`로 소유자 설치를 하고, 대시보드에서 앱을 열어 실제 화면을 확인한다. `npx anna`는 다른 공개 패키지이므로 쓰지 않는다. `anna/.anna/`는 CLI가 만드는 로컬 파일이라 커밋하지 않는다.

## 남은 일

- 실제 AI 검증(사용량 회복 후): 토론 1회, 투표 1회, 할당량 오류 문구, 실제 모델 이름 표시, `llm.stream` 허용 여부.
- 다음: 문서 파이프라인.
- 설치 확인 중 생긴 빈 채널 "설치 확인 0.5.0"과 "새 채널 3"(둘 다 닫힘, 기록 0건)이 소유자 데이터에 남아 있다.
- 대시보드에서 앱 아이콘을 누를 때 앱 창이 아이콘 위에 떠 있으면 클릭이 창 안으로 들어간다. 먼저 창 위치를 스크린샷으로 확인한다.
- 남은 제한은 [RELEASE_060.md](RELEASE_060.md)의 "남은 제한" 참고.
