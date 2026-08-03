# OpenPlanr Artifact Reference

How to read the markdown files OpenPlanr produces. Every artifact is a standalone `.md` file with YAML frontmatter plus a structured body. Agents should read frontmatter first (for linkage), then the body (for content).

---

## Directory layout

```
.planr/
├── config.json                          # Project config
├── epics/EPIC-001-*.md                  # Epics
├── features/FEAT-001-*.md               # Features (child of an epic)
├── stories/
│   ├── US-001-*.md                      # User story (child of a feature)
│   └── US-001-gherkin.feature           # Gherkin scenarios for that story
├── tasks/TASK-001-*.md                  # Implementation task lists (child of a story or feature)
├── quick/QT-001-*.md                    # Standalone task lists (no hierarchy)
├── backlog/BL-001-*.md                  # Captured backlog items
├── sprints/SPRINT-001-*.md              # Time-boxed sprints
├── adrs/ADR-001-*.md                    # Architecture decision records (user-authored)
├── templates/<name>.json                # Custom task templates
├── checklists/agile-checklist.md
├── diagrams/
└── reports/                             # Generated stakeholder reports
```

---

## Hierarchy and parent links

```
EPIC ─┬─► FEAT ─┬─► US ─┬─► TASK (per story)
      │         │       └─► TASK (per feature, merged)
      ├─► QT (epic-linked)    (also BL linked at capture)
      └─► BL (epic-linked)
```

Parent pointers live in frontmatter:

| Child | Frontmatter field | Parent |
|-------|-------------------|--------|
| FEAT | `epicId: "EPIC-001"` | Epic |
| US | `featureId: "FEAT-001"` | Feature |
| TASK | `storyId: "US-001"` **or** `featureId: "FEAT-001"` | Story or Feature |
| QT | `epicId: "EPIC-001"` (optional) | Epic (optional; standalone otherwise) |
| BL | `epicId: "EPIC-001"` (optional) | Epic (optional) |

When implementing a task, walk upward through these links: `TASK → US → FEAT → EPIC` (or `TASK → FEAT → EPIC`). The epic provides the WHY, features the scope, stories the acceptance criteria, and tasks the how.

---

## Frontmatter per artifact type

### Epic — `EPIC-NNN-*.md`

```yaml
---
id: "EPIC-001"
title: "User Authentication"
owner: "Engineering"
status: "draft"                 # draft | in-progress | done
createdAt: "2026-04-24"
linearProjectId: "..."          # set by `planr linear push`
linearMappingStrategy: "project"
githubIssue: 123                # set by `planr github push`
---
```

**Body:** Business value, problem statement, solution overview, success criteria, key features, dependencies, risks.

---

### Feature — `FEAT-NNN-*.md`

```yaml
---
id: "FEAT-001"
title: "OAuth Login"
epicId: "EPIC-001"
owner: "Engineering"
status: "planning"              # planning | in-progress | done
createdAt: "2026-04-24"
estimatedPoints: 5              # optional, from `planr estimate --save`
---
```

**Body:** Overview, functional requirements, dependencies, technical considerations, risks, success metrics.

---

### User Story — `US-NNN-*.md`

```yaml
---
id: "US-001"
title: "Login with Google"
featureId: "FEAT-001"
status: "planning"
createdAt: "2026-04-24"
estimatedPoints: 3
---
```

**Body:** `As a ... / I want to ... / So that ...`, acceptance criteria summary, notes. Full Gherkin scenarios live in a sibling file `US-NNN-gherkin.feature`.

---

### Gherkin — `US-NNN-gherkin.feature`

Standard Cucumber syntax. One `Feature:` per file, one or more `Scenario:` blocks with `Given / When / Then / And` steps. Map each scenario to an implementation test when coding.

```gherkin
Feature: Login with Google
  Scenario: Successful OAuth login
    Given a user with a valid Google account
    When they click "Sign in with Google"
    Then they are redirected to the dashboard
```

---

### Task list — `TASK-NNN-*.md`

