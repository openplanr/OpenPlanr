# Security policy

The `openplanr` package is maintained in the
[OpenPlanr monorepo](https://github.com/openplanr/OpenPlanr). Its
[current security policy](https://github.com/openplanr/OpenPlanr/blob/main/SECURITY.md)
applies to this package.

Do not disclose vulnerabilities, credentials, or customer content in a public
issue. The currently published reporting contact is **security@openplanr.dev**.
Include the affected package version or commit, a minimal reproduction, and the
potential impact. No response-time, remediation, or backport SLA is offered.

Reports may concern command execution, file-scope enforcement, credential
exposure, artifact rendering, dependencies, or host packaging. Agent reasoning
runs in the active host; this CLI provides deterministic utilities and does not
start a separate model process. Treat imported artifacts and review comments as
untrusted input, and keep real secrets and customer files out of public examples.
