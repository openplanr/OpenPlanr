# Demo Video Script — Claude Code walkthrough

> **Status:** v0.7.1-aligned. **Length:** 4:00. **Tool:** Screen Studio. **Audio:** lo-fi instrumental, no voice. **Style:** screen-only, text overlays.
> **Project:** AI-augmented customer support inbox.
> **Requires:** planr-pipeline **v0.7.3+** (Orchestration Contract + Completion Contract + designed asset stash). Earlier versions can silently abandon mid-execution on greenfield projects.
> **What the demo shows:** the user types `/planr-pipeline:plan` + a short brief on a greenfield directory. The pipeline auto-detects the state, scaffolds Next.js, bootstraps `.planr/`, authors the spec, and runs PO Phase — all in one shot, no consent prompt. After a 30-second human review, `/planr-pipeline:ship` and the feature ships. Premium, restrained, end-to-end.

---

## The two prompts (the entire on-camera input)

### Prompt 1 — `/planr-pipeline:plan` (the trigger)

```
/planr-pipeline:plan support-inbox

AI-augmented customer support inbox.

Tickets auto-classified by Claude (budget cap + retry). Inbox + thread view with AI suggestion panel (Use / Refine / Dismiss). Strict state machine.

Stack: Next.js 14 + Prisma + Postgres + Redis + Anthropic SDK + Vitest.
Mockups: ~/Designs/inbox-list.png + inbox-thread.png.
```

### Prompt 2 — `/planr-pipeline:ship` (after review)

```
/planr-pipeline:ship support-inbox
```

That's the entire on-camera input. **Two slash commands, ~50 words of brief.** Everything else is the system.

---

## Pre-recording prep (5 minutes)

1. **Empty git repo** at `~/demos/support-inbox/`:
   ```bash
   mkdir -p ~/demos/support-inbox && cd ~/demos/support-inbox && git init
   echo "node_modules/" > .gitignore
   git add . && git commit -m "chore: empty"
   ```

2. **Live Postgres + Redis**:
   ```bash
   docker run -d --name inbox-pg -p 5432:5432 -e POSTGRES_USER=app -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=support_inbox postgres:16
   docker run -d --name inbox-redis -p 6379:6379 redis:7-alpine
   ```

3. **Two PNG mockups** at `~/Designs/inbox-list.png` and `~/Designs/inbox-thread.png` (30-min Figma sketches).

4. **Prompt 1 in your clipboard.**

5. **Practice the flow once.** Make sure Claude Code with the plugin loaded actually orchestrates from this prompt.

6. Mac quiet, terminal clean (`#0a0a0a`, JetBrains Mono 16pt, `clear; history -c`), Claude Code fullscreen, music loaded.

---

## Production timing — total 4:00

```
0:00 – 0:08   HOOK
0:08 – 0:18   THE SETUP — empty project, plugin loaded
0:18 – 0:35   THE PROMPT — /pl autocomplete → paste brief → Enter
0:35 – 1:30   ORCHESTRATION — auto-scaffold + planr init + spec + asset stash (sped up 12×)
1:30 – 2:15   PO PHASE — db / designer / specification agents
2:15 – 2:45   HUMAN REVIEW (the R1 gate)
2:45 – 3:50   DEV PHASE — frontend ‖ backend → qa → devops ‖ doc-gen
3:50 – 4:00   PAYOFF + CTA
```

---

## Block-by-block script

### `[0:00 – 0:08]` HOOK

**Screen:** openplanr.dev hero (or new GitHub README hero).

**Text overlay (sequenced, 4s each):**

> "Plan once. Ship with agents."
>
> "One slash command. From spec to PR."

---

### `[0:08 – 0:18]` THE SETUP

**Screen:** quick cuts (~2s each):

1. Terminal: `cd ~/demos/support-inbox && ls` → empty
2. Terminal: `docker ps` → Postgres + Redis running
3. Two PNG mockups in Preview, side-by-side

**Text overlay:**

