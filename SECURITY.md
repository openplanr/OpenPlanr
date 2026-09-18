# Security policy

## Report a vulnerability

Email **security@openplanr.dev** with a minimal reproduction, the affected version or
commit, the impact, and any suggested fix. Do not put exploit details, credentials, or
customer content in a public issue or discussion. Reports are handled on a best-effort
basis; no response-time or remediation commitment is published for the open-source
project.

For a non-sensitive coordination question, contact the maintainer,
[Asem Abdo](https://github.com/AsemDevs), without disclosing the vulnerability.

## Scope

In scope: CLI command execution, artifact rendering and sandboxing, file-scope
enforcement, dependencies, host packaging, and the public clients for company
workspaces. Triage starts from the latest released versions and the current `main`
branch; older versions may be investigated, but no backport guarantee is published.

The hosted service has its own deployment boundary. Say which surface a report concerns:
this repository, a published package, or the hosted workspace.

## Handling untrusted input

Treat imported artifacts and agent proposals as untrusted content. A review comment is
feedback, not permission to execute commands. Keep credentials and unselected repository
content local, and inspect publication or application scope before confirming it. Never
include real secrets or private customer files in fixtures, logs, or public reproductions.
