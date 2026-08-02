# OpenPlanr v1.5.1 Launch Briefing — Demo + LinkedIn Post

> **Status:** v0.7.0-aligned. Updated 2026-04-30 after the `openplanr-pipeline` → `planr-pipeline` rename and the cross-runtime pivot.
> **Use:** self-contained briefing you can paste into a fresh Claude Code session, hand to a contractor, or keep open as your own execution reference.
> **Mission:** Ship a 3-minute demo video + LinkedIn post + X micro-thread that announce OpenPlanr v1.5.1 cross-runtime support, by next Tuesday.
> **Not in scope:** Landing page update, docs site, comparison posts, HN, Product Hunt. Those land later.
> **Operator:** Asem Abdo (asemhamdi97@gmail.com)
> **Timeline:** Thu record → Fri edit → Tue publish

---

## 1. Product context (read this first — every word matters)

**OpenPlanr** is a 4-piece ecosystem for spec-driven AI development. The headline that just shipped (planr CLI v1.5.1, planr-pipeline plugin v0.7.0, openplanr-skills v1.4.0) is **runtime-agnostic execution**: the same `.planr/specs/SPEC-NNN-{slug}/` directory now runs on **Claude Code, Cursor, AND Codex** — same artifacts, same workflow, same `.pipeline-shipped` proof markers.

The four components:

| Component | Role | Latest |
|---|---|---|
| **`openplanr` CLI** | Authoring surface — generates `.planr/` artifacts and runtime-native rule files (`.cursor/rules/*.mdc`, `CLAUDE.md`, `AGENTS.md`) | npm v1.5.1 |
| **`planr-pipeline`** | Claude Code plugin — canonical executor (8 subagents, manifest-enforced tool restrictions). Renamed from `openplanr-pipeline` in v0.7.0 for brand convergence on the `planr` CLI binary. | GitHub v0.7.0 |
| **`openplanr` skill** | Routing playbook — teaches Claude when to use which surface | GitHub v1.4.0 |
| **`marketplace`** | Distribution — Claude Code plugin registry | pin v0.7.0 |

The interesting design decision (this is the differentiator that goes in every post): **the contract IS the artifact**. Most spec tools are "authoring tool → conversion adapter → executor." OpenPlanr collapses the adapter — `planr spec` writes the exact directory the pipeline reads, byte for byte. No glue scripts. And now via `planr rules generate --scope pipeline`, that same contract runs on Cursor (`.cursor/rules/planr-pipeline.mdc` + 8 vendored agent body files) and Codex (`AGENTS.md` with a pipeline orchestration section).

**The OpenPlanr Protocol v1.0.0** (lives at `planr-pipeline/docs/protocol/`) formalizes this — the protocol is the contract; runtimes are adapters. Compatibility matrix at `planr-pipeline/docs/compatibility-matrix.md` lays out per-capability parity across the three runtimes with honest caveats.

**One-command onboarding (the headline):**

```bash
npm i -g openplanr && cd my-project && planr init
# Generates rules for all three runtimes by default.
# Open Cursor, Codex, or Claude Code — pipeline workflow is live.
```

---

## 2. Demo video — script (3:15)

**Tool:** Screen Studio ($89, Mac). **Style:** Screen-only, no face, no voice. Text overlays only. **Music:** Lo-fi, instrumental.

