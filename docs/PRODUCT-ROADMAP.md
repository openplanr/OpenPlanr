# OpenPlanr Product Roadmap

> Comprehensive feature analysis and roadmap to make OpenPlanr the most powerful spec-driven agile planning CLI for AI coding agents.

**Last updated:** 2026-04-10
**Current version:** 1.2.4

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State](#current-state)
3. [Competitive Analysis: spec-kit](#competitive-analysis-spec-kit)
4. [Feature Gap Analysis](#feature-gap-analysis)
5. [OpenPlanr Advantages](#openplanr-advantages)
6. [Roadmap](#roadmap)
   - [Phase 1: Foundation Hardening (v1.3)](#phase-1-foundation-hardening-v13)
   - [Phase 2: Intelligence Layer (v1.4)](#phase-2-intelligence-layer-v14)
   - [Phase 3: Extension Ecosystem (v1.5)](#phase-3-extension-ecosystem-v15)
   - [Phase 4: Multi-Agent Orchestration (v2.0)](#phase-4-multi-agent-orchestration-v20)
7. [Proposed New Commands](#proposed-new-commands)
8. [Architecture Decisions](#architecture-decisions)

---

## Executive Summary

OpenPlanr is an AI-powered agile planning CLI that generates structured markdown artifacts (epics, features, stories, tasks) and feeds them to coding agents (Cursor, Claude Code, Codex). It currently covers the full agile hierarchy with sprint management, backlog, templates, estimation, GitHub sync, and export.

spec-kit (GitHub's spec-driven development tool) takes a different approach: it focuses on a "constitution" governing document, cross-artifact analysis, guided implementation with TDD enforcement, and a large extension/preset ecosystem. It has 30+ agent integrations and 80+ community extensions.

This roadmap identifies the gaps between the two tools and proposes a phased plan to absorb spec-kit's strengths while preserving OpenPlanr's clean agile hierarchy — the core differentiator spec-kit lacks.

---

## Current State

### What OpenPlanr Does Today (v1.2.4)

| Category | Commands | Description |
|----------|----------|-------------|
| **Agile Hierarchy** | `epic`, `feature`, `story`, `task` | Full Epic > Feature > Story > Task cascade with AI generation |
| **Quick Tasks** | `quick create/list/promote` | Standalone task lists without hierarchy |
| **Planning Flow** | `plan` | Single-command cascade: Epic → Features → Stories → Tasks |
| **Backlog** | `backlog add/list/prioritize/promote/close` | Capture, AI-prioritize, and promote items |
| **Sprints** | `sprint create/add/status/close/list/history` | Time-boxed sprints with velocity tracking |
| **AI Refinement** | `refine` | AI review with cascade refinement down the hierarchy |
| **Estimation** | `estimate` | AI effort estimation with story points |
| **Templates** | `template list/show/use/save/delete` | Reusable task patterns (5 built-in) |
| **Cross-References** | `sync` | Validate and repair parent-child links |
| **Agent Rules** | `rules generate` | Generate CLAUDE.md, AGENTS.md, .cursor/rules |
| **GitHub** | `github push/sync/status` | Bi-directional issue sync |
| **Export** | `export` | Markdown, JSON, HTML reports |
| **Config** | `config show/set-provider/set-key/set-model/set-agent` | Provider and project config |
| **Status** | `status` | Tree-view progress dashboard |
| **Checklist** | `checklist show/toggle/reset` | 5-phase development checklist |
| **Search** | `search` | Full-text search across artifacts |

**AI Providers:** Anthropic (Claude), OpenAI (GPT), Ollama (local models)
**Agent Targets:** Cursor, Claude Code, Codex

---

## Competitive Analysis: spec-kit

### What spec-kit Does

spec-kit is a spec-driven development framework focused on turning specifications into guided implementation workflows. It uses a YAML-based configuration with a "constitution" concept — a governing document that sets project-wide rules all generated artifacts must follow.

### spec-kit Core Concepts

| Concept | Description | OpenPlanr Equivalent |
|---------|-------------|---------------------|
| **Constitution** | Project-wide governing principles (coding style, architecture, testing rules) that all generated specs must follow | Partial: `.planr/rules.md` + ADRs, but not enforced in generation |
| **Spec** | A feature specification (like a feature + stories combined) | `feature` + `story` + `task` hierarchy |
| **Preset** | Stackable template customization (e.g., "react + typescript + jest") that shapes all generation | Partial: `template` system, but not stackable |
| **Extension** | Plugin system with lifecycle hooks (pre-generate, post-generate, validate) | None |
| **Agent Integration** | 30+ AI agent config generators | 3 targets (Cursor, Claude Code, Codex) |

### spec-kit Key Commands

| Command | What It Does | OpenPlanr Gap |
|---------|-------------|---------------|
| `speckit init` | Project setup with constitution | We have `planr init` but no constitution |
| `speckit generate` | Create specs from requirements | Similar to `planr plan` |
| `speckit analyze` | 5-pass cross-artifact consistency validation (completeness, coherence, dependency, risk, alignment) | We have `planr sync` (link repair only) — no semantic analysis |
| `speckit clarify` | Structured ambiguity resolution — surfaces questions about unclear requirements | No equivalent |
| `speckit implement` | Guided implementation with TDD enforcement, test-first workflow, acceptance gating | No equivalent |
| `speckit validate` | Validate specs against schema and constitution rules | No equivalent |
| `speckit diff` | Show spec changes between versions | No equivalent |
| `speckit review` | AI peer review of spec quality | `planr refine` covers this |
| `speckit export` | Multiple formats | `planr export` covers this |

### spec-kit Extension System

spec-kit's extension system is its biggest advantage — 80+ community extensions with lifecycle hooks:

- **Pre-generate hooks:** Modify prompts before AI generation
- **Post-generate hooks:** Transform output after generation
- **Validation hooks:** Custom rules that run during `analyze`
- **Template hooks:** Inject custom sections into generated specs
- **Agent hooks:** Custom agent configuration generators

Extensions are published as npm packages (`@speckit/ext-*`) and composed in `speckit.config.yaml`.

### spec-kit Presets

Presets are stackable configuration layers:

```yaml
# speckit.config.yaml
presets:
  - "@speckit/preset-react"
  - "@speckit/preset-typescript"
  - "@speckit/preset-testing-library"
```

Each preset contributes: templates, validation rules, constitution fragments, and agent config snippets. They stack — later presets override earlier ones.

### spec-kit Agent Integrations (30+)

Beyond the big 3, spec-kit generates config for: Aider, Cline, Continue, Windsurf, Devin, GitHub Copilot Workspace, Replit Agent, Sweep, Tabnine, Sourcegraph Cody, Amazon Q, JetBrains AI, and 18+ more.

---

## Feature Gap Analysis

### Critical Gaps (High Impact, Must Have)

| # | Gap | spec-kit Approach | Proposed OpenPlanr Approach | Priority |
|---|-----|-------------------|----------------------------|----------|
| 1 | **Constitution / Project Rules Enforcement** | YAML constitution that governs all generation | `.planr/constitution.md` — markdown document injected into all AI prompts. Validated during `planr analyze`. Editable via `planr constitution edit`. | P0 |
| 2 | **Semantic Analysis** | `speckit analyze` — 5 validation passes | `planr analyze` — cross-artifact consistency, completeness, dependency, risk analysis | P0 |
| 3 | **Ambiguity Resolution** | `speckit clarify` — surfaces unclear requirements | `planr clarify <artifactId>` — AI identifies ambiguities, proposes clarifying questions, updates artifact with answers | P1 |
| 4 | **Guided Implementation** | `speckit implement` — TDD-first workflow with acceptance gating | `planr implement <taskId>` — generates implementation plan with test-first approach, validates against Gherkin criteria | P1 |
| 5 | **Extension System** | npm-based plugins with lifecycle hooks | `planr extend` — local plugins in `.planr/extensions/` with hook-based API | P2 |
| 6 | **Preset / Stack System** | Stackable YAML presets | `planr preset` — composable project profiles (tech stack + rules + templates) | P2 |
| 7 | **More Agent Targets** | 30+ agents | Expand from 3 to 15+ common agents | P1 |
| 8 | **Spec Validation** | Schema + constitution validation | `planr validate` — check artifacts against templates and constitution | P1 |
| 9 | **Artifact Versioning** | `speckit diff` for spec changes | `planr diff <artifactId>` — git-based artifact change history | P2 |
| 10 | **Feedback-Driven Refinement** | Review with structured feedback input | `planr refine --feedback "..." --file feedback.md` — refine based on specific feedback | P1 |

### Nice-to-Have Gaps (Lower Priority)

| # | Gap | Description | Priority |
|---|-----|-------------|----------|
| 11 | **Watch Mode** | Auto-regenerate agent rules when artifacts change | P3 |
| 12 | **Dependency Graph Visualization** | ASCII or HTML dependency chart | P3 |
| 13 | **Multi-Project Support** | Monorepo with shared constitution | P3 |
| 14 | **Collaboration** | Comments/annotations on artifacts | P3 |
| 15 | **Metrics Dashboard** | Planning velocity, estimation accuracy, refinement cycles | P2 |

---

## OpenPlanr Advantages

Features OpenPlanr has that spec-kit lacks — these are differentiators to protect and strengthen:

| Advantage | Description | spec-kit Gap |
|-----------|-------------|-------------|
| **Full Agile Hierarchy** | Epic > Feature > Story > Task with enforced parent-child relationships | spec-kit has flat specs, no hierarchy |
| **Gherkin Acceptance Criteria** | Auto-generated `.feature` files for every user story | spec-kit has acceptance criteria in YAML, not Gherkin |
| **Sprint Management** | Create, assign, track, close sprints with velocity history | No sprint concept |
| **Backlog with AI Prioritization** | Capture → prioritize → promote workflow | No backlog system |
| **ADR System** | Architecture Decision Records as first-class artifacts | No ADR support |
| **Quick Tasks** | Lightweight tasks that can be promoted into the hierarchy | No equivalent |
| **Template Save/Reuse** | Save any task list as a reusable template | Templates exist but can't be created from existing work |
| **GitHub Bi-directional Sync** | Push artifacts to Issues, sync status both ways | One-way export only |
| **Cross-Reference Repair** | `planr sync` validates and fixes broken links | Validation only, no auto-repair |
| **Cascade Operations** | `planr plan` and `planr refine --cascade` operate across the full hierarchy | Single-level operations |
| **Estimation** | AI story point estimation with confidence levels | No estimation |
| **Node.js Ecosystem** | Same language as most web projects — easy to extend | Ruby-based, harder for web devs |

---

## Roadmap

### Phase 1: Foundation Hardening (v1.3)

**Timeline:** Current (in progress)
**Theme:** Code quality, security, error handling, test coverage

Already tracked in QT-002. Remaining work:

- [ ] Release 3: Error message improvements (user-facing, actionable messages)
- [ ] Release 4: Test coverage (unit tests for core services)
- [ ] Non-interactive mode (`--yes` flag for agent-friendly execution)

### Phase 2: Intelligence Layer (v1.4)

**Timeline:** After v1.3
**Theme:** Make OpenPlanr's AI capabilities match and exceed spec-kit's analysis depth

#### 2.1 — Constitution System

A constitution is a markdown document that establishes project-wide rules enforced across all AI generation:

```bash
planr constitution init              # create .planr/constitution.md with starter template
planr constitution edit              # open in editor
planr constitution show              # display current constitution
```

**Constitution file (`.planr/constitution.md`):**
```markdown
# Project Constitution

## Coding Standards
- Use TypeScript strict mode
- All functions must have JSDoc comments
- No `any` types — use `unknown` with type guards

## Architecture Rules
- Services must not import from CLI layer
- All external I/O must go through service abstractions
- Database access only through repository pattern

## Testing Rules
- Every public function must have unit tests
- Integration tests for all API endpoints
- Minimum 80% code coverage

## Security Rules
- No secrets in code — use environment variables
- All user input must be validated with Zod
- API endpoints require authentication
```

**How it works:**
- Constitution content is injected into every AI prompt (epic, feature, story, task, refine, estimate)
- `planr analyze` validates all artifacts against constitution rules
- `planr validate` checks a single artifact against constitution

#### 2.2 — Semantic Analysis (`planr analyze`)

```bash
planr analyze                        # full project analysis
planr analyze --epic EPIC-001        # scope to one epic
planr analyze --pass completeness    # run specific pass only
planr analyze --fix                  # auto-fix issues found
```

**5 analysis passes:**

| Pass | What It Checks |
|------|---------------|
| **Completeness** | Missing acceptance criteria, empty sections, undefined dependencies, stories without Gherkin |
| **Coherence** | Naming consistency, conflicting requirements between artifacts, duplicate functionality |
| **Dependency** | Circular dependencies, missing prerequisites, orphaned artifacts |
| **Risk** | Unclear scope, unbounded stories, missing NFRs, security gaps |
| **Alignment** | Constitution compliance, ADR adherence, tech stack consistency |

**Output:** Structured report with severity levels (error, warning, info) and suggested fixes.

#### 2.3 — Ambiguity Resolution (`planr clarify`)

```bash
planr clarify EPIC-001               # identify ambiguities in an epic
planr clarify FEAT-002 --auto        # auto-resolve with AI suggestions
planr clarify US-003 --interactive   # guided Q&A to resolve ambiguities
```

The AI reads the artifact and its parent chain, then:
1. Identifies unclear or ambiguous requirements
2. Generates specific clarifying questions
3. In `--interactive` mode, asks the user each question and updates the artifact
4. In `--auto` mode, proposes reasonable defaults and applies them

#### 2.4 — Feedback-Driven Refinement

```bash
planr refine EPIC-001 --feedback "needs more focus on mobile UX"
planr refine FEAT-002 --file review-notes.md
planr refine US-003 --feedback "acceptance criteria too vague" --cascade
```

Extends the existing `refine` command to accept structured feedback input instead of relying solely on the AI's self-review.

#### 2.5 — Artifact Validation (`planr validate`)

```bash
planr validate                       # validate all artifacts
planr validate EPIC-001              # validate single artifact
planr validate --fix                 # auto-fix schema issues
```

Checks:
- Frontmatter schema compliance (required fields, correct types)
- Constitution rule adherence
- Template conformance
- Cross-reference integrity (superset of `sync`)

#### 2.6 — Expanded Agent Targets (15+)

Add support for generating agent configuration for:

| Agent | Config File | Priority |
|-------|------------|----------|
| GitHub Copilot | `.github/copilot-instructions.md` | P0 |
| Windsurf / Codeium | `.windsurfrules` | P0 |
| Aider | `.aider.conf.yml` + `CONVENTIONS.md` | P1 |
| Cline | `.cline/rules.md` | P1 |
| Continue | `.continue/config.json` | P1 |
| Amazon Q | `.amazonq/rules.md` | P1 |
| JetBrains AI | `.junie/guidelines.md` | P2 |
| Sourcegraph Cody | `.cody/instructions.md` | P2 |
| Tabnine | `.tabnine/config.json` | P2 |
| Devin | `devin.md` | P2 |
| Replit Agent | `.replit/agent.md` | P2 |
| Sweep | `sweep.yaml` | P3 |

Each target follows the same pattern: read the project's artifacts, constitution, and ADRs → render through a Handlebars template → write the config file.

### Phase 3: Extension Ecosystem (v1.5)

**Timeline:** After v1.4
**Theme:** Make OpenPlanr extensible and customizable

#### 3.1 — Local Extension System

Extensions live in `.planr/extensions/` as JavaScript/TypeScript modules:

```
.planr/extensions/
├── my-validator/
│   ├── index.ts
│   └── package.json
└── custom-template/
    ├── index.ts
    └── package.json
```

**Extension API:**

```typescript
import type { PlanrExtension } from 'openplanr';

export default {
  name: 'my-validator',
  version: '1.0.0',

  hooks: {
    // Runs before AI generation — modify the prompt
    'pre-generate': async (context) => {
      context.messages.push({
        role: 'system',
        content: 'Additional context from my extension...',
      });
    },

    // Runs after generation — transform the output
    'post-generate': async (artifact) => {
      // Add custom sections, reformat, etc.
      return artifact;
    },

    // Custom validation rule for `planr analyze`
    'validate': async (artifact) => {
      const issues = [];
      if (!artifact.data.owner) {
        issues.push({ severity: 'warning', message: 'Missing owner field' });
      }
      return issues;
    },

    // Custom agent config generator
    'agent-config': async (context) => {
      return {
        filename: '.my-agent/config.md',
        content: renderMyAgentConfig(context),
      };
    },
  },
} satisfies PlanrExtension;
```

**Lifecycle hooks:**

| Hook | When It Runs | Use Case |
|------|-------------|----------|
| `pre-generate` | Before any AI generation | Add context, modify prompts |
| `post-generate` | After AI generation, before write | Transform output |
| `validate` | During `planr analyze` / `planr validate` | Custom validation rules |
| `agent-config` | During `planr rules generate` | Custom agent targets |
| `pre-export` | Before `planr export` | Add custom sections to reports |
| `post-init` | After `planr init` | Scaffold project-specific files |

**Commands:**

```bash
planr extend list                    # list installed extensions
planr extend add <path-or-npm>       # install extension
planr extend remove <name>           # remove extension
planr extend create <name>           # scaffold a new extension
```

#### 3.2 — Preset System

Presets are published npm packages or local directories that bundle: constitution fragments, templates, validation rules, and agent config snippets.

```bash
planr preset add @openplanr/preset-react
planr preset add @openplanr/preset-typescript
planr preset add ./my-team-preset
planr preset list
planr preset remove <name>
```

**Preset structure:**

```
@openplanr/preset-react/
├── constitution.md        # Merged into project constitution
├── templates/             # Additional task templates
│   ├── react-component.json
│   └── react-hook.json
├── validation-rules.ts    # Custom validation rules
├── agent-snippets/        # Injected into agent configs
│   ├── cursor.md
│   └── claude.md
└── preset.json            # Metadata and configuration
```

**Stacking:** Presets compose — later presets override earlier ones. Constitution fragments are concatenated. Templates are merged (later wins on name conflicts). Validation rules are additive.

```json
// .planr/config.json
{
  "presets": [
    "@openplanr/preset-typescript",
    "@openplanr/preset-react",
    "@openplanr/preset-testing-library"
  ]
}
```

### Phase 4: Multi-Agent Orchestration (v2.0)

**Timeline:** After v1.5
**Theme:** Go beyond spec-kit — orchestrate the full development lifecycle

#### 4.1 — Guided Implementation (`planr implement`)

```bash
planr implement TASK-001                     # guided implementation for a task
planr implement TASK-001 --subtask 3         # specific subtask
planr implement TASK-001 --tdd              # test-first enforcement
planr implement TASK-001 --agent cursor     # target specific agent
```

**What it does:**
1. Reads the task, its parent chain (story → feature → epic), Gherkin criteria, and ADRs
2. Generates an implementation plan with file-by-file changes
3. In `--tdd` mode: generates test files first, then implementation files
4. Outputs agent-ready instructions (paste into Cursor, Claude Code, etc.)
5. After implementation, validates against Gherkin acceptance criteria

**Output:** `.planr/implementations/TASK-001-impl.md` — a structured implementation guide the coding agent follows.

#### 4.2 — Acceptance Gating (`planr verify`)

```bash
planr verify US-001                          # verify story acceptance criteria
planr verify TASK-001                        # verify task completion
planr verify --epic EPIC-001                 # verify all under an epic
```

**What it does:**
1. Reads the Gherkin acceptance criteria
2. Scans the codebase for matching test files
3. Runs the test suite (or checks test results)
4. Reports which scenarios pass/fail
5. Updates artifact status based on results

#### 4.3 — Artifact Versioning (`planr diff`)

```bash
planr diff EPIC-001                          # show changes since creation
planr diff FEAT-002 --since "2026-04-01"     # changes since date
planr diff US-003 --commits                  # show git commits that touched this artifact
```

Uses git history to track artifact evolution. Useful for sprint retrospectives and audit trails.

#### 4.4 — Metrics Dashboard (`planr metrics`)

```bash
planr metrics                                # project-wide metrics
planr metrics --sprint SPRINT-001            # sprint-specific
planr metrics --format json                  # machine-readable
```

**Metrics tracked:**
- Planning velocity (artifacts created per sprint)
- Estimation accuracy (estimated vs actual story points)
- Refinement cycles (how many refine passes per artifact)
- Completion rate (tasks completed vs created)
- Acceptance pass rate (Gherkin scenarios passing)
- Agent productivity (tasks completed per agent session)

#### 4.5 — Watch Mode (`planr watch`)

```bash
planr watch                                  # watch all artifacts
planr watch --rules                          # auto-regenerate agent rules on change
planr watch --sync                           # auto-sync with GitHub on change
```

File watcher that auto-triggers actions when artifacts are modified:
- Regenerate agent rules when any artifact changes
- Run validation when artifacts are saved
- Sync with GitHub on status changes

---

## Proposed New Commands

Summary of all new commands across phases:

| Command | Phase | Description |
|---------|-------|-------------|
| `planr constitution init` | 2 | Create constitution template |
| `planr constitution edit` | 2 | Open constitution in editor |
| `planr constitution show` | 2 | Display constitution |
| `planr analyze` | 2 | 5-pass semantic analysis |
| `planr clarify` | 2 | Ambiguity resolution |
| `planr validate` | 2 | Schema + constitution validation |
| `planr extend list/add/remove/create` | 3 | Extension management |
| `planr preset add/list/remove` | 3 | Preset management |
| `planr implement` | 4 | Guided implementation |
| `planr verify` | 4 | Acceptance gating |
| `planr diff` | 4 | Artifact versioning |
| `planr metrics` | 4 | Metrics dashboard |
| `planr watch` | 4 | File watcher for auto-actions |

**Existing command enhancements:**

| Command | Enhancement | Phase |
|---------|-------------|-------|
| `planr refine` | `--feedback` and `--file` flags | 2 |
| `planr rules generate` | 15+ agent targets (up from 3) | 2 |
| `planr init` | Constitution setup, preset selection | 2-3 |
| `planr plan` | Constitution-aware generation | 2 |
| `planr sync` | Merged into `planr validate` as a subset | 2 |
| `planr export` | Extension-contributed sections | 3 |

---

## Architecture Decisions

### Constitution as Markdown (Not YAML)

spec-kit uses YAML for its constitution. We choose markdown because:
- Consistent with all other OpenPlanr artifacts
- Easier to read and write for non-technical stakeholders
- Can include code examples naturally
- Parseable with existing frontmatter + body pattern

### Extensions as Local-First

spec-kit extensions are npm packages. We start local-first (`.planr/extensions/`) because:
- Zero friction to create — no npm publish required
- Team-specific extensions stay in the repo
- Can upgrade to npm-published extensions later without breaking local ones

### Preserve Agile Hierarchy

spec-kit uses flat specs. We keep our Epic > Feature > Story > Task hierarchy because:
- Maps directly to agile methodology teams already use
- Enables cascade operations (`plan`, `refine --cascade`)
- Parent chain provides rich context for AI generation
- Cross-reference system (`sync`) maintains integrity

### Agent Targets via Templates

Each agent target is a Handlebars template (existing pattern). New targets are added by:
1. Creating a template in `src/templates/rules/<agent>/`
2. Registering in the rules service
3. No code changes needed for the generation pipeline

This pattern scales to 30+ targets without architecture changes.

---

## Success Metrics

| Metric | Current | v1.4 Target | v2.0 Target |
|--------|---------|-------------|-------------|
| CLI Commands | 20 | 28 | 35 |
| Agent Targets | 3 | 15 | 25+ |
| AI Analysis Passes | 0 | 5 | 5+ custom |
| Extension Hooks | 0 | 0 | 6 |
| Built-in Templates | 5 | 8 | 12+ |
| Test Coverage | ~20% | 60% | 80% |

---

## Prioritized Implementation Order

1. **v1.3** — Finish hardening (error messages, test coverage, `--yes` flag)
2. **v1.4.0** — Constitution system + semantic analysis (`analyze`)
3. **v1.4.1** — Feedback-driven refinement (`refine --feedback`)
4. **v1.4.2** — Ambiguity resolution (`clarify`) + validation (`validate`)
5. **v1.4.3** — Expanded agent targets (15+)
6. **v1.5.0** — Local extension system
7. **v1.5.1** — Preset system
8. **v2.0.0** — Guided implementation, acceptance gating, metrics, watch mode
