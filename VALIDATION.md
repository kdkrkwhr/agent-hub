# Validation — 2026-09-15

Validated locally on Windows with Python 3.11 and Node 24. These are local results, not a claim that GitHub Actions has already run.

| Check | Result |
| --- | --- |
| Python regression tests | 12 passed |
| JavaScript syntax | Passed |
| Wheel build | Passed; HTML, JavaScript and icon assets included |
| First-run browser UI | Passed: setup dialog, provider selection, new channel, Korean message and demo reply |
| Browser runtime | No JavaScript exceptions or horizontal body overflow at 1320 × 1000 |
| Existing Coral connection | Observer plus Claude/Codex/Cursor endpoints accepted MCP; 8 threads read |
| Native Claude adapter | Real CLI returned smoke-test answer; approximately 19 seconds |
| Native Codex adapter | Real CLI returned smoke-test answer; approximately 17 seconds |
| Native Cursor adapter | Real CLI returned smoke-test answer; approximately 66 seconds |
| Public source scan | No current live Coral endpoint or personal project/user references found |

Regression coverage includes first-poll baselining, deduplication, cancellation/retry limits, interrupted-run recovery, output receipt deduplication, worker delivery/mention filtering, nested code fences, SSE parsing, credential-safe errors, URL rotation, demo behavior, and HTTP CSRF/origin validation.

The native checks called each logged-in client with a short tool-free prompt. They did not post messages to the existing operational Coral bus. The new package's queue-to-worker-to-delivery chain was tested with mocked native results; a full live multi-agent handoff in an isolated Coral session remains a release checklist item. This separation avoids running two dispatchers against the same operational identities.

No macOS/Linux native-client run or installer test has been performed. No remote Git repository has been created or pushed by this validation. Exact Coral server build redistribution licensing remains outside this package; the server is not bundled.

## Manual installation guide check

On 2026-09-15, all PowerShell blocks in `docs/coral-setup.md` passed syntax parsing. The guide created a separate local server and four identities, and all four MCP endpoints responded. This check used the existing reference JAR on an isolated port and did not repeat the network download or invoke models. The test server was terminated afterward.

## Internal collaboration engine — 2026-09-15

- Python suite: 32 tests passed, including 12 collaboration tests.
- Scripted full scheduler: 11 calls for independent exploration, assignment, execution, synthesis, and unanimous review; only one public final delivery.
- Scripted objections: assigned issue investigation, revised candidate and all-member reapproval; max-version block, wrong-hash rejection, duplicate-delivery suppression, deadline, close/cancel, restart behavior and late user guidance covered.
- Native Windows smoke: Claude, Codex and Cursor completed all 11 steps on a bounded arithmetic task, approved the same V1 proposal, and terminated with zero active workers. Public Coral channel contained exactly one user request and one final result. This verifies transport and workflow, not quality on complex research tasks.
- Browser smoke: internal discussion, roles/inbox counts and phase status visible at 1320px and 480px widths without page overflow.
- Existing external paid dispatcher was paused; live execution now uses the project-owned hub engine. Local launcher was redirected. These machine-specific settings are not part of the public package.
- Unvalidated: cross-platform native CLI behavior, interrupted network delivery under real failure, and complex native-model objection resolution (the latter is covered by scripted tests only).

## 2026-09-15 adaptive inbox regression

- 38 unit/integration tests pass, including immediate candidate review before slow peers finish, six-call direct-answer scheduling, addressed consultation, stale approvals after new evidence, and one bounded plan-format correction. JavaScript syntax check passes.
- Native Claude/Codex/Cursor test used the original user arithmetic request without success criteria or JSON instructions in the user message. Round `4c8624b37a3e4bad11235f22` completed with six calls, all three explicit APPROVE votes for the same proposal hash, and one delivered terminal result: sum 21, product 180.
- Same request took 216 seconds with the previous mandatory stages and 114 seconds with immediate candidate review in this pair of runs. This is a single comparison, not a general performance guarantee.
- Cursor wall times were 68.3s and 46.1s; its reported API durations were 11.43s and 14.07s. Logs do not identify which CLI startup/connection/exit component accounts for the difference. Discord mirroring is a separate polling process and not an awaited Hub execution step.
- Native consultation/objection paths are covered by scripted tests, not by this simple arithmetic live run. Native CLIs still start per call; persistent sessions and token streaming are not implemented.

## Model selection validation

- 49 Python tests pass, including model validation/persistence, all three CLI `--model` argument paths, preserved read-only flags, saving during active work without cancellation, trusted model metadata parsing, and failed-list cache preservation.
- Native metadata queries succeeded for Codex app-server and Cursor `--list-models`. No inference was requested for discovery. Claude observed model came from the native `modelUsage` envelope.
- Headless browser checked model dialog, native catalogs, observed-model display, save payload, and 1320px/480px layouts. Browser save was intercepted; it did not alter the user's live model choices. Actual inference using every listed model has not been tested.
