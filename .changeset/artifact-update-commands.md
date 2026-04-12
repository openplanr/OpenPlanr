---
"openplanr": patch
---

Add artifact update commands and GitHub issue type auto-assignment

- Add `planr update <ids...>` top-level command with batch support, status validation, and `--force` override
- Add `update` subcommand to all artifact types: epic, feature, story, task, quick, backlog
- Supported fields: `--status` (all types), `--owner` (epic/feature), `--priority` (backlog)
- Auto-set GitHub issue types (Task, Feature) via GraphQL when pushing with `planr github push`
- Extract shared `updateArtifactFields()` using regex-based replacement to preserve file formatting
- Harden environment variable access with explicit allowlist in credentials-service
