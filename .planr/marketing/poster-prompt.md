# Infographic Poster Prompt — `planr-pipeline` two-phase walkthrough

> **Status:** v0.7.0-aligned. Updated 2026-04-30 after the `openplanr-pipeline` → `planr-pipeline` rename.
> **Use:** paste the prompt block below into a senior editorial designer (or AI design tool — Claude, GPT, v0.dev, Lovable) to generate a single-file 1080px portrait HTML poster for social distribution.
> **Format:** the entire body of this file IS the prompt. Don't add commentary above the `═══` masthead when handing it off.

---

You are a senior editorial designer. Build a SINGLE premium infographic poster
as one self-contained HTML file. 1080px wide, portrait format for social media.

═══════════════════════════════════════════════════════════════
WHAT THIS IS
═══════════════════════════════════════════════════════════════
A high-level visual walkthrough of the `planr-pipeline` Claude Code plugin
using a REAL scenario: shipping a "todo list" feature from a one-line idea
to a PR-ready branch.

The poster follows the actual two-phase architecture from the codebase:
  PO PHASE  (/planr-pipeline:plan todo)
  HUMAN REVIEW GATE  (mandatory, pipeline cannot auto-chain)
  DEV PHASE  (/planr-pipeline:ship todo)

Each phase shows which agent fires, what it reads, what it writes, and
what the human sees. This is not a spec doc, it is a story. The reader
should feel the sequence, understand the split, and trust the gate.

`planr-pipeline` is the canonical Claude Code adapter for OpenPlanr
Protocol v1.0.0. The same workflow runs on Cursor and Codex via
planr-generated rule files, but this poster focuses on the canonical
Claude Code path for narrative tightness.

TARGET AUDIENCE: senior developers and engineering leads, skeptical,
technical, evaluating whether to adopt.
TONE: precise, sequential, quietly impressive. Like a well-designed
engineering diagram with editorial clarity.

═══════════════════════════════════════════════════════════════
DESIGN SYSTEM, DEFINE ONCE, APPLY EVERYWHERE
═══════════════════════════════════════════════════════════════

CANVAS
  width: 1080px
  height: auto (content-driven, expect ~1600 to 1800px)
  padding: 56px all sides, never broken
  background: #09090b

COLOR PALETTE, 7 tokens only
  --bg:        #09090b
  --surface:   #111113   all card/step backgrounds
  --surface-2: #1a1a1f   inner cells, code blocks, tag backgrounds
  --ink:       #f4f4f5   primary text
  --muted:     #8b8b9a   secondary text, captions, labels
  --faint:     #3f3f46   borders, dividers, lines
  --accent:    #16a34a   OpenPlanr green

  PHASE COLORS, used ONLY for phase lane backgrounds (at 6% opacity),
  phase header labels, step number badges, and left-border stripes:
  --po:    #8b5cf6   violet  (PO Phase, planning and decomposition)
  --gate:  #f59e0b   amber   (Human Review Gate, the human moment)
  --dev:   #3b82f6   blue    (DEV Phase, code generation)
  --qa:    #16a34a   green   (QA Gate within DEV, same as accent)
  --ship:  #f97316   orange  (Ship outputs, final artifacts)

TYPOGRAPHY, 2 families, 5 sizes, zero deviations
  Geist + Geist Mono from Google Fonts

  --t-display: 52px / 800 / -0.045em / lh 0.97   title only
  --t-h2:      17px / 700 / -0.025em / lh 1.2    step titles, card titles
  --t-body:    13px / 400 / normal   / lh 1.7    descriptions
  --t-caption: 10px / 400 / +0.12em / lh 1.4    Geist Mono, uppercase
  --t-stat:    46px / 800 / -0.05em / lh 1.0    hero stats, tabular-nums

CARD DNA, same on every card
  background:    var(--surface)
  border:        1px solid var(--faint)
  border-radius: 10px
  padding:       18px 20px
  No shadows, no gradients.

STEP CARD (used in phase lanes)
  Left border: 3px solid [phase color]
  Step number badge: top-left, circular, 22px, [phase color] bg at 15%,
    [phase color] text, Geist Mono 10px font-weight 600
  Agent badge: top-right, Geist Mono 9px uppercase, [phase color] bg 10%,
    [phase color] border at 30%, [phase color] text

SCENARIO CALLOUT (the "what you see" boxes)
  background: var(--surface-2)
  border: 1px solid var(--faint)
  border-radius: 8px
  padding: 12px 14px
  font: Geist Mono 11px, color var(--muted)
  Left label: t-caption in [phase color]: "YOU SEE"