```
─────────────────────────────────────────────────────────────────
[0:00 – 0:08]  HOOK
─────────────────────────────────────────────────────────────────
SCREEN:        openplanr.dev landing page hero (or, if landing not updated,
               GitHub README header — the new centered hero)
TEXT OVERLAY:  "Plan once. Ship with agents."
                Below: "One spec. Three runtimes."

─────────────────────────────────────────────────────────────────
[0:08 – 0:18]  THE PROBLEM
─────────────────────────────────────────────────────────────────
SCREEN:        Composition diagram from the README (or quick whiteboard cut)
TEXT OVERLAY:  "Most AI coding tools skip the plan."
                Then: "OpenPlanr makes the plan the contract."

─────────────────────────────────────────────────────────────────
[0:18 – 0:55]  ACT I — AUTHOR THE SPEC (planr CLI)
─────────────────────────────────────────────────────────────────
TYPE:          $ planr spec create "User authentication" --slug auth
OUTPUT:        ✓ SPEC-001-auth created
TEXT:          "1. Author"

TYPE:          $ planr spec shape SPEC-001
SHOW:          4 questions answered fast (skip through)
TEXT:          "Four questions, no vim"

TYPE:          $ planr spec decompose SPEC-001
OUTPUT:        ✓ Scanning codebase…
               ✓ 3 stories · 5 tasks
               ✓ Written to .planr/specs/SPEC-001-auth/
TEXT:          "AI decomposes into stories + tasks"

CUT:           File tree of .planr/specs/SPEC-001-auth/
TEXT:          "Shared schema. No glue scripts."

─────────────────────────────────────────────────────────────────
[0:55 – 1:25]  ACT II — REVIEW (the human gate)
─────────────────────────────────────────────────────────────────
SCREEN:        VS Code — open .planr/specs/SPEC-001-auth/tasks/T-002-jwt.md
SHOW:          Frontmatter, scroll task body briefly
TEXT:          "2. Human reviews. Edits anything."
                Then: "The pipeline refuses to ship without this gate."

─────────────────────────────────────────────────────────────────
[1:25 – 2:15]  ACT III — SHIP IN CLAUDE CODE
─────────────────────────────────────────────────────────────────
SCREEN:        Claude Code window
TYPE:          /planr-pipeline:ship auth
SHOW:          Streaming subagent output (speed up 4x):
               • frontend-agent: 2 tasks
               • backend-agent: 3 tasks (parallel)
               • qa-agent: build + tests pass
               • devops + doc-gen: parallel
               ✓ .pipeline-shipped marker written

TEXT (sequenced):
               "8 subagents · tool-layer enforced"
               "Parallel by topological group"
               "QA gate before docs + Docker"

─────────────────────────────────────────────────────────────────
[2:15 – 2:50]  ACT IV — SAME SPEC, DIFFERENT RUNTIME (the v1.5.1 story)
─────────────────────────────────────────────────────────────────
SCREEN:        Same project, now in Cursor window
TEXT OVERLAY:  "Now switch runtimes — same project."

TYPE in Cursor: ship auth
SHOW:          Cursor Composer auto-attaches planr-pipeline.mdc
               Subagents dispatch (1-2 of them, sped up)

TEXT:          ".cursor/rules/planr-pipeline.mdc"
                Then: "Same .planr/specs/ directory"
                Then: "Codex too — AGENTS.md auto-loads"

CUT:           Quick flash of AGENTS.md (Codex) showing the pipeline section

─────────────────────────────────────────────────────────────────
[2:50 – 3:05]  THE PAYOFF
─────────────────────────────────────────────────────────────────
SCREEN:        File tree showing src/, tests/, docker-compose.yml, Docs/feat-auth/
TEXT:          "From one spec to a shipping feature"
                Then: "Code · Tests · Docker · Docs"

CUT:           git status showing staged changes
TEXT:          "Ready for PR"

─────────────────────────────────────────────────────────────────
[3:05 – 3:15]  CTA
─────────────────────────────────────────────────────────────────
SCREEN:        openplanr.dev hero (or GitHub README header)
TEXT:          "$ npm i -g openplanr"
                Then: "openplanr.dev"
                Then: "MIT · github.com/openplanr"
```

**Why Act IV matters:** 35 seconds showing the **same project** running in Cursor with no extra setup, then a 2-second AGENTS.md flash for Codex. This is the v1.5.1 differentiator that no other tool in this space has shipped.

---

## 3. LinkedIn post copy (cross-runtime headline)

**Length:** ~1900 chars. **Posting time:** Tue 9:30am ET. **Drop GitHub URL in first comment, NOT post body.**

