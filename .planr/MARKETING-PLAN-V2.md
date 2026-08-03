# OpenPlanr Marketing Launch Plan v2 — Simplified

> **Author:** Asem Abdo
> **Status:** Active
> **Aligned with:** planr CLI v1.5.1 · planr-pipeline v0.7.0 · openplanr-skills v1.4.0 · OpenPlanr Protocol v1.0.0 (post-rename, post-cross-runtime)
> **Last refreshed:** 2026-04-30 (after the `openplanr-pipeline` → `planr-pipeline` rename and the cross-runtime pivot)
> **Supersedes:** `.planr/marketing.md` (the v1 14-day campaign — too elaborate for a solo dev)
> **Target window:** Tuesday post (5 working days from the refresh)
> **Effort:** ~10-12 hrs spread across the window
>
> **Headline angle for v1.5.1:** "Same `.planr/specs/` directory runs on Claude Code, Cursor, AND Codex." This is the actual differentiator, not "OpenPlanr is an ecosystem now" (that was the v1.4-era angle, superseded).

---

## Why this plan exists

The v1 plan was a 14-day campaign with parallel content tracks, HN karma grinding, Product Hunt orchestration, and 5 distinct posts. Over-prescribed for a solo dev who's already pulled thin building product.

The 80/20 of what matters is four assets. Everything else is nice-to-have that can land later, when natural news cycles give them context (a new release, a real user question, a comparison post that actually answers something).

**Core principle:** marketing that becomes a second job kills both the product and the marketer. Sustainable monthly cadence beats one elaborate launch every time.

---

## The 4 critical deliverables (and why)

| # | Asset | Why it's non-negotiable |
|---|---|---|
| 1 | **3-min demo video** | The only artifact that *shows* the product working in 3 minutes. Embeds everywhere. Senior devs decide "is this real?" in 30 seconds of seeing a demo. Without one, every post shouts into a void. |
| 2 | **openplanr.dev update** | Right now the landing page sells just planr CLI. The ecosystem story isn't on the homepage. Anyone arriving from the LinkedIn post lands on a page that doesn't reflect what's been built. Mismatched landing = wasted traffic. |
| 3 | **`/docs` skeleton** | The only deliverable that compounds *passively*. Every page ranks in Google for some long-tail query forever. The launch drives a one-day spike; docs drive 12 months of qualified traffic. |
| 4 | **One LinkedIn post + one X thread** | The world needs to know v1.5 + the cross-runtime story exists. Three-plus weeks past v1.0 post — a follow-up at this cadence is natural, not desperate. One strong post per platform > five mediocre ones. |

---

## What we're explicitly NOT doing

- ❌ HN karma grinding (skip — happens organically over months)
- ❌ Product Hunt orchestrated launch day (skip — risk of flop > upside)
- ❌ Multi-week deep-dive content series (defer — better as monthly cadence later)
- ❌ Comparison/positioning post ("OpenPlanr vs X") (defer — write when someone asks)
- ❌ Reddit + Indie Hackers + Dev.to + LinkedIn coordinated blast (skip the orchestration; cross-post casually if natural)
- ❌ ElevenLabs / face-on-camera video (skip — text overlays + screen capture is enough)

These aren't bad ideas. They're just lower-leverage than what's in the core 4, and trying to do everything dilutes the core.

---

## 7-day execution timeline