```yaml
---
id: "TASK-001"
title: "Implement Google OAuth"
storyId: "US-001"               # OR featureId for feature-level task lists
status: "draft"                 # draft | in-progress | done
createdAt: "2026-04-24"
linearIssueId: "..."            # Linear TaskList issue
linearChecklistReconciled: "..."# last-agreed checkbox state
---
```

**Body:** Grouped subtasks as markdown checkboxes:

```markdown
### Phase 1 — Auth endpoints
- [ ] Add `/auth/google/login` route
- [ ] Add `/auth/google/callback` route
- [x] Install google-auth-library

### Phase 2 — Frontend
- [ ] Add "Sign in with Google" button
...
```

Subtasks map to acceptance criteria via inline references (e.g. `// AC: Scenario 1`). Related files are listed when the task was generated with codebase context.

**When implementing:** Pick the first unchecked subtask, read the parent story + gherkin + feature + epic + ADRs first, implement, then mark `- [x]` before moving on.

---

### Quick task — `QT-NNN-*.md`

```yaml
---
id: "QT-001"
title: "Migrate to Postgres"
status: "pending"               # pending | in-progress | done
createdAt: "2026-04-24"
epicId: "EPIC-001"              # optional
sourceBacklog: "BL-017"         # if promoted from a BL
tags: ["migration", "db"]
---
```

**Body:** Same subtask-checkbox structure as TASK. No parent story — standalone.

---

### Backlog item — `BL-NNN-*.md`

```yaml
---
id: "BL-001"
title: "Rate-limit the upload API"
priority: "high"                # critical | high | medium | low
tag: "bug"
status: "open"                  # open | closed | promoted
createdAt: "2026-04-24"
epicId: "EPIC-001"              # optional
promotedTo: "QT-042"            # set when status = promoted
---
```

**Body:** Description, optional acceptance criteria, notes, links.

---

### Sprint — `SPRINT-NNN-*.md`

```yaml
---
id: "SPRINT-001"
name: "Sprint 12"
duration: "2w"
startDate: "2026-04-24"
endDate: "2026-05-08"
status: "active"                # active | closed
tasks: ["TASK-001", "QT-003"]
velocity: 8                     # computed on close
---
```

**Body:** Sprint goal, task list with status, retrospective notes (appended on close).

---

### ADR — `ADR-NNN-*.md`

User-authored architecture decision records. OpenPlanr reads these as context for `planr task create` but does not generate them.

Frontmatter typically includes `id`, `title`, `status` (`proposed` / `accepted` / `superseded`), `date`, `deciders`. Body follows the standard MADR or Nygard ADR template.

---

## Status values

| Status | Applies to | Meaning |
|--------|-----------|---------|
| `draft` | EPIC, TASK | Generated but not yet committed to |
| `planning` | FEAT, US | In the plan, not yet started |
| `in-progress` | any | Actively being worked |
| `done` | any | Complete |
| `accepted` | US | Acceptance criteria met |
| `closed` | BL, SPRINT | Archived / ended |
| `promoted` | BL | Moved into the hierarchy as QT or story |
| `pending` | QT | Not yet started |

When syncing to external systems:

- GitHub `open` ↔ local `in-progress`/`draft`; GitHub `closed` ↔ local `done`/`accepted`.
- Linear uses its own workflow states; OpenPlanr three-way-merges via `linearStatusReconciled`.

---

## Context-gathering protocol when implementing

Given a TASK file, to act correctly:

1. Read the TASK frontmatter → find `storyId` or `featureId`.
2. Read the US file → find `featureId` and the acceptance criteria.
3. Read the `US-NNN-gherkin.feature` file → full scenarios.
4. Read the FEAT file → functional requirements, technical considerations.
5. Read the EPIC file → business value, success criteria.
6. Read all files in `.planr/adrs/` → binding technical decisions.
7. Scan the codebase for existing patterns related to the task description.
8. Implement the first unchecked subtask, matching existing patterns and satisfying the relevant Gherkin scenarios.
9. Mark the subtask `- [x]` in the TASK file.