```
About a month ago I shipped planr v1.0 — a CLI to give AI coding
agents a real plan to read.

Today, OpenPlanr is a runtime-agnostic protocol.

The same .planr/specs/SPEC-NNN/ directory now runs on Claude Code,
Cursor, AND Codex. Same artifacts. Same workflow. Same proof markers.
One command to install. One command to initialize. The runtime
activates the workflow without further setup.

The interesting design decision:

Most spec-driven tools are built as "authoring tool → conversion
adapter → executor." OpenPlanr collapses the adapter. planr spec
writes the exact directory the pipeline reads, byte for byte. No
glue scripts. The contract IS the artifact.

Now extend that to three runtimes:
• Claude Code: planr-pipeline plugin (canonical, manifest-enforced)
• Cursor: planr-generated .cursor/rules/planr-pipeline.mdc + 8 agent bodies
• Codex: planr-generated AGENTS.md with pipeline orchestration

The same protocol. Three first-class adapters. A SPEC authored on
one runtime is consumable by any other.

Tool-layer enforcement still matters. The planr-pipeline plugin's
8 subagents have tool restrictions in the Claude Code manifest, not
just the prompt. db-agent gets Bash(psql:*), no git. designer-agent
has Read/Write only, no shell. Restrictions you can audit. Cursor
and Codex get prompt-level guardrails — the compatibility matrix
documents this honestly.

What ships in v1.5.1:
- planr CLI v1.5.1 — `--scope pipeline` flag on rules generate, init
  auto-generates rules for all 3 runtimes by default
- planr-pipeline v0.7.0 — OpenPlanr Protocol v1.0.0 spec at /docs/protocol,
  full compatibility matrix, conformance harness
- openplanr-skills v1.4.0 — two-axis routing (runtime × pipeline-installed)

🎥 3-minute demo: [YouTube link]
🌐 Site: openplanr.dev
⭐ 4 repos, all MIT, github.com/openplanr

Built solo. If you're shipping with Claude Code, Cursor, or Codex
— try it and tell me what breaks.

#AI #DeveloperTools #OpenSource #ClaudeCode #IndieHacker
```

**First comment:**
```
GitHub: github.com/openplanr/OpenPlanr (planr CLI)
Plugin: github.com/openplanr/planr-pipeline
Compatibility matrix: github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md
Protocol spec: github.com/openplanr/planr-pipeline/tree/main/docs/protocol
```

---

## 4. X micro-thread (3 tweets — light, focused)

**Posting time:** Tue 1:30pm ET (after the LinkedIn morning cycle settles). **Pin to profile.**

```
1/3
About a month ago: I shipped planr v1.0, a CLI to give AI agents
a real plan to read.

Today: same .planr/specs/ directory runs on Claude Code, Cursor,
AND Codex. One spec. Three runtimes.

OpenPlanr Protocol v1.0.0 — out today.
[demo video — 90-second cut]

2/3
The contract IS the artifact.

planr spec writes .planr/specs/SPEC-NNN/
the pipeline reads .planr/specs/SPEC-NNN/
Cursor reads it via .cursor/rules/planr-pipeline.mdc
Codex reads it via AGENTS.md

No conversion adapters. Same schema, byte for byte.
[1-image diagram: composition with 3 runtime adapters → 1 spec dir]

3/3
4 repos, MIT, all under github.com/openplanr
• OpenPlanr (planr CLI v1.5.1)
• planr-pipeline (plugin v0.7.0)
• skills (v1.4.0)
• marketplace

$ npm i -g openplanr
openplanr.dev
```

---

## 5. Pre-recording checklist (do these before hitting record)

