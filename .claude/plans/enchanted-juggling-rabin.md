# Plan: OpenPlanr Feature Roadmap

## Context

OpenPlanr is a mature AI-powered agile planning CLI, but it's **fully agile-focused** — every workflow requires the Epic → Feature → Story → Task hierarchy. This blocks adoption by solo devs who want simpler planning (just a task list, quick TODOs, or lightweight project management). The goal is to identify high-impact features that complement the existing agile flow while opening the tool to broader use cases.

---

## HIGH Priority Features

### 1. Quick Tasks (`planr quick`)
**Standalone task lists without requiring epics, features, or stories.**

The single biggest gap. A dev prototyping, fixing bugs, or doing a hackathon needs a flat task list without ceremony.

```bash
planr quick "Build authentication system"        # AI generates standalone task list
planr quick --manual                              # Interactive task entry
planr quick list                                  # Show all quick tasks
planr quick implement QT-001 --next               # Reuses existing agent bridge
planr quick promote QT-001 --story US-003         # Graduate to full agile when ready
```

**Technical:** Make `storyId` optional on `TaskList` type. New `ArtifactType: 'quick'`, stored in `docs/agile/quick/`. Simplified AI prompt (description-only, no parent context). The implementation bridge already reads tasks generically via `parseTaskMarkdown`.

**Files:** `src/cli/commands/quick.ts` (new), `src/models/types.ts`, `src/agents/implementation-bridge.ts`, `src/templates/quick/quick-task.md.hbs` (new)

---

### 2. Effort Estimation (`planr estimate`)
**AI-powered complexity and time estimation leveraging codebase analysis.**

Planning without estimation leads to overcommitment. The codebase context builder already exists — estimation is the natural next step.

```bash
planr estimate TASK-001                           # AI analyzes task + codebase → effort
planr estimate --epic EPIC-001                    # Estimates all tasks with totals
planr estimate --calibrate                        # Learn from actual vs estimated on done tasks
```

**Output:** Story points, estimated hours, complexity (low/med/high), risk factors. Stored in artifact frontmatter.

**Files:** `src/cli/commands/estimate.ts` (new), `src/ai/prompts/prompt-builder.ts`, `src/ai/schemas/ai-response-schemas.ts`

---

### 3. GitHub Issues Sync (`planr github`)
**Bi-directional sync between planning artifacts and GitHub Issues.**

Critical for open source projects. Planning lives in local Markdown with no connection to issue trackers.

```bash
planr github push TASK-001                        # Creates GitHub issue from task
planr github push --epic EPIC-001                 # Pushes all tasks as issues
planr github pull                                 # Imports open issues as backlog items
planr github sync                                 # Bi-directional reconciliation
```

**Technical:** Uses `gh` CLI (same shell-out pattern as agent adapters). Maps task title → issue title, content → body, labels from artifact type. Stores GitHub issue number in artifact frontmatter for linking.

**Files:** `src/cli/commands/github.ts` (new), `src/services/github-service.ts` (new)

---

## MEDIUM Priority Features

### 4. Backlog Mode (`planr backlog`)
**Lightweight issue/TODO tracker with tags, priorities, and AI prioritization.**

```bash
planr backlog add "Fix memory leak in parser" --priority high --tag bug
planr backlog list --tag bug --priority high
planr backlog prioritize                          # AI sorts by impact & effort
planr backlog promote BL-003                      # Converts to story or quick task
```

**Files:** `src/cli/commands/backlog.ts` (new), `src/templates/backlog/backlog-item.md.hbs` (new)

---

### 5. Sprint Planning (`planr sprint`)
**Time-boxed iterations with velocity tracking.**

```bash
planr sprint create --name "Sprint 1" --duration 2w
planr sprint add TASK-001 TASK-002
planr sprint add --auto                           # AI selects tasks by priority/effort
planr sprint status                               # Progress + burndown
planr sprint close                                # Archive, carry over incomplete
```

**Files:** `src/cli/commands/sprint.ts` (new), `docs/agile/sprints/` directory

---

### 6. Artifact Search (`planr search`)
**Full-text search across all planning artifacts.**

```bash
planr search "authentication"                     # Search all artifacts
planr search "login flow" --type story            # Filter by type
```

**Files:** `src/cli/commands/search.ts` (new) — uses existing `listArtifacts` + `gray-matter`

---

### 7. Export & Reporting (`planr export`)
**Consolidated export for sharing with non-CLI users.**

```bash
planr export --format markdown                    # Single PLANNING.md
planr export --format json                        # Structured JSON
planr export --format html --scope EPIC-001       # Static HTML page
```

**Files:** `src/cli/commands/export.ts` (new), `src/templates/export/` (new)

---

### 8. Impact Analysis (`planr impact`)
**AI analyzes how a change ripples through the codebase.**

```bash
planr impact TASK-001                             # Files affected, risks, dependencies
planr impact "add WebSocket support"              # Free-text analysis
planr impact --diff                               # Analyze staged git changes vs plan
```

**Files:** `src/cli/commands/impact.ts` (new) — leverages existing codebase context builder

---

### 9. Task Templates (`planr template`)
**Reusable patterns for common task structures.**

```bash
planr template list                               # Built-in: REST endpoint, React component, etc.
planr template use "rest-endpoint" --title "User Profile API"
planr template save TASK-001 --name "component"   # Save existing task as template
```

**Files:** `src/cli/commands/template.ts` (new) — uses existing Handlebars + `templateOverrides` config

---

## LOW Priority Features

### 10. Interactive Dashboard (`planr dashboard`)
Terminal UI with progress bars, recent activity, and next actions. Uses `ink` or enhanced ASCII.

### 11. Git-Aware Branching (`planr branch`)
Auto-create branches from tasks (`feat/TASK-001-add-auth`), track branch ↔ task mapping, cleanup merged branches.

### 12. Automation Hooks (`planr hooks`)
Lifecycle hooks: `story:created → auto-generate tasks`, `task:done → run tests`, etc. Stored in `planr.config.json`.

---

## Recommended Implementation Order

| Phase | Features | Rationale |
|-------|----------|-----------|
| **v0.7** | Quick Tasks | Immediately unlocks non-agile users |
| **v0.8** | Effort Estimation + Search | Leverage existing AI + grow usability |
| **v0.9** | GitHub Sync + Export | Team collaboration and sharing |
| **v1.0** | Backlog + Sprint + Templates | Full lightweight planning alternative |
| **v1.x** | Dashboard, Branching, Hooks, Impact | Community-driven additions |

## Critical Files Across All Features

| File | Role |
|------|------|
| `src/models/types.ts` | Add new `ArtifactType` values, optional parent refs |
| `src/services/artifact-service.ts` | Extend CRUD for new artifact types |
| `src/cli/index.ts` | Register all new commands |
| `src/ai/prompts/prompt-builder.ts` | New AI prompts for estimation, impact, backlog |
| `src/agents/implementation-bridge.ts` | Support standalone (non-story) tasks |