ARTIFACT TAG (small inline file path tags)
  font: Geist Mono 9px
  bg: rgba(244,244,245,0.06)
  border: 1px solid var(--faint)
  border-radius: 3px
  padding: 1px 6px
  color: var(--ink)

═══════════════════════════════════════════════════════════════
LAYOUT, TOP TO BOTTOM
═══════════════════════════════════════════════════════════════

━━━ MASTHEAD (no card container) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Eyebrow (t-caption, --muted):
    PLANR-PIPELINE  ·  v0.7.0  ·  CLAUDE CODE  ·  REAL SCENARIO WALKTHROUGH

  Title (t-display, --ink):
    From idea to PR.
    Two commands.
    One human review.

  Subtitle (15px, --muted, max-width 600px):
    A real walkthrough, shipping a "todo list" feature using the
    `planr-pipeline` two-phase pipeline. PO agents plan first. You review.
    DEV agents build second. The split is non-negotiable. The same
    workflow runs on Cursor and Codex via planr-generated rules.

━━━ DIVIDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1px --faint full width

━━━ SCENARIO SETUP CARD (full width) ━━━━━━━━━━━━━━━━━━━━━━━━
card, no phase border

  Left half:
    Caption: THE SCENARIO
    Title (t-h2): Build a "todo list" feature from scratch
    Body: You have a spec in mind. The database schema is live.
    You have a PNG mockup in your downloads folder.
    You want code, tests, Docker config, and docs, without
    writing a single prompt for each step.

  Right half (code block style, --surface-2 bg):
    Caption: STARTING POINT
    Lines (Geist Mono 11.5px):
      input/tech/stack.md       ← you authored this once
      .planr/specs/             ← empty, will be created
      ~/Designs/todo-ui.png     ← mockup you have

━━━ PHASE LANE: PO PHASE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase lane wrapper:
  background: rgba(139,92,246,0.04), barely visible violet tint
  border: 1px solid rgba(139,92,246,0.14)
  border-radius: 12px
  padding: 20px
  display: flex, flex-direction: column, gap: 14px

Phase lane header (inside lane, above steps):
  Left: violet dot (6px circle) + t-caption in --po: PO PHASE
  Mid: 1px --faint rule, flex:1
  Right: t-caption --muted: /planr-pipeline:plan todo

  Below header, command chip:
    Geist Mono 12px, bg rgba(139,92,246,0.08), border rgba(139,92,246,0.25),
    color --po, padding 8px 16px, border-radius 7px, full width text-center:
    $ /planr-pipeline:plan todo

STEP CARDS in PO PHASE, stacked vertically, left border violet:

  ── STEP 1 ─────────────────────────────────────────────────
  Step badge: 1  Agent badge: db-agent · Sonnet 4.6

  Title: Schema introspection
  Body: Reads input/tech/stack.md to find database type.
  Connects to the live database (PostgreSQL or MongoDB) to
  introspect the schema. Writes a structured schema summary
  that all subsequent agents use as context.

  Reads: input/tech/stack.md  (live DB connection)
  Writes: .planr/specs/SPEC-001-todo/db-schema-snapshot.md

  Scenario callout (YOU SEE):
    db-agent connected to PostgreSQL
    Found 3 tables: users, items, lists
    Wrote schema snapshot, 47 lines

  ── STEP 2 ─────────────────────────────────────────────────
  Step badge: 2  Agent badge: designer-agent · Sonnet 4.6

  Title: PNG to design spec
  Body: Only fires if PNG files exist in the spec's design/ folder.
  Reads the mockup images, analyzes layout, component hierarchy,
  and visual patterns. Writes a structured design-spec.md that
  the frontend-agent will read during code generation.

  Reads: .planr/specs/SPEC-001-todo/design/todo-ui.png
  Writes: .planr/specs/SPEC-001-todo/design-spec.md

  Scenario callout (YOU SEE):
    designer-agent processed todo-ui.png
    Identified: TodoList component, AddTodo form, FilterBar
    Wrote design-spec.md, component tree + interaction notes

  ── STEP 3 ─────────────────────────────────────────────────
  Step badge: 3  Agent badge: specification-agent · Sonnet 4.6

  Title: Spec to User Stories and tasks
  Body: Reads the authored spec, the db schema snapshot, and the
  design spec. Decomposes into User Stories with Gherkin acceptance
  criteria, and granular task files that name exact files to
  create, modify, or preserve. No code is written here.

  Reads: SPEC-001-todo.md  db-schema-snapshot.md  design-spec.md
  Writes:
    stories/US-001-create-todo.md
    stories/US-002-list-todos.md
    tasks/T-001-db-migration.md
    tasks/T-002-backend-api.md
    tasks/T-003-frontend-ui.md
    tasks/T-004-tests.md

  Scenario callout (YOU SEE):
    PO Phase complete. Review before proceeding.
    .planr/specs/SPEC-001-todo/ now has 2 stories, 4 tasks.
    Pipeline stopped. It will NOT auto-proceed to DEV Phase.

