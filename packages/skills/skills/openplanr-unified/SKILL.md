---
name: openplanr-unified
description: Route OpenPlanr planning and complete pipeline workflows across Claude Code, Codex, and Cursor.
license: MIT
---

# OpenPlanr unified workflow

OpenPlanr and planr-pipeline are separate products with an intentional planning overlap:

- OpenPlanr is the dedicated planning and project-management CLI. Use it for
  ongoing epics, features, stories, tasks, specs, sprints, backlog, reports,
  integrations, and artifact lifecycle.
- planr-pipeline is the complete PO → Design → Review → DEV → QA → delivery
  workflow. Its PO phase performs feature-local planning directly connected to delivery.
- Both read Protocol v1.0 artifacts. Runtime locks, adapter manifests,
  compatibility manifests, and provenance are additive v1.1 contracts.
- `planr operate` is the evidence-to-decision control plane for recurring
  operating cycles. It proposes and routes reviewed work but never crosses the
  PLAN review gate or invokes SHIP.

## Routing

Use OpenPlanr commands for portfolio/project planning. Use `planr pipeline ...`
for a feature moving through delivery. Do not run both decomposers over an already
populated spec unless the user explicitly asks to reconcile the results.

Before first use run:

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
cd <project>
planr setup
planr doctor
planr init
```

The installer installs only the CLI. Guided setup detects coding agents and asks
which runtimes and scopes to configure; user scope is the safe default. No
global install: `npx openplanr@latest setup`. Planning-only:
`planr setup --minimal`.

For pipeline work, use the dedicated workflow skills or the router:

```bash
planr pipeline prepare-plan <feature> --json
planr pipeline complete-plan <feature> --runtime <active-runtime> --json
planr pipeline design-engine <action> <feature>
# review generated artifacts
planr pipeline prepare-ship <feature> --json
planr pipeline finalize-ship <feature> --runtime <active-runtime> --json
```

PLAN and SHIP are always separate user invocations. Never infer SHIP approval from
PLAN completion. Honor runtime selection precedence, task dependencies, Preserve
paths, the three-correction limit, and frontend/backend ownership boundaries.

For a recurring operating cycle, use the dedicated `planr-operate` skill or the
public `planr operate` surface. Preview provider use and writes first, keep
finding acceptance separate from route application, and follow only the
machine-readable questionnaire, typed action, or recovery command returned by
the CLI. Present CLI-owned questions through the active runtime, submit typed
answers through the returned session, and stop separately before every
non-read-only action. Never infer answers, append `--yes`, execute legacy prose
next steps, trial-edit source configuration, or edit `.planr/operate` state
directly.

For universal HTML review, use `planr artifact <file>`. Sharing is explicit:
`planr artifact share <file>` creates a stable AES-GCM encrypted live room by
default, with a separate private creator manage URL. Use `--snapshot` for a
fragment-only or encrypted short-link snapshot. Import latest room or snapshot
feedback with `planr artifact import <review-url>`.

Codex uses installed user-scope skills and concise project policy. Cursor uses
portable project rules and Composer handoff. Claude Code retains native slash
commands and tool-enforced agents. Runtime-specific model names must not leak into
portable procedures.
