# Security model

Vorkflo v0.4 runs local executables with the permissions of the user who
launched the desktop application. It is designed for trusted workflows with
visible guardrails; it is not a sandbox for untrusted code.

The v0.4 desktop acceptance target is macOS. POSIX process-group termination is
covered by integration tests, including forced termination when a process
ignores the initial request. Windows and packaged Linux desktop behavior are not
yet release-supported.

## Treat workflows as executable code

Review an imported workflow before running it. A workflow can invoke commands,
read or modify files available to the current user, access explicitly inherited
environment values, and use the network through the tools it launches.

Vorkflo makes direct executable-and-argument invocation the default. Blocks that
enable shell mode have broader interpretation rules and must be visibly
identified in the run preview.

## Secrets

Workflow files store host-environment references, not resolved values. Do not
place secrets in literal arguments, literal environment values, filesystem
paths, examples, or test fixtures.

Process stdout and stderr may still contain sensitive data. v0.4 does not
promise automatic redaction, so inspect run output before sharing it.

## Desktop boundary

The Electron renderer has Node integration disabled and context isolation
enabled. Filesystem access and process execution occur in the main process
behind a narrow preload bridge. Renderer-provided workflow data is parsed and
validated again at that boundary.

## Reporting a vulnerability

Do not open a public issue containing credentials, private workflow content, or
an exploit that could execute unintended local commands. Use the repository
Security tab to report a vulnerability privately when available. If private
reporting is unavailable, open a minimal issue without exploit details or
sensitive data and request a private channel.

## Computer Use

A dedicated user-owned Codex profile and MCP manifest define the backend. The
bundled proxy enforces tool names, URL arguments, and action count, while
process timeout and cancellation are enforced independently. Browser network
traffic and redirects require backend isolation; proxy checks are not a network
sandbox. Retrieved content must never change the configured authority.

## Distribution

macOS downloads are unsigned and unnotarized. Their checksums establish payload
consistency, not publisher identity or Apple malware review. Release builds omit
source maps, tests, user data, and machine-local configuration. GitHub Actions
have read-only repository access except for the final publication job.