━━━ HUMAN REVIEW GATE (full width, amber) ━━━━━━━━━━━━━━━━━━━

Gate wrapper:
  background: rgba(245,158,11,0.05)
  border: 1px solid rgba(245,158,11,0.22)
  border-radius: 12px
  padding: 22px 24px
  display: grid, grid-template-columns: 1fr auto

Left side:
  Top row: amber dot (6px) + t-caption --gate: HUMAN REVIEW GATE
    + t-caption --muted "Rule R1, Pipeline cannot auto-chain phases"

  Title (t-h2, --ink):
    Open the task files. Edit anything. Then ship.

  Body (t-body, --muted):
    The pipeline stops here by design. Rule R1 is non-negotiable:
    PO Phase and DEV Phase are two separate commands with a mandatory
    human review between them. Open tasks/T-*.md and verify the
    decomposition, file paths, acceptance criteria, agent assignments.
    Edit, add, remove. When you are satisfied, run /ship.

  Below body, 3 inline chips in a row:
    Chip 1: amber bg/border/text, "open tasks/T-*.md"
    Chip 2: amber bg/border/text, "verify file paths"
    Chip 3: amber bg/border/text, "run /ship when ready"

Right side (text-align right):
  Large amber "R1" (38px / 800 / --gate color)
  t-caption --muted: THE IRON RULE
  t-body --muted: "Never auto-chain."

━━━ PHASE LANE: DEV PHASE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Phase lane wrapper:
  background: rgba(59,130,246,0.04)
  border: 1px solid rgba(59,130,246,0.14)
  border-radius: 12px
  padding: 20px
  display: flex, flex-direction: column, gap: 14px

Phase lane header:
  Left: blue dot + t-caption --dev: DEV PHASE
  Mid: 1px --faint rule
  Right: t-caption --muted: /planr-pipeline:ship todo

  Command chip (blue variant):
    $ /planr-pipeline:ship todo