- [ ] Mac: close Slack, Discord, email, anything that surfaces notifications
- [ ] Terminal: solid dark bg (#0a0a0a), JetBrains Mono 16pt, prompt = `$` only
- [ ] Clear shell history: `clear; history -c`
- [ ] VS Code: dark theme, font 14pt, sidebar collapsed
- [ ] Claude Code: open in fullscreen, single window
- [ ] Cursor: open in fullscreen, separate Space
- [ ] Demo project ready at `~/demos/auth-app/`:
  - Real `package.json` with TypeScript + Vitest deps installed
  - `git init` done; clean working tree
  - `planr init --yes` already run (rules generated)
  - **One spec already half-shaped** (Q1+Q2 answered) so you can speed through Q3+Q4 on camera without dead air
- [ ] openplanr.dev open in a browser tab (for opening + closing shots)
- [ ] Composition diagram from README open in another tab
- [ ] Music track picked (Epidemic Sound / Artlist — lo-fi instrumental, no vocals)
- [ ] Practice run end-to-end **twice** without recording — get muscle memory
- [ ] Screen Studio: 1920x1080, 60fps, cursor zoom on, click animations on

---

## 6. Posting protocol (Tuesday)

**9:00am ET — flip the YouTube demo from unlisted → public.**

**9:30am ET — LinkedIn:**
1. Paste post body. Drop GitHub link in first comment.
2. React to your own post once (not three times — looks desperate).
3. DM the post to 5 close friends/dev contacts asking for honest feedback (not asks for likes).

**1:30pm ET — X:**
1. Post tweet 1 with attached 90-sec demo cut (native upload, not YouTube embed).
2. Post 2 + 3 in the same thread, 30 seconds apart.
3. Pin tweet 1 to profile.

**Throughout the day:**
- Reply to every LinkedIn comment within 30 min for the first 4 hours.
- Reply to every X reply within 30 min for the first 4 hours.
- If anyone asks "vs Cursor agents / Cline / Aider" — answer briefly + point to the compatibility matrix. Don't take the bait into long arguments.

---

## 7. Response playbook (for comments)

| Comment shape | Response template |
|---|---|
| "Looks great, will try" | "Thanks! If you hit anything weird, drop an issue at github.com/openplanr — fast turnaround." |
| "How does this compare to {Cursor agents / Cline / Aider}?" | "Different angle — those are coding tools. OpenPlanr is the *plan layer* that those tools (and Claude Code) consume. The compatibility matrix lays it out: [link]. Happy to dig into a specific comparison if you want." |
| "Why not just use {Linear / Jira / Notion}?" | "Those are great for tracking. OpenPlanr writes the plan as markdown *in the repo*, so the AI agent reads it directly — no API hop. Linear integration ships in the CLI for orgs that want both." |
| "Demo looks fast — is the pipeline really doing all that?" | "Yeah, the demo speeds up the agent streaming 4x for watchability. Real-time, the pipeline takes 3-8 minutes for a small feature. The .pipeline-shipped marker logs everything." |
| "Why was it renamed from openplanr-pipeline?" | "Brand convergence. The CLI is `planr`; the slash commands are now `/planr-pipeline:plan` and `/planr-pipeline:ship`. Old install resolves via a v0.6.1 deprecation stub. v0.7.0 is byte-for-byte the same plugin under the new name." |
| Spam / star-farming | Ignore. Don't engage. |
| Genuine bug report | "Issue please? github.com/openplanr/OpenPlanr/issues — I'll look today." |
| Hostile take | One polite response. If they push, drop it. Don't feed it. |

---

## 8. Success criteria — set expectations honestly

This is a **drumbeat post**, not a viral launch.

| Metric | Floor (concerning) | Target (decent) | Stretch (great) |
|---|---|---|---|
| LinkedIn impressions | 1,500 | 4,500 | 12,000+ |
| LinkedIn reactions | 30 | 90 | 250+ |
| X thread impressions | 3,000 | 12,000 | 50,000+ |
| GitHub stars in 7 days | +15 | +60 | +250 |
| YouTube demo views (7d) | 100 | 500 | 2,000 |
| New npm installs (7d) | +50 | +250 | +1,000 |

**Don't measure success by virality.** Measure by:
- Did the demo land without quality issues? Does the v1.5.1 cross-runtime story read clearly? (Yes/No)
- Did anyone qualified install + engage? (look for thoughtful issues, not star-spam)
- Are docs ranking on Google Search Console for any term within 30 days?

---

## 9. After Tuesday — what to do next

| Window | Action |
|---|---|
| Week +1 | Triage every issue/PR within 24h |
| Week +2 | Write a "What I learned shipping v1.5.1" follow-up post on Dev.to (long-form) |
| Week +4 | Ship the openplanr.dev landing page update (Asset 2 from MARKETING-PLAN-V2) |
| Week +6 | Ship /docs site (Asset 3 from MARKETING-PLAN-V2) |
| Monthly | One drumbeat post (LinkedIn or X), forever |

The launch is not a moment — it's the start of a cadence.

---

*Plan locked. Don't over-think. Record Thursday, edit Friday, ship Tuesday.*
