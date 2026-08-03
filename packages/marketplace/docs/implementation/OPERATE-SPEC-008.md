# OPERATE-SPEC-008 marketplace work item

This repository is the durable, initially unmerged release ledger for the
SPEC-005 agent-native Operating Board transaction.

Initial verified tuple:

- Protocol `1.4.0`
- `planr-pipeline@0.37.1`
- `openplanr@1.21.0`
- `@openplanr/skills@1.23.0`
- marketplace `1.8.0`

Forward-fix revision `OPERATE-SPEC-008-R1` corrects the Windows executable
shim used by the packed Operate release canary and resolves this production
tuple:

- Protocol `1.4.0`
- `planr-pipeline@0.37.2`
- `openplanr@1.21.1`
- `@openplanr/skills@1.23.0` (unchanged; its compatible guidance is reused)
- marketplace `1.8.1`

The original ledger remains immutable. The revision has its own digest,
release evidence, marketplace PR, and final reconciliation record.

Reconciliation revision `OPERATE-SPEC-008-R2` incorporates the independently
released optional board-sync identity contract without rewriting either prior
ledger. It resolves this exact tuple:

- Protocol `1.4.0`
- `planr-pipeline@0.38.0`
- `openplanr@1.21.2`
- `@openplanr/skills@1.23.0` (unchanged; its generated workflow remains compatible)
- marketplace `1.8.2`

R2 remains unavailable until its exact package tuple passes the full Ubuntu,
macOS, and Windows Node 20/22 canary matrix and live registry reconciliation.

The resolved capability certifies Claude Code, Codex, and Cursor. Codex and
Cursor may honestly report advisory tool isolation; both remain supported under
runtime-governed assurance. Every cycle is sticky to its selected runtime and
cross-vendor fallback is forbidden.

The ledger remains unavailable while drafted. It may be finalized only after
the pipeline package, CLI package, skills tag, clean-machine migration,
Protocol v1.4 conformance, and real Claude/Codex/Cursor research-and-draft
canaries are independently verified. Publication in any participant changes
recovery to forward-fix; no repository pretends the ecosystem release is
globally atomic.