STEP CARDS in DEV PHASE, 2-column grid where parallel agents
run side by side. Serial agents span full width.

  ── STEP 4, 2 COLUMNS, parallel ──────────────────────────

  LEFT, frontend-agent · Opus 4.7
  Title: UI components
  Body: Reads tasks/T-003-frontend-ui.md and design-spec.md.
  Generates React components matching the mockup exactly.
  Writes to src/components/ and src/pages/ only.
  Reads: T-003  design-spec.md  stack.md
  Writes: src/components/TodoList.tsx  src/pages/todos.tsx

  RIGHT, backend-agent · Opus 4.7
  Title: API and migrations
  Body: Reads tasks/T-001 and T-002. Generates the database
  migration, Prisma schema update, and API route handlers.
  Has psql and node access, no git push.
  Reads: T-001  T-002  db-schema-snapshot.md  stack.md
  Writes: migrations/0001_todos.sql  src/api/todos.ts

  Scenario callout below the 2-col row (YOU SEE, blue):
    frontend-agent and backend-agent running in parallel
    frontend: generating TodoList, AddTodo, FilterBar components
    backend: generating migration + 4 API endpoints

  ── STEP 5, full width ────────────────────────────────────
  Step badge: 5  Agent badge: qa-agent · Sonnet 4.6
  Left border: --accent green
  Phase badge: HARD GATE (green)

  Title (color --accent): QA gate, build, test, lint, coverage
  Body: Runs the full build and test suite from stack.md commands.
  If anything fails, the pipeline writes an error-report.md and
  halts. It retries up to 3 times before giving up. devops-agent
  and doc-gen-agent are never dispatched on a failing build.

  Reads: all src/**  stack.md (for test/build commands)
  Writes: qa-report.md (on failure: error-report.md + HALT)

  Scenario callout (YOU SEE, green):
    npm run build, passed
    npm test -- --run, 14/14 passed
    QA gate cleared. Dispatching Group B.

  ── STEP 6, 2 COLUMNS, parallel ──────────────────────────

  LEFT, devops-agent · Sonnet 4.6
  Title: Docker and CI config
  Body: Reads the stack and generates Dockerfile, docker-compose,
  and GitHub Actions workflow. Verifies with docker build dry-run.
  Zero Bash execution, tool-layer enforced, not prompt-enforced.
  Reads: stack.md  src/**
  Writes: Dockerfile  docker-compose.yml  .github/workflows/ci.yml

  RIGHT, doc-gen-agent · Sonnet 4.6
  Title: Feature documentation
  Body: Reads User Stories and generated code to write the feature
  docs. Writes Docs/feat-todo/ with API reference, usage guide,
  and component docs. Source code is never touched.
  Reads: stories/**  src/**  tasks/**
  Writes: Docs/feat-todo/  README.md (updated section)

  Scenario callout below (YOU SEE, orange):
    devops-agent: Dockerfile + GitHub Actions workflow written
    doc-gen-agent: Docs/feat-todo/, 3 files, API reference complete

━━━ SHIP CARD (full width, green) ━━━━━━━━━━━━━━━━━━━━━━━━━━━

Card:
  border-left: 3px solid --accent
  background: --surface
  display: grid, grid-template-columns: 1fr 1fr, gap: 24px

Left:
  Eyebrow (t-caption, --accent, with filled green dot):
    PIPELINE COMPLETE  ·  .pipeline-shipped written
  Title (t-h2): Your feature is PR-ready.
  Body: The pipeline writes .planr/specs/SPEC-001-todo/.pipeline-shipped
  with a full audit log: agents that ran, tasks completed, build status,
  timestamps, and runtime. A branch with this marker passed every gate.

Right (code block, --surface-2):
  Label (t-caption, --accent): WHAT SHIPPED
  Lines (Geist Mono 11.5px):
    ✓  src/components/TodoList.tsx
    ✓  src/pages/todos.tsx
    ✓  src/api/todos.ts
    ✓  migrations/0001_todos.sql
    ✓  tests/ (14 tests, all passing)
    ✓  Dockerfile + docker-compose.yml
    ✓  .github/workflows/ci.yml
    ✓  Docs/feat-todo/
    ────────────────────────────────
    ✓  .pipeline-shipped  ← proof    (this line in --accent color)

━━━ DIVIDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ FOOTER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Flex row, space-between:
  Left  (t-caption, --muted): openplanr.dev  ·  github.com/openplanr  ·  MIT License
  Mid:  1px --accent vertical rule, 20px tall
  Right (Geist Mono 11px, --accent, weight 500): $ npm i -g openplanr

  Below footer row, full-width centered (t-caption, --muted):
    PLANR-PIPELINE v0.7.0  ·  PROTOCOL v1.0.0  ·  RUNS ON CLAUDE CODE · CURSOR · CODEX

═══════════════════════════════════════════════════════════════
VISUAL DETAILS
═══════════════════════════════════════════════════════════════

ARTIFACT TAGS (file paths inside step cards)
  Reads/Writes sections inside each step:
    Label: t-caption "READS" or "WRITES" in --muted
    File tags: Geist Mono 9px, bg rgba(244,244,245,0.06),
      border 1px solid var(--faint), color --ink,
      padding 1px 6px, border-radius 3px, displayed as flex-wrap row

READS tags have a subtle left indicator in --muted.
WRITES tags have a subtle left indicator in --accent.

PARALLEL STEP INDICATOR
  When two agents run side by side, show a thin row above the 2-col
  grid with: t-caption --muted "PARALLEL" and two short arrow lines
  pointing down to each column.

MODEL BADGE
  Each agent badge includes the model in parentheses:
  "frontend-agent  ·  Opus 4.7"
  "qa-agent  ·  Sonnet 4.6"
  Opus agents (frontend, backend) get slightly brighter text to
  signal they are the heavier model, no color change, just
  font-weight 600 vs 400.

NO em dashes anywhere. Commas, colons, line breaks only.
NO empty spacer divs.
NO gradients, glows, box-shadows.
Code in descriptions always in inline code style (defined above).

═══════════════════════════════════════════════════════════════
OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════
Single self-contained HTML file.
All CSS in <style> block, all values via CSS variables.
No inline styles on elements, classes only.
Google Fonts import (Geist + Geist Mono) at top of <style>.
Body background: #1c1c1e (dark preview wrapper).
Poster div: 1080px wide, margin: 0 auto.
No JavaScript. No external assets.