> "Empty project. Postgres + Redis live. Mockups ready."

---

### `[0:18 – 0:35]` THE PROMPT

**Screen:** Claude Code window, fullscreen, empty conversation. **This is the hero shot of the demo.**

**Action 1 — Type `/pl`** (slow, deliberate, ~2s).

The autocomplete dropdown appears showing:

```
/planr-pipeline:plan       (planr-pipeline) Run the PO Phase pipeline for a single feature
/planr-pipeline:ship       (planr-pipeline) Run the DEV Phase pipeline for a feature
/openplanr                 Agile planning CLI for coding agents
...
```

**Hold the autocomplete on screen for 1.5 seconds** (it does the marketing work — viewers see the plugin's commands listed by name).

**Text overlay (during autocomplete):** *"The plugin is loaded."*

**Action 2 — Select `/planr-pipeline:plan`** (Tab or click).

The input now reads `/planr-pipeline:plan `.

**Action 3 — Type `support-inbox`** then paste the brief from clipboard:

```
/planr-pipeline:plan support-inbox

AI-augmented customer support inbox.

Tickets auto-classified by Claude (budget cap + retry). Inbox + thread view with AI suggestion panel (Use / Refine / Dismiss). Strict state machine.

Stack: Next.js 14 + Prisma + Postgres + Redis + Anthropic SDK + Vitest.
Mockups: ~/Designs/inbox-list.png + inbox-thread.png.
```

**Hold the prompt on screen for 2 seconds** (let viewers read the brevity).

**Press Enter.**

**Text overlay (sequenced):**

> "Two sentences. One stack. Two PNGs."

---

### `[0:35 – 1:30]` ORCHESTRATION — auto-scaffold, planr init, spec, asset stash

**Screen:** Claude Code agent stream. **Speed up 12× in post.** This is the dense block — viewers feel the pace, don't need to read.

The Orchestration Contract fires immediately — Claude creates a 4-item TodoWrite (Phase A → D), detects state, picks `SCAFFOLD_NODE`, and executes the full strategy without asking. **No consent prompt** — the brief's intent is unambiguous (Node stack + greenfield).

What plays out (compressed beats with text overlays):

```
[Claude Code]
Phase A — Pre-flight
  ✓ State signals: HAS_PLANR=❌  HAS_PACKAGE_JSON=❌  BRIEF_STACK=node
  ✓ Strategy: SCAFFOLD_NODE (primary framework: Next.js)
  ✓ STAGE_DESIGN_ASSETS — moved Designs/ → /tmp/planr-pipeline-stash/...
  ✓ Project root empty. Scaffolding...
  npx create-next-app@latest .
  npm i prisma @prisma/client @anthropic-ai/sdk zod ioredis
  npm i -D vitest msw @testing-library/react
  npx prisma init
✓ Project scaffolded
```

> **Text overlay:** "Scaffold."

```
✓ planr init
  Generated: .planr/, CLAUDE.md, .cursor/rules/, AGENTS.md
```

> **Text overlay:** "OpenPlanr wired in."

```
✓ WRITE_PLANR_DIRS — .planr/config.json, .planr/specs/, input/tech/
✓ AUTHOR_STACK_FROM_BRIEF — input/tech/stack.md
Phase A complete (verified).

Phase B — Mode + spec body
  ✓ Mode: spec-driven
  ✓ Creating .planr/specs/SPEC-001-support-inbox/
  ✓ Authoring SPEC body from your brief (Context, Functional, Business Rules, Acceptance)
  ✓ RESTORE_DESIGN_ASSETS — copied PNGs from stash → design/
  ✓ Stash cleaned: /tmp/planr-pipeline-stash/... removed
Phase B complete (verified).
```

> **Text overlay:** "Spec authored from your brief. Assets restored."

(Quick cut: VS Code shows `.planr/specs/SPEC-001-support-inbox/` tree with `SPEC-001-support-inbox.md`, `design/inbox-list.png`, `design/inbox-thread.png`. 1.5 seconds.)

---

### `[1:30 – 2:15]` PO PHASE

**Screen:** back to Claude Code. Speed up 7×.

```
> /planr-pipeline:plan support-inbox

> db-agent (Sonnet 4.6, READ-ONLY)
  ✓ Connected to PostgreSQL @ localhost:5432
  ✓ Wrote db-schema-snapshot.md
```

> **Text overlay:** "db-agent: live introspection."

```
> designer-agent (Sonnet 4.6)
  ✓ Read inbox-list.png + inbox-thread.png
  ✓ 9 components identified (InboxTable, AISuggestionPanel, ...)
  ✓ Wrote design-spec.md
```

> **Text overlay:** "designer-agent: 2 PNGs → 9 components."

```
> specification-agent (Sonnet 4.6)
  ✓ 4 stories, 9 tasks decomposed
    US-001 ticket-ingestion-and-classification
    US-002 inbox-list-and-filters
    US-003 conversation-thread-and-ai-suggestion
    US-004 state-transitions-and-usage-metering
    T-001  prisma schema (Tech, backend)
    T-002  webhook signature (Tech, backend)
    T-003  redis queue + worker (Tech, backend)
    T-004  anthropic client + retry + budget (Tech, backend)
    T-005  ticket state machine (Tech, backend)
    T-006  inbox list page (UI, frontend)
    T-007  thread + AI panel (UI, frontend)
    T-008  suggest + refine routes (Tech, backend)
    T-009  usage metering (Tech, backend)

✓ PO Phase complete. Pipeline stopped.
✗ Will NOT auto-chain to DEV per R1.
```

> **Text overlay (sequenced):**
>
> "4 stories. 9 tasks."
>
> Then: **"R1 — pipeline stops here."**

---

### `[2:15 – 2:45]` HUMAN REVIEW — the R1 gate

**Screen:** VS Code (different Space). File tree expanded showing `.planr/specs/SPEC-001-support-inbox/`. Open `tasks/T-004-anthropic-client-with-retry-and-budget.md`.

**Show the task** (zoom on Acceptance + Tests):

```markdown
---
taskId: T-004
type: Tech
agent: backend
priority: high
---

# T-004 — Anthropic client with retry and daily budget

## Files to create
- src/lib/anthropic.ts          ← singleton client
- src/lib/usage-tracker.ts      ← Redis daily window
- src/lib/anthropic-retry.ts    ← exp backoff (5 attempts)

## Files to preserve
- src/app/page.tsx
- next.config.ts
- package.json

## Acceptance criteria
- callClaude() handles: budget check, retry on 5xx/429, log UsageEvent
- BudgetExceeded throws when daily spend exceeds cap
- Callers fall back to canned templates on BudgetExceeded

## Tests required
- Happy path (msw mock)
- 5 retries then throw on persistent 5xx
- No retry on 400 (deterministic)
- BudgetExceeded thrown when over cap
- UsageEvent row written with correct token counts + cost_cents
```

(Slow scroll. Don't narrate.)

**Text overlay (sequenced):**

> "Every task names exact files."
>
> "Acceptance criteria. Tests required. Auditable."

(Make a small visible edit: change "5 attempts" to "7 attempts." Save.)

**Text overlay:** *"Reviewed. Bumped retries. Ship it."*

---

### `[2:45 – 3:50]` DEV PHASE

**Screen:** back to Claude Code.

**Action — type:**

```
/planr-pipeline:ship support-inbox
```

**Press Enter. Speed up 8× in post.**

```
> Story US-001: ticket ingestion + classification (5 tasks, topological)
  > backend-agent (Opus 4.7) for T-001 (Prisma schema)
    ✓ 6 models, 11 indexes
    ✓ Migration applied to live Postgres
  > backend-agent for T-002 + T-004 (parallel)
    ✓ webhook HMAC verify
    ✓ Anthropic client w/ 7-attempt retry + Redis budget cap
    ✓ 8/8 tests (msw-mocked)
  > backend-agent for T-003 + T-005
    ✓ Redis queue + classification worker
    ✓ Ticket state machine
    ✓ 17/17 tests
```

> **Text overlay:** "Topological parallel."

```
> Story US-002: inbox list (1 task)
  > frontend-agent (Opus 4.7) for T-006
    ✓ inbox/page.tsx + 4 components matching design-spec.md

> Story US-003: thread + AI suggestion (2 tasks, parallel)
  > frontend-agent for T-007 (UI)
  > backend-agent  for T-008 (suggest/refine routes)
    ✓ 9/9 tests

> Story US-004: state transitions + usage metering (1 task)
  > backend-agent for T-009 (admin/usage)
    ✓ 7/7 tests
```

> **Text overlay:** "frontend ‖ backend. Opus 4.7."

```
> qa-agent (Sonnet 4.6) — HARD GATE
  ✓ All Create files exist (38/38)
  ✓ Preserve files unchanged (page.tsx, next.config.ts, package.json)
  ✓ npm run build → exit 0 (16.4s)
  ✓ npx vitest run → 41/41 passed
  ✓ DoD checklist: 28/28
```

> **Text overlay (green):** "QA gate. 41/41 tests."

```
> devops-agent + doc-gen-agent — parallel
  ✓ Dockerfile + docker-compose.yml + CI workflow
  ✓ Docs/feat-support-inbox/ (5 pages)

> Snapshot
  ✓ CLAUDE.md refreshed
  ✓ .planr/specs/SPEC-001-support-inbox/.pipeline-shipped

PIPELINE COMPLETE. 9 tasks shipped in 7m 14s.
```

> **Text overlay (orange):** "devops ‖ doc-gen."
>
> Then (green): **"Pipeline complete."**

---

### `[3:50 – 4:00]` PAYOFF + CTA

**Screen:** VS Code, file tree (zoom):

```
support-inbox/
├── prisma/                  ← schema + migration
├── src/
│   ├── app/(inbox)/         ← list + thread pages
│   ├── app/api/             ← 5 route handlers
│   ├── components/inbox/    ← 9 components
│   ├── lib/                 ← anthropic.ts, queue.ts, ticket-state.ts
│   └── workers/
├── tests/                   ← 41 tests
├── Dockerfile + docker-compose.yml + CI
├── Docs/feat-support-inbox/ ← 5 pages
└── .planr/specs/SPEC-001-support-inbox/.pipeline-shipped
```

**Text overlay:** *"38 files. 41 tests. 5 doc pages."*

**Cut to:** terminal:

```bash
$ git add . && git commit -m "feat(support-inbox): AI-augmented ticket inbox"
[main 9f3a127] feat(support-inbox): AI-augmented ticket inbox
 38 files changed, 2843 insertions(+)
```

**Text overlay:**

> "Spec to shipping: 7m 14s."

**Cut to:** openplanr.dev hero.

**Text overlay (sequenced):**

> "$ npm i -g openplanr"
>
> "openplanr.dev"

End on a static frame for 1.5 seconds.

---

## Optional Act V — cross-runtime (+30s)

If you want the v1.5.1 differentiator on screen, append after the CTA. Total becomes ~4:30.

**Screen:** Cursor IDE on the same `~/demos/support-inbox/` project.

**Action — type in Cursor's Composer:**

```
plan support-inbox
```

(Cursor auto-attaches `.cursor/rules/planr-pipeline.mdc`. 5-7 seconds of agent dispatch.)

**Text overlay (sequenced):**

> "The same spec runs on Cursor."
>
> "And on Codex via AGENTS.md."
>
> "OpenPlanr Protocol v1.0.0."

---

## What the user does on camera

| When | Action | Duration |
|---|---|---|
| 0:18 | Type `/pl`, select `/planr-pipeline:plan`, type `support-inbox`, paste brief, Enter | 17s |
| 2:15 | Open T-004 in VS Code, scroll, edit one line | 30s |
| 2:45 | Type `/planr-pipeline:ship support-inbox`, Enter | 5s |
| 3:55 | Type `git commit ...` | 5s |

**Four interactions across 4 minutes.** Premium, restrained, end-to-end. The pipeline auto-scaffolds without a consent prompt — when the brief declares a Node stack and the directory is greenfield, the intent is unambiguous.

---

## Production notes

| Element | Detail |
|---|---|
| Recording app | Screen Studio (Mac, $89) |
| Resolution | 1920×1080, 60fps |
| Cursor zoom | ON |
| Click animations | ON |
| Music | Lo-fi instrumental, -22 LUFS, no vocals |
| Voice | None — text overlays only |
| Text overlay font | Geist 32px |
| Text overlay color | `#f4f4f5` on `#09090b`, `#16a34a` for accent |
| Speed-up | 12× during scaffolding (0:35-1:30). 7× during PO. 8× during DEV. **Real-time** during prompt typing, autocomplete, T-004 review, ship-it, commit. |

### Pacing rules

1. **The autocomplete dropdown at 0:18 is sacred.** Hold it for 1.5s at full opacity. It does marketing work no overlay can match.
2. **Real-time on user input.** Paste, type, save, commit — these show the human-friendly UX.
3. **Speed up agent output 7-12×.** Viewers feel the pace.
4. **The 30-second slow scroll through T-004 is sacred.** Don't speed it up. That's the soul.
5. **Cut on the action verb** (Enter press, save, ship-it).

---

## Three things this script absolutely must NOT do

1. **No fake speed-up of `git status`, the file tree, the marker, or T-004.** Real-time so viewers can read.
2. **No skipping the human review (Act III).** That's the point.
3. **No voice-over.** Text overlays only.

---

## FAQ — questions launch comments will ask

**Q: Where does the plugin take the project shape from? You didn't show stack.md being typed.**

The brief mentions the stack ("Next.js + Prisma + Postgres + Redis + Anthropic SDK + Vitest"). Claude Code interprets this and writes `input/tech/stack.md` for the agents to read. You can also hand-author stack.md if you prefer — the pipeline self-heals when missing in spec mode.

**Q: How does the plugin scaffold a new Next.js project from inside Claude Code?**

Claude Code's main session has Bash. It runs `npx create-next-app`, `npm install`, `npx prisma init` — same as you would. The demo speeds these up 12×; real time is ~2 minutes.

**Q: Did you really ship 38 files in 7 minutes?**

Real time on real hardware: 6-8 minutes for a feature this size. The demo edit speeds the agent streams 7-12× for watchability. The duration shown in `.pipeline-shipped` is real.

**Q: What if I don't use Next.js?**

Stack-agnostic. The agents read whatever stack you declare in the brief (or in `input/tech/stack.md`). Django + DRF, Rails, NestJS, FastAPI — same flow.

**Q: Do I need an Anthropic API key during the demo?**

No. The pipeline runs on Claude Code's session model. Generated code includes Anthropic SDK calls but tests are msw-mocked.

---

## After the recording

- [ ] Pick the cleanest take of 3
- [ ] Edit in Screen Studio: speed up scaffolding 12×, agent streams 7-8×, add text overlays
- [ ] Optional intro card (1.5s, dark, OpenPlanr logo + "v1.5.1 launch")
- [ ] Export 1920×1080 60fps H.264, ≤ 100 MB
- [ ] Upload to YouTube **Unlisted** (don't go public until Tue 9:00am ET)
- [ ] Title: `OpenPlanr v1.5.1 — One slash command. Spec to PR. (4:00)`
- [ ] Description: see `launch-briefing.md` § 9
- [ ] Tags: `claude code, ai coding, spec driven, agentic, anthropic, prisma, nextjs, planr, openplanr`
- [ ] Generate 90-second cut for X (autocomplete + prompt + QA gate moment + payoff)
- [ ] Drop URLs into `launch-briefing.md` § 3 + § 4 placeholders

---

*Script locked. One slash command. Trust the takes.*
