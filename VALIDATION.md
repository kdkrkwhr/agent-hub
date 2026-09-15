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
