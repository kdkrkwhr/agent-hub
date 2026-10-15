# Agent Hub Radio 인수인계

## 현재 상태 (2026-10-15)

- 앱 `agent-hub-radio`(app_id 561), 브랜치 `release-anna`, 커밋 `cc5219f`.
- 최신 버전 0.4.1(version_id 1389), 작업 리비전 2, 소유자에게 `0.0.0-draft`로 설치됨. 상태는 draft이며 공개 출시·심사 제출은 하지 않았다.
- 1단계(역할·모델 설정, 저장소, AI 창구)와 2단계(토론, 투표, 기록, Markdown 내보내기) 완료. 자세한 내용은 [RELEASE_041.md](RELEASE_041.md).

## 배포 순서

```powershell
cd anna
npm test; npm run test:browser; npx anna-app validate --strict
npx anna-app apps push --no-install-local
npx anna-app apps cut <새 버전>     # 버전 번호는 재사용하지 않는다
```

그다음 Developer Console 또는 `POST /api/v1/developer/apps/561/working/install`로 소유자 설치를 하고, 대시보드에서 앱을 열어 실제 화면을 확인한다. `npx anna`는 다른 공개 패키지이므로 쓰지 않는다. `anna/.anna/`는 CLI가 만드는 로컬 파일이라 커밋하지 않는다.

## 남은 일

- 실제 AI 검증(사용량 회복 후): 토론 1회, 투표 1회, 할당량 오류 문구, 실제 모델 이름 표시, `llm.stream` 허용 여부.
- 3단계: 문서 파이프라인, 오피스 화면.
- 남은 제한은 [RELEASE_041.md](RELEASE_041.md)의 "남은 제한" 참고.
