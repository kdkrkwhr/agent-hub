# Contributing

Use Python 3.11+ and run `python -m unittest discover -s tests -v` with `PYTHONPATH=src`. Check frontend syntax with `node --check src/agent_hub/static/app.js`.

Keep runtime dependencies minimal. Never add personal paths, live Coral endpoints, session tokens, authentication files or production transcripts. Tests should use temporary directories and mocked providers; paid calls must be explicitly requested in manual testing.

Document native CLI/version compatibility when changing an adapter. Keep execution defaults read-only and automatic execution opt-in. Explain behavior changes and validation in pull requests.
