# Spec Schema Reference (v1.0.0)

This document is the canonical, version-pinned schema for spec-driven mode
artifacts. Both **planr CLI** and the **openplanr-pipeline** Claude Code plugin
read and write to this exact schema — no conversion adapter, no glue scripts.

When hand-authoring spec artifacts (e.g. AI is unavailable), use the templates
below verbatim.

> **Schema version:** `1.0.0`
> **Pinning rule:** the `schemaVersion` field on every artifact MUST match the
> reader's expected version. Both planr CLI and openplanr-pipeline currently
> require `1.0.0`. Future breaking changes will bump in lockstep across both.

---

## Directory layout

Every spec is a self-contained directory under `.planr/specs/`:

```
.planr/specs/SPEC-NNN-{slug}/
├── SPEC-NNN-{slug}.md            # the functional spec (one per directory)
├── design/                       # optional — UI mockups + design-spec
│   ├── *.png                     # PNG mockups attached via `planr spec attach-design`
│   └── design-spec.md            # written by openplanr-pipeline's designer-agent
├── stories/
│   └── US-NNN-{slug}.md          # user stories scoped to this spec
├── tasks/
│   └── T-NNN-{slug}.md           # tasks scoped to this spec
├── qa-report.md                  # written by qa-agent after /openplanr-pipeline:ship
├── error-report.md               # written if a task fails 3 iterations
└── .pipeline-shipped             # written by /openplanr-pipeline:ship — proof of execution
```

**ID scoping rule:** in spec-driven mode, `US-NNN` and `T-NNN` are scoped to
their parent SPEC, **not project-globally unique**. Two specs can each have
their own `US-001`. Disambiguate via path or via the `specId` frontmatter field.

---

## SPEC frontmatter

```yaml
---
id: "SPEC-001"                    # required · format: SPEC-\d{3}
title: "User authentication"      # required · human-readable title
slug: "auth"                      # required · URL-safe lowercase, used in path
schemaVersion: "1.0.0"            # required · pinned to reader version
status: "pending"                 # required · pending | shaping | shaped | decomposing | decomposed | in-pipeline | done
priority: "P0"                    # required · P0 | P1 | P2 | P3
milestone: "v1.0"                 # optional · links to a milestone or release
po: "asem@techarc.io"             # optional · spec owner (Product Owner)
created: "2026-04-26"             # required · ISO date (YYYY-MM-DD)
updated: "2026-04-26"             # required · ISO date, bumped on edit
ui_files: []                      # required · array of PNG paths under design/ (empty if none)
tech_dependencies: []             # required · array of strings; informational only
---
```

### Field meanings

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Project-globally unique. Format `SPEC-NNN` (3-digit). The directory MUST be `SPEC-NNN-{slug}/`. |
| `title` | string | Display title. Human-readable. |
| `slug` | string | URL-safe lowercase. Used in path, in `/openplanr-pipeline:plan {slug}`, and in story/task slugs. |
| `schemaVersion` | string | Pinned schema version. `1.0.0` currently. Readers MUST refuse mismatched versions. |
| `status` | enum | Lifecycle marker: `pending` (just created) → `shaping` (Q&A in progress) → `shaped` (body authored) → `decomposing` (AI in progress) → `decomposed` (US/T files written) → `in-pipeline` (ship in progress) → `done` (shipped). |
| `priority` | enum | `P0` (must) / `P1` (should) / `P2` (nice) / `P3` (defer). |
| `milestone` | string? | Optional release/milestone tag. |
| `po` | string? | Optional Product Owner identifier (email or username). |
| `created` / `updated` | string | ISO 8601 date. Bumped automatically by `planr spec` commands. |
| `ui_files` | array | List of PNG file paths under `design/`. Triggers the pipeline's designer-agent if non-empty. |
| `tech_dependencies` | array | Free-form list of upstream tech dependencies. Informational; not consumed automatically. |

### SPEC body sections (in order)

The spec body uses the following H2 sections. `planr spec shape` writes them
from interactive Q&A; `planr spec decompose` and the pipeline's
specification-agent both read them.

1. **`## Context & Goal`** — 2-5 sentences on the user need + outcome
2. **`## Functional Requirements`** — bullet list, action verbs
3. **`## Business Rules`** — constraints and validations
4. **`## User Flows`** — numbered step-by-step flows
5. **`## Out of Scope`** — explicit non-goals
6. **`## Acceptance Criteria`** — Given/When/Then bullets
7. **`## Notes for Decomposition`** *(optional)* — hints for `decompose`, NOT requirements

The `## Notes for Decomposition` section is freeform prose hinting at the
intended US split, special attention areas, or files to preserve. Both
`planr spec decompose` and the pipeline's `specification-agent` read it
to bias their output. Example:

```markdown
- Suggested US split: auth flow (UI), session management (Tech)
- Special attention: the delete flow needs a confirmation dialog
- Preserve: do not modify the existing UserService
```

---

## Story frontmatter

Stories live at `.planr/specs/SPEC-NNN-{slug}/stories/US-NNN-{story-slug}.md`.

```yaml
---
id: "US-001"                      # required · format: US-\d{3} (scoped to parent SPEC)
title: "Login form"               # required
specId: "SPEC-001"                # required · MUST match parent spec id
slug: "login-form"                # required · URL-safe; matches filename suffix
schemaVersion: "1.0.0"            # required
status: "pending"                 # required · pending | in-progress | done
priority: "P0"                    # required · P0 | P1 | P2 | P3
created: "2026-04-26"             # required
updated: "2026-04-26"             # required
---
```

