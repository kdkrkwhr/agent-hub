# Security

This alpha is a single-user localhost application, not a multi-tenant service. Do not expose its port through a public proxy. Host/Origin validation and a per-process CSRF token protect browser mutations; there is no remote-user authentication.

Coral URLs may contain credentials. Configuration and CLI logs remain in the user's data directory and must not be committed. Native agent authentication stays with the native CLI. Output may include sensitive project content even when tools are read-only.

Only enable automatic execution for a trusted Coral session. Read-only CLI settings are not a complete OS sandbox. A model may follow malicious instructions in task content; do not grant access to sensitive workspaces without appropriate isolation.

For a public deployment, configure GitHub private vulnerability reporting before launch. Do not post credentials or private transcripts in public issues. Until a private reporting channel is available, report only a minimal non-sensitive description and request a private channel.
