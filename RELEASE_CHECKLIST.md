# Public release checklist

- [ ] Repository owner accepts the MIT license for the original code and icon.
- [ ] Review `git diff --cached` and the complete tracked file list before the first push.
- [ ] No runtime data, real endpoint URLs, private paths, credentials or transcripts are tracked.
- [ ] Unit tests and JavaScript syntax check pass.
- [ ] Record tested Coral server build and native CLI versions for a stable release.
- [ ] Test real automatic execution in a dedicated Coral session without another dispatcher.
- [ ] Validate macOS/Linux native clients before claiming platform support.
- [ ] Configure a private security reporting channel on the hosting repository.
- [ ] Preserve external notices if any third-party component is added later.

Current scope is an alpha source release. An installer, automatic Coral provisioning, provider login wizard, automatic write/approval workflow, and distributed coordination are future work.