### Story body sections

```markdown
# US-001 — Login form

> **Spec:** SPEC-001

## Story
As a **<role>** I want **<action>** so that **<benefit>**.

## Scope
<2-3 sentences describing what's in scope for this story>

## Acceptance Criteria

- [ ] Given <context>, when <action>, then <observable outcome>.
- [ ] Given …, when …, then …

## Dependencies
<Optional: tasks or stories this depends on, by id>
```

---

## Task frontmatter

Tasks live at `.planr/specs/SPEC-NNN-{slug}/tasks/T-NNN-{task-slug}.md`.

```yaml
---
id: "T-001"                       # required · format: T-\d{3} (scoped to parent SPEC)
title: "Build login form component" # required
storyId: "US-001"                 # required · MUST match a story id under the same spec
specId: "SPEC-001"                # required · MUST match the parent spec id
slug: "login-form-component"      # required · URL-safe; matches filename suffix
schemaVersion: "1.0.0"            # required
type: "UI"                        # required · "UI" | "Tech"
agent: "frontend-agent"           # required · subagent that owns this task
status: "pending"                 # required · pending | in-progress | done
created: "2026-04-26"             # required
updated: "2026-04-26"             # required
---
```

### Type → agent mapping

| `type` | Default `agent` | Notes |
|---|---|---|
| `UI` | `frontend-agent` | UI-focused work: components, pages, styles |
| `Tech` | `backend-agent` | Backend, services, controllers, DTOs, migrations |

The pipeline's `frontend-agent` reads tasks where `type: UI`; the
`backend-agent` reads tasks where `type: Tech`. Setting `agent` to a different
value (e.g. a custom subagent name) overrides the default routing.

### Task body sections

```markdown
# T-001 — Build login form component

> **User Story:** US-001
> **Spec:** SPEC-001
> **Type:** UI
> **Agent:** `frontend-agent` (Opus 4.7)

## Objective
<1-2 sentences: what does this task accomplish?>

## Files

### Create
- `src/components/auth/LoginForm.tsx`
- `src/components/auth/LoginForm.test.tsx`

### Modify
- `src/app/login/page.tsx` (mount the component)

### Preserve
- `src/app/layout.tsx` (do not touch)
- `package.json` (do not add dependencies)

## Technical Spec
<Implementation detail: libraries, patterns, integration points.
The pipeline's frontend-agent / backend-agent reads this verbatim.>

## Test Requirements
<Build / test commands and DoD checks. The qa-agent reads this to
verify completion.>

## Definition of Done
- [ ] Code compiles (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] Lint clean
- [ ] All Create files exist
- [ ] All Modify files updated only as described
- [ ] All Preserve files unchanged (verified via `git diff`)
```

The **`### Create` / `### Modify` / `### Preserve`** lists are NOT optional —
the qa-agent verifies them via `git diff` before accepting the task as done.
A task that touches files outside these lists fails QA.

---

## `.pipeline-shipped` marker

Written by `/openplanr-pipeline:ship` at the end of a successful (or
partially-successful) run. This is the canonical proof that the pipeline
executed — not a hand-authored markdown file.

```yaml
shipped_at: "2026-04-26T22:30:00Z"
pipeline_version: "0.4.0"
mode: "spec-driven"
feature: "auth"
tasks_executed: 3
tasks_failed: 0
qa_gate_status: "passed"
duration_seconds: 287
agents_invoked:
  - frontend-agent
  - backend-agent
  - qa-agent
  - devops-agent
  - doc-gen-agent
devops_status: "generated"
docs_status: "generated"
snapshot_status: "refreshed"
error_reports: []
```

If the marker is absent, the work was NOT shipped via the pipeline. Marketing
posts and audit trails should reference this file by path:
`.planr/specs/SPEC-NNN-{slug}/.pipeline-shipped`.

---

## Status lifecycle (the full path)

A spec moves through these states, in order:

```
pending → shaping → shaped → decomposing → decomposed → in-pipeline → done
```

| State | Set by | Meaning |
|---|---|---|
| `pending` | `planr spec create` | Spec directory exists; body is the empty template |
| `shaping` | `planr spec shape` (in progress) | Q&A flow active |
| `shaped` | `planr spec shape` (complete) | Spec body has Context/FRs/Rules/AC sections filled |
| `decomposing` | `planr spec decompose` (in progress) OR pipeline's specification-agent | AI is generating US + tasks |
| `decomposed` | `planr spec decompose` (complete) | stories/ and tasks/ are populated |
| `in-pipeline` | `/openplanr-pipeline:ship` (in progress) | Pipeline DEV phase running |
| `done` | `/openplanr-pipeline:ship` (complete) | Tasks executed, QA passed, marker written |

The pipeline can ingest a `shaped` spec and decompose it itself; in that case
the spec moves directly from `shaped` to `decomposed` without going through
`planr spec decompose`.

---

## Schema version compatibility

Both planr CLI and openplanr-pipeline produce and consume schema `1.0.0`.
Future breaking changes will bump `schemaVersion` in lockstep across both
products. Keep them aligned via:

```
/plugin marketplace update openplanr
npm i -g openplanr@latest
```

---

## See also

- [planr CLI README](../../README.md)
- [planr CLI command reference](../CLI.md)
- [Spec-driven mode design proposal](../proposals/spec-driven-mode.md)
- [openplanr-pipeline plugin docs](https://github.com/openplanr/openplanr-pipeline)
- [openplanr-pipeline rules.md (R1-R6)](https://github.com/openplanr/openplanr-pipeline/blob/main/docs/rules.md)