| Day | Focus | Deliverable | Effort |
|---|---|---|---|
| **1** | Demo prep + recording | 3 raw takes of the demo | 3 hrs |
| **2** | Demo edit + upload (unlisted) | YouTube link locked | 2 hrs |
| **3** | openplanr.dev update — kick off | Spec created via planr spec-driven mode (use Agent Prompt #1) | 2 hrs |
| **4** | openplanr.dev update — ship | Production deploy with new ecosystem section + `/blueprint` page | 4 hrs |
| **5** | `/docs` site — kick off | Spec created via planr spec-driven mode (use Agent Prompt #2) | 2 hrs |
| **6** | `/docs` site — ship | 5 pages live at openplanr.dev/docs, demo embedded | 6 hrs |
| **7** | Publish | LinkedIn post (AM) → X thread (PM) → respond all day | 3 hrs |

**Total focused work:** ~22 hours = ~3 working days, comfortable across a week.

---

# ASSET 1 — Demo Video

## Production notes

**Tool:** [Screen Studio](https://www.screen.studio/) ($89, Mac, recommended) — auto-zoom on cursor, smooth click animations, beautiful by default. Free alternative: [Tella](https://www.tella.tv/) free tier.

**Style:** Screen-only. No face. No voice. No AI narration. Text overlays carry the story.

**Why no narration for v1:** Senior devs watching a CLI demo want the workflow as the protagonist. Voice distracts. Text overlays appear precisely when needed and let viewers control pacing. Save voice/face for v2 in 6 months.

## Pre-recording checklist

- [ ] Terminal: solid dark bg (#0a0a0a), JetBrains Mono 16pt, prompt = `$` only
- [ ] VS Code: dark theme, font 14pt, sidebar collapsed
- [ ] Clear shell history: `clear; history -c`
- [ ] Demo project ready at `~/demos/auth-app/` (real `package.json`, real stack)
- [ ] openplanr.dev open in browser tab (for opening + closing shots)
- [ ] Composition diagram from blueprint open in another tab (for problem-statement frame)
- [ ] Silent music track picked (Epidemic Sound / Artlist — lo-fi or ambient electronic, no vocals)
- [ ] Practice run end-to-end **twice** without recording — get muscle memory

## Full script (3:05)

```
─────────────────────────────────────────────────────────────────
[0:00 – 0:08]  HOOK
─────────────────────────────────────────────────────────────────
SCREEN:        openplanr.dev landing page hero
TEXT OVERLAY:  "Plan once. Ship with agents."
                Fade in below: "An ecosystem for spec-driven AI dev"

─────────────────────────────────────────────────────────────────
[0:08 – 0:18]  THE PROBLEM
─────────────────────────────────────────────────────────────────
SCREEN:        Cut to composition diagram (zoomed)
TEXT OVERLAY:  "Most AI coding tools skip the plan."
                Then: "OpenPlanr makes the plan the contract."

─────────────────────────────────────────────────────────────────
[0:18 – 0:50]  ACT I — AUTHOR THE PLAN (planr CLI)
─────────────────────────────────────────────────────────────────
TYPE:          $ planr spec create "User authentication" --slug auth --priority P0
OUTPUT:        ✓ SPEC-001-auth created
TEXT:          "1. Author the spec"

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
[0:50 – 1:30]  ACT II — REVIEW (the human gate)
─────────────────────────────────────────────────────────────────
SCREEN:        VS Code, opening tasks/T-002-jwt-middleware.md
SHOW:          Frontmatter, scroll task body briefly
TEXT:          "2. Human reviews. Edits anything."
                Then: "The pipeline refuses to ship without this gate."

─────────────────────────────────────────────────────────────────
[1:30 – 2:30]  ACT III — SHIP (the pipeline)
─────────────────────────────────────────────────────────────────
SCREEN:        Claude Code window
TYPE:          /planr-pipeline:ship auth
SHOW:          Streaming subagent output (speed up 3-4x):
               • frontend-agent: 2 tasks
               • backend-agent: 3 tasks (parallel)
               • qa-agent: build + tests pass
               • devops + doc-gen: parallel
               ✓ CLAUDE.md refreshed

TEXT (sequenced):
               "8 subagents · tool-layer enforced"
               "Parallel by topological group"
               "QA gate before docs + Docker"
               "3-iteration correction loop, then error report"

─────────────────────────────────────────────────────────────────
[2:30 – 2:55]  THE PAYOFF
─────────────────────────────────────────────────────────────────
SCREEN:        File tree showing src/, tests/, docker-compose.yml, Docs/feat-auth/
TEXT:          "From one spec to a shipping feature"
                Then: "Code · Tests · Docker · Docs"

CUT:           git status showing staged changes
TEXT:          "Ready for PR"

─────────────────────────────────────────────────────────────────
[2:55 – 3:05]  CTA
─────────────────────────────────────────────────────────────────
SCREEN:        openplanr.dev hero again
TEXT:          "openplanr.dev"
                Then: "$ npm i -g openplanr"
                Then: "MIT · open source · github.com/openplanr"
```

## Editing rules

- **Speed up agent streaming 3-4x.** Nobody watches real-time agent output. Keep texture, kill dead time.
- **One font (DM Sans), one accent color (mint #5eead4), one position** for overlays. Consistency reads as polish.
- **First 2 seconds and final 5 seconds matter most.** Those get screenshotted/shared.
- **Auto-caption on upload.** Many viewers watch muted.
- **Keep under 3:15.** Above that, completion rate drops sharply.

## Distribution

| Platform | Format | Notes |
|---|---|---|
| YouTube | Native upload (canonical URL) | Start unlisted Day 2, flip to public Day 7 |
| openplanr.dev hero | YouTube embed | Above or below the install command — A/B which performs |
| X/Twitter | 2:00 cut (drop the slow parts) | Native upload beats embed for reach |
| LinkedIn | Full 3:05 native upload | LinkedIn rewards completion, not brevity |
| GitHub READMEs | 30-sec GIF clip + YouTube link | The pipeline-ship segment is the strongest GIF |

---

# ASSET 2 — openplanr.dev landing page update

## Goal

Evolve the existing landing page from "planr CLI showcase" to "OpenPlanr ecosystem showcase" without losing the strong existing hero. The new HTML blueprint lives at `/blueprint` as the deep-dive page.

## What stays / what changes

| | Stays | Changes |
|---|---|---|
| Hero headline | ✅ "Your AI agent writes code. Now it reads the plan first." | — |
| Hero CTA buttons | ✅ View on GitHub + npm | — |
| Hero install command | ✅ `npm i -g openplanr` | — |
| Below-the-fold | — | Add ecosystem section (3 component cards + composition diagram + demo video embed) |
| New page | — | `/blueprint` route hosts the new comprehensive HTML artifact |
| Footer | ✅ existing | Add link to `/docs` and `/blueprint` |

## Agent Prompt #1 — Hand to Claude Code in CLI

Open Claude Code in `~/Work/openplanr-web/` and paste this prompt:

```
You're updating the OpenPlanr marketing site at openplanr.dev. Use planr's
spec-driven mode to plan the work, then we'll execute it via the
planr-pipeline plugin.

═══════════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════════

Current site: ~/Work/openplanr-web (Next.js 16, App Router, Tailwind v4,
shadcn/ui, base-ui, Biome). Live at openplanr.dev.

Current homepage: src/app/page.tsx — minimal hero with the headline
"Your AI agent writes code. Now it reads the plan first." plus install
CTA. This hero is strong; do NOT change the hero text or layout.

Reference design (the new ecosystem blueprint we want to evolve toward):
~/Work/openplanr-space/designs/openplanr-ecosystem-blueprint.html
Read this entire file before planning anything. It defines the visual
tokens (mint accent #5eead4, near-black canvas, DM Sans + JetBrains Mono),
the component cards, the composition diagram SVG, and the section rhythm.

═══════════════════════════════════════════════════════════════════
GOAL
═══════════════════════════════════════════════════════════════════

Evolve the homepage to reflect the full ecosystem (planr CLI +
planr-pipeline + skills) without losing the strong existing hero.
Add a new /blueprint route that hosts the comprehensive blueprint page.

═══════════════════════════════════════════════════════════════════
SCOPE — what to add to the homepage (below the existing hero)
═══════════════════════════════════════════════════════════════════

In this order, scrolling down from the hero:

1. **Demo video embed** — full-bleed YouTube embed (16:9, max-width
   ~880px, rounded corners, subtle mint glow border). Title above:
   "See it ship in 3 minutes." YouTube ID will be set after Day 2.
   Use a placeholder ID: dQw4w9WgXcQ — flag for replacement.

2. **Three components section** — 3-card grid lifted from the blueprint.
   Cards: planr CLI (magenta accent #c084fc), planr-pipeline (cyan
   #22d3ee), openplanr/skills (green #4ade80). Each card has: role tag,
   icon, name, version chip, 2-line description, mono chips, "runs as"
   footer. Match the blueprint exactly — same data, same chip layout.

3. **Composition diagram** — lift the SVG from the blueprint
   (lines ~1380-1530 of the reference file). The amber "install pipe"
   showing the marketplace stays. Animated dashed flow lines stay.
   Honor prefers-reduced-motion.

4. **Three planning postures** — 3-card row from the blueprint
   (Agile / Quick Task / Spec-driven). Each with a terminal block
   showing the canonical command sequence.

5. **CTA strip** — single horizontal band: "Read the full blueprint →"
   linking to /blueprint. Secondary link: "Read the docs →" linking
   to /docs (will 404 until Asset 3 lands; that's fine).

═══════════════════════════════════════════════════════════════════
SCOPE — new /blueprint route
═══════════════════════════════════════════════════════════════════

Create src/app/blueprint/page.tsx that hosts the full ecosystem
blueprint. Two acceptable approaches — pick whichever is faster:

Option A (faster): Convert the static HTML from
~/Work/openplanr-space/designs/openplanr-ecosystem-blueprint.html
into a single React component. Keep ALL inline CSS (move into a
<style jsx> block or import as a CSS module). Don't try to refactor
into shadcn — preserve the design verbatim.

Option B (cleaner long-term): Decompose into proper Next.js components,
reuse Tailwind classes where they map cleanly, keep custom SVG and
animations as-is.

Constraint: the visual output must match the reference HTML pixel-for-pixel
on desktop. Don't redesign anything.

═══════════════════════════════════════════════════════════════════
DESIGN CONSTRAINTS
═══════════════════════════════════════════════════════════════════

- Match the visual tokens of the existing site AND the blueprint:
  - Background: near-black (#08090b ish)
  - Mint accent: #5eead4 (var --mint or equivalent)
  - Typography: DM Sans (UI) + JetBrains Mono (code)
- Honor prefers-reduced-motion on all animations
- Responsive: clean down to ~1024px; below that, cards stack 1-up,
  composition diagram becomes vertical
- Accessibility: AA contrast, semantic landmarks, alt text on icons
- No new heavy dependencies. shadcn + base-ui + Tailwind is enough.

═══════════════════════════════════════════════════════════════════
WORKFLOW — use planr spec-driven mode
═══════════════════════════════════════════════════════════════════

Step 1: Run `planr spec init` if not already initialized
Step 2: Run `planr spec create "openplanr.dev ecosystem update" \
        --slug landing-v2 --priority P0`
Step 3: Run `planr spec shape SPEC-NNN-landing-v2` and answer the
        4 questions:
        Q1 (context): The openplanr.dev landing page currently sells
        only planr CLI; we need the ecosystem story (planr +
        pipeline + skills) without losing the strong existing hero.
        Primary user: senior devs evaluating OpenPlanr.
        Q2 (functional reqs): Add ecosystem section below hero,
        embed demo video, ship a /blueprint deep-dive page, link
        to /docs from footer.
        Q3 (rules): Do not change hero text/layout. Match blueprint
        visual tokens. Honor prefers-reduced-motion. AA contrast.
        Q4 (acceptance): /blueprint loads and matches reference HTML
        on desktop. Homepage scrolls smoothly through ecosystem
        section. Lighthouse perf ≥85 on desktop.
Step 4: Run `planr spec decompose SPEC-NNN-landing-v2`
Step 5: Review the generated stories + tasks under
        .planr/specs/SPEC-NNN-landing-v2/. Edit any task that has
        wrong file paths or scope.
Step 6: Run `/planr-pipeline:plan landing-v2` (in Claude Code)
Step 7: After human review, run `/planr-pipeline:ship landing-v2`

═══════════════════════════════════════════════════════════════════
VERIFICATION (do these before declaring done)
═══════════════════════════════════════════════════════════════════

- `npm run build` succeeds with zero TypeScript errors
- `npm run dev` shows the new ecosystem section below the hero
- /blueprint route renders the full ecosystem page
- Lighthouse Desktop perf ≥85, accessibility ≥95
- Visual diff vs the reference HTML on desktop: <5% pixel difference
- Resize to 1024px / 768px / 375px — no horizontal scroll, no overflow
- Demo video embed shows the placeholder; flag for YouTube ID swap

═══════════════════════════════════════════════════════════════════
DELIVERABLE
═══════════════════════════════════════════════════════════════════

A PR on the openplanr-web repo with:
- Updated src/app/page.tsx
- New src/app/blueprint/page.tsx
- Any extracted components in src/components/landing/
- Screenshots in the PR description (homepage + /blueprint, desktop + mobile)

Do NOT push the PR yet. Surface the diff for review first.
```

---

# ASSET 3 — openplanr.dev/docs

## Goal

Stand up a docs site at `openplanr.dev/docs` with 5 essential pages, populated from existing READMEs + the blueprint. Don't perfect — ship.

## Tech choice

**Recommended: Nextra integrated into the existing openplanr-web Next.js app.** Same domain, single deploy, one codebase. Alternative: separate Mintlify site at `docs.openplanr.dev` — beautiful but adds a vendor dependency and a second deployment surface.

## Page structure (5 pages, in priority order)

| # | Path | Purpose |
|---|---|---|
| 1 | `/docs` | Overview — what each component is + install + 5-min quickstart with demo video embedded |
| 2 | `/docs/getting-started` | First spec, first ship — end-to-end walkthrough |
| 3 | `/docs/spec-driven-mode` | The bridge — most important page, highest SEO value |
| 4 | `/docs/planr-cli` | CLI reference (lift from `docs/CLI.md` in the planr repo) |
| 5 | `/docs/pipeline` | Pipeline plugin overview — 8 subagents, /plan + /ship commands, tool-layer rules |

Defer for later: `/docs/recipes/`, `/docs/skills/`, `/docs/faq/`, `/docs/reference/spec-schema/`. Ship the 5 first; add the rest as questions come in.

## Agent Prompt #2 — Hand to Claude Code in CLI

Open Claude Code in `~/Work/openplanr-web/` and paste this prompt:

```
You're standing up the documentation site for OpenPlanr at
openplanr.dev/docs. Use planr's spec-driven mode to plan the work,
then we'll execute it via the planr-pipeline plugin.

═══════════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════════

Site: ~/Work/openplanr-web (Next.js 16 App Router, Tailwind v4,
shadcn, base-ui, Biome).

OpenPlanr ecosystem (read these to understand what you're documenting):
- planr CLI:           ~/Work/OpenPlanr/README.md
                       ~/Work/OpenPlanr/docs/CLI.md
                       ~/Work/OpenPlanr/docs/proposals/spec-driven-mode.md
- pipeline plugin:     ~/Work/planr-pipeline/README.md
                       ~/Work/planr-pipeline/docs/rules.md
                       ~/Work/planr-pipeline/docs/pipeline-overview.md
                       ~/Work/planr-pipeline/agents/*.md (8 subagents)
- skills:              ~/Work/openplanr-skills/skills/openplanr/SKILL.md
- ecosystem blueprint: ~/Work/openplanr-space/designs/openplanr-ecosystem-blueprint.html

═══════════════════════════════════════════════════════════════════
GOAL
═══════════════════════════════════════════════════════════════════

Stand up a docs site at openplanr.dev/docs with 5 essential pages.
Use Nextra integrated into the existing Next.js app (same domain,
same deploy). Page content is extracted/adapted from existing
markdown sources listed above.

═══════════════════════════════════════════════════════════════════
SCOPE — pages to create
═══════════════════════════════════════════════════════════════════

1. /docs (index)
   - 1-paragraph overview of what OpenPlanr is
   - 3-card row: planr CLI | pipeline | skills (lift design from
     blueprint, simpler version)
   - Install commands (npm + Claude Code marketplace)
   - 5-minute quickstart link → /docs/getting-started
   - Demo video embed (use same placeholder YouTube ID from Asset 2;
     flag for replacement)

2. /docs/getting-started
   - "Your first spec, your first ship" walkthrough
   - The 6 commands from the blueprint's walkthrough section
   - Each step: command + expected output + what artifact gets
     created
   - Link forward to /docs/spec-driven-mode for the deep dive

3. /docs/spec-driven-mode (highest priority — most SEO leverage)
   - What it is: 1-2 paragraphs from
     ~/Work/OpenPlanr/docs/proposals/spec-driven-mode.md
   - The directory layout: .planr/specs/SPEC-NNN-{slug}/
   - The 4-question shape flow
   - How decompose works (codebase scanning, AI generation,
     stories+tasks)
   - The bridge to the pipeline (mode detection,
     /planr-pipeline:plan in spec mode)
   - When to use spec mode vs agile mode vs quick mode

4. /docs/planr-cli
   - Lift content from ~/Work/OpenPlanr/docs/CLI.md
   - Organize by command group: init, epic/feature/story/task,
     spec, quick, sprint, sync
   - Each command: signature, flags, example, what it produces

5. /docs/pipeline
   - Overview from ~/Work/planr-pipeline/README.md
   - The two phases: PO Phase (/plan) → human review → DEV Phase
     (/ship)
   - The 8 subagents — name, model (Sonnet 4.6 vs Opus 4.7), tool
     restrictions (1-line each)
   - The 3-iteration correction loop
   - Tool-layer rules: link out to ~/Work/planr-pipeline/docs/rules.md

═══════════════════════════════════════════════════════════════════
TECH STACK
═══════════════════════════════════════════════════════════════════

Use Nextra v3 (App Router compatible) integrated as a sub-route:
  npm install nextra nextra-theme-docs

If Nextra App Router integration is fragile, alternative:
- Build the docs as plain Next.js routes under src/app/docs/
- Use shadcn + base-ui for navigation/sidebar/search components
- Use react-markdown or @mdx-js/react for content
- Implement a simple search via cmdk or similar

Either path is acceptable. Pick whichever lands a working /docs in
under 1 day.

═══════════════════════════════════════════════════════════════════
DESIGN CONSTRAINTS
═══════════════════════════════════════════════════════════════════

- Visual continuity with the rest of openplanr.dev:
  - Same dark canvas, mint accent, typography (DM Sans + JetBrains Mono)
  - Same nav header as the rest of the site
- Sidebar with the 5 pages, collapsible
- Per-page table of contents on the right (auto-generated from H2/H3)
- Code blocks with syntax highlighting + copy button
- Search bar (Cmd+K) — even a basic local search is enough
- Footer links: GitHub, npm, X
- AA contrast everywhere

═══════════════════════════════════════════════════════════════════
WORKFLOW — use planr spec-driven mode
═══════════════════════════════════════════════════════════════════

Step 1: Run `planr spec create "OpenPlanr docs site v1" \
        --slug docs-v1 --priority P0`
Step 2: Run `planr spec shape SPEC-NNN-docs-v1` and answer:
        Q1 (context): openplanr.dev currently has no docs site;
        users land on GitHub READMEs which is barrier to evaluation
        + costs SEO. Primary user: senior devs evaluating OpenPlanr
        in their first 5 minutes.
        Q2 (functional reqs): 5 pages live at /docs, /docs/getting-
        started, /docs/spec-driven-mode, /docs/planr-cli,
        /docs/pipeline. Sidebar nav, ToC, code highlighting, basic
        search. Demo video embedded on index page.
        Q3 (rules): Same domain (openplanr.dev/docs, not
        docs.openplanr.dev). Same Next.js app. No new vendor
        dependencies (no Mintlify). Visual continuity with
        existing site.
        Q4 (acceptance): All 5 pages render with content extracted
        from the source markdown files. Sidebar nav works. Search
        works for at least exact-match queries. Lighthouse perf ≥85.
        Mobile-friendly.
Step 3: Run `planr spec decompose SPEC-NNN-docs-v1`
Step 4: Review tasks at .planr/specs/SPEC-NNN-docs-v1/. Confirm
        every task names real file paths.
Step 5: `/planr-pipeline:plan docs-v1`
Step 6: Human review.
Step 7: `/planr-pipeline:ship docs-v1`

═══════════════════════════════════════════════════════════════════
VERIFICATION
═══════════════════════════════════════════════════════════════════

- `npm run build` succeeds
- All 5 pages load at their respective routes
- Sidebar nav highlights current page
- ToC updates on scroll
- Code blocks render with mint-accented prompt and dim comments
- Search returns results for "spec", "decompose", "subagent"
- Lighthouse Desktop perf ≥85, accessibility ≥95
- Mobile (375px): sidebar collapses to hamburger, no overflow

═══════════════════════════════════════════════════════════════════
DELIVERABLE
═══════════════════════════════════════════════════════════════════

A PR on openplanr-web with:
- 5 docs pages (MDX or TSX as appropriate)
- Nextra config OR custom docs layout under src/app/docs/
- Updated nav to include "Docs" link
- Screenshots in PR description: index, one detail page,
  mobile view

Surface the diff for review before pushing.
```

---

# ASSET 4 — LinkedIn post + X thread

## LinkedIn post — Day 7 morning

**Length target:** ~1900 chars. **Posting time:** Tue 9:30am ET. **Drop GitHub URL in first comment, NOT post body** (LinkedIn suppresses external links in posts).

**Headline angle:** lead with cross-runtime parity — the actual v1.5.1 differentiator that no one else in this space has shipped.

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

Built solo. If you're shipping with Claude Code, Cursor, or Codex —
try it and tell me what breaks.

#AI #DeveloperTools #OpenSource #ClaudeCode #IndieHacker
```

**First comment (drop GitHub link here):**
```
GitHub: github.com/openplanr/OpenPlanr (planr CLI)
Plugin: github.com/openplanr/planr-pipeline
Compatibility matrix: github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md
Protocol spec: github.com/openplanr/planr-pipeline/tree/main/docs/protocol
```

**Posting tips:**
- Reply to every comment within 30 min for the first 4 hours
- Don't repost the same content to LinkedIn within 30 days
- React to your own post once (not three times — looks desperate)

## X micro-thread — Day 7 afternoon

**Length:** 3 tweets (lighter shape than the original 8-tweet plan; easier to ship). **Posting time:** Tue 1:30pm ET. **Pin to profile.**

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

# Success criteria (set expectations honestly)

This is a **drumbeat post**, not a viral launch. Realistic numbers for a solo dev with a small audience following a v1.0 announcement two weeks ago:

| Metric | Floor (concerning if below) | Target (decent outcome) | Stretch (great) |
|---|---|---|---|
| LinkedIn post impressions | 1,500 | 4,000 | 12,000+ |
| LinkedIn reactions | 30 | 80 | 200+ |
| X thread impressions | 3,000 | 10,000 | 50,000+ |
| X thread engagements | 50 | 150 | 500+ |
| GitHub stars in 7 days | +15 | +50 | +200 |
| YouTube demo views in 7 days | 100 | 400 | 1,500 |
| Site traffic spike on Day 7 | 200 visits | 800 visits | 3,000+ |
| New npm installs in 7 days | +50 | +200 | +800 |

**Don't measure success by virality.** Measure by:
- Did the demo + posts land without quality issues? (Yes/No)
- Did anyone qualified install + engage? (look for thoughtful issues, not star-spam)
- Are docs ranking on Google Search Console for any term within 30 days?

---

# Post-launch monthly cadence

After Day 7, the campaign is over. Switch to **monthly drumbeat — one piece per month, forever.**

| Month | Suggested topic | Format |
|---|---|---|
| +1mo | Schema-sharing deep dive (the v1 plan's Day 5 post) | Dev.to long-form, 1000 words |
| +2mo | "8 subagents, what each does, why" | X thread + LinkedIn carousel |
| +3mo | Comparison post: "OpenPlanr vs Cursor agents vs Claude Projects" | Dev.to, 1500 words |
| +4mo | New release post (whatever ships next) | LinkedIn + X coordinated |
| +5mo | Recipe post: "From Figma export to merged PR" | Demo video + walkthrough |
| +6mo | Launch a community Discord | Announce via existing channels |

One post per month. 30 minutes to draft + 30 minutes to publish + 60 minutes to respond. Sustainable forever.

---

# Tracking the campaign

Track each deliverable as planr quick tasks. Run from `~/Work/OpenPlanr/`:

```bash
$ planr quick create "Day 1: Record demo video v1"
$ planr quick create "Day 2: Edit demo + upload to YouTube unlisted"
$ planr quick create "Day 3: Spec the openplanr.dev landing update"
$ planr quick create "Day 4: Ship openplanr.dev landing update"
$ planr quick create "Day 5: Spec the /docs site"
$ planr quick create "Day 6: Ship /docs with 5 pages"
$ planr quick create "Day 7: Publish LinkedIn + X + flip demo public"
```

Then mention this in the launch posts: *"I'm using planr to plan planr's launch."*
Real product proof beats any ad copy.

---

*Plan locked. Execution starts Day 1. Don't over-think — ship.*
