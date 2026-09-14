# Security policy

## Report a vulnerability

Do not put exploit details, credentials, or customer content in a public issue.
The currently published reporting contact is **security@openplanr.dev**. Send a
minimal reproduction, affected version or commit, impact, and any suggested fix.
This is the project's best available reporting contact; no response-time or
remediation SLA is offered by this policy.

For a non-sensitive coordination question, contact the primary maintainer,
[Asem Abdo](https://github.com/AsemDevs), without disclosing the vulnerability.

## Scope and support

Reports may concern CLI command execution, artifact rendering and sandboxing,
file-scope enforcement, dependencies, host packaging, or company access controls.
The active monorepo development line and latest released components are the
starting points for triage. Older affected versions may be investigated, but a
maintained-version or backport guarantee is not currently published.

Hosted company collaboration remains under development. Source availability and
passing tests do not establish enterprise readiness, compliance certification,
or operational guarantees. The hosted application has a separate repository and
deployment boundary; include which surface is affected in a report.

## Handling sensitive input

Review imported artifacts and agent proposals as untrusted content. A comment is
feedback, not permission to execute commands. Keep credentials and unselected
repository content local, and inspect publication or application scope before
confirming it. Never include real secrets or private customer files in test
fixtures, logs, or public reproductions.
