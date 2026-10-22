# Agent Hub Radio · Reviewer walkthrough

**Prepared 2026-10-22 against installed draft 0.7.1, working revision 7. Not yet submitted.** The first intended review candidate is 1.0.0; its version and bundle must be verified before attaching these notes to a submission.

## What this app does

An analyst, critic and editor help a solo builder review the scope of a release. The main outcome is a decision brief: build first, defer, reasons, assumptions and a next action. The app also offers a longer debate, secret ballots, saved channels, Markdown export and an office status view.

These are LLM roles inside Anna, not locally running CLI agents. No developer-hosted backend, API key, Executa package, shell command or separate development environment is needed. The supported target is Anna desktop.

User guides: [English](../README.en.md), [한국어](../README.md). [Data use](../DATA_USE.md) · [Screenshots and provenance](screenshots/README.md).

## Main path: 7 AI calls with three roles

Use an Anna account with available AI allowance and an enabled model. Generation consumes that account's allowance. The normal quick-review + ballot path below is **4 + 3 = 7 calls**, excluding retries. Call counts do not indicate price or token usage. Model output and elapsed time can vary.

1. **Open the installed candidate.** A fresh account starts without the owner's saved test channels. For English, open **모델 설정 / Model settings**, select **English** under Language, then close the dialog. For the initial test, leave all three roles at **Family: Automatic / Models used before: No preference**. Existing owner settings may be more restrictive than fresh-account defaults.
2. **Create a channel and fill the example.** Select **+ New channel → Use example**. The input should describe a solo developer's work journal, a two-week limit and five feature candidates. No AI call happens until Send. You can edit the input; using the example does not overwrite an existing draft.
3. **Run Quick review.** Keep **Feature priorities**, **Quick review** and all three roles selected. Confirm **4 AI calls**, then select **Send** once. Expect three initial opinions and one final synthesis. The decision brief should expose recommendations and assumptions. Expand **Read all role opinions and progress** to inspect the source responses and actual model names. If the model misses the requested headings, its full text is displayed instead of discarded.
4. **Run a Secret ballot.** Enter the passage and options below. Keep all three roles selected and confirm the three-call estimate. During processing, choices remain hidden. After every role has completed or been explicitly handled after a failure, see the tally and each role's reason and concern. There is no required winning option.
5. **Keep and revisit the result.** Copy the brief, select **Save MD**, and check that the downloaded Markdown includes both runs and model labels. Close and reopen the app. The channel and completed records should return without new AI generation.
6. **Check Office.** Switch to Office, select Office/Voting room and then a role. Inspect its status/details and return to the corresponding chat record. Navigation and reading saved results make no AI calls.

Ballot passage:

```text
I am building a work journal for solo developers. I have two weeks,
two hours per day. The release should help people log work daily and
find their next task, without raising server costs or losing existing
records. Which feature set should I ship first?
```

Options:

```text
A. Quick work notes and filtering by project
B. Team invites and live collaborative editing
C. Ten visual themes
```

## Optional deeper checks

- **In-depth debate:** make a separate request using this mode. With three roles, expect nine responses: three opinions, three rebuttals, one final proposal and two subsequent reviews. The reviews appear next to the proposal, including disagreement. This adds nine normal AI calls.
- **Stop/resume:** stop after a completed response. Reopen and inspect saved progress before choosing Resume. Saved, completed steps should not run again. A request that was already sent may still be processed on the server; resuming an unfinished step can consume additional allowance.
- **Error guidance:** an unavailable model or insufficient allowance should pause the run with a useful message. Check the account's enabled models/allowance and choose whether to retry. Do not deliberately exhaust allowance to test this.
- **Saving failed:** further AI steps pause. Keep the window open, copy unsaved text and use **Retry saving only**. Saving alone does not call AI; resume remaining steps separately. Do not force a storage failure on valuable user data.
- **Concurrent windows:** a second resume of the same active run should report that another window may be running it. After the first finishes, refresh records. On disconnection, its lease lasts at most 2 minutes 30 seconds. Conflicts ask users to copy their response before loading the latest stored record.

## Interpretation and known limits

- Every new request is separate. Earlier channel conversations are not automatically included.
- Roles may all use the same model. Preferences are requests, not guarantees; the returned model is shown. Role agreement and majority votes are not fact verification.
- No code execution, file editing, shared team channels or automatic document pipeline is claimed. The office visualises status; it is not a separate autonomous execution engine.
- Data is processed through Anna AI and saved through Anna user app storage. App deletion of a record does not promise deletion from platform backups/logs. Close channel archives rather than deletes it; there is no whole-account erase button.
- Exactly-once billing and server-side cancellation after closing/stopping are not guaranteed. Physical two-device behaviour, and actual isolation between **two separate signed-in accounts**, remain unverified by the developer. External 3–5 user value testing is deferred.
- The small-screen layout was checked in a simulated browser. It is not a claim that Anna's Android/iOS host is available.

## Evidence available to reviewers

[0.7.0 validation](../VALIDATION_070.md): actual quick review, successful three-role ballot, copy/export and reopen. [0.7.1 validation](../VALIDATION_071.md): nine-response debate, stop/reopen/resume, two actual same-account Anna tabs, model availability error, storage limits and conditional writes. Actual observed model: `google/gemini-3-flash-preview`; this is evidence from that account, not a required or promised model.

The code baseline passed 95 unit and 51 simulated-browser tests plus strict validation; a later warning-display fix received targeted rechecks. The current preparation adds documentation, listing metadata and actual screenshots only. These materials do not substitute for the final 1.0 candidate verification.

## 제출 전 내부 확인

- [ ] 별도 계정으로 첫 사용과 채널·설정 격리를 실제 확인한다. 현재 같은 계정의 두 탭 검증과 구분한다.
- [ ] 최종 1.0.0 번들을 검증·설치한 뒤 버전·revision·hash를 이 문서에 반영한다. 화면이 달라지면 캡처도 다시 찍는다.
- [ ] 사용자 지시를 받아 1.0.0 후보를 생성하고, 소개·이미지·이 테스트 안내와 함께 심사를 제출한다.
- [ ] Console의 제출 상태를 확인해 기록한다. 이 문서 작성·메타데이터 동기화만으로 제출 완료라고 하지 않는다.
