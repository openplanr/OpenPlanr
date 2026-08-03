# LinkedIn Launch — May 12, 2026

> **Strategy:** Capability tour of the OpenPlanr ecosystem (CLI + pipeline plugin + skill + marketplace).
> Walks the reader through the full flow — Capture → Decompose → Estimate → Ship → Sync —
> rather than framing problems first.
> **Audience:** AI-fatigued senior developers who want to see what a real agentic
> planning layer looks like, end-to-end.
> **Tone:** Confident, capability-forward. Match the voice of the April post —
> short declarative sentences, → arrows for feature lists, italicized belief at the end,
> sparing emojis, hashtags at the bottom.

---

## 1 · The post body (paste into LinkedIn as-is)

> **Length:** 2,606 characters (LinkedIn cap is 3,000 — 394 chars of buffer).
> **No markdown bold/italic asterisks** — LinkedIn renders them literally.
> **No em-dashes between words** — replaced with commas/colons/periods.
> **Each section names its planr command.**

A month ago I posted about OpenPlanr, a CLI that turns a brief into a plan your AI agent can follow.

Since then it grew into a full agentic factory. One CLI, one plugin, one skill, one marketplace, running the same workflow on Claude Code, Cursor, and Codex.

Here's what it does end-to-end:

→ Capture. `planr backlog add "..."` drops rough ideas into the backlog. When you're ready, `planr spec create + shape` walks a 4-question authoring flow and writes a real spec. ADR-aware: your binding decisions inject into context automatically.

→ Decompose. `/planr-pipeline:plan {slug}` runs the specification-agent and emits User Stories + Tasks. Every task carries a rationale field, 1 to 3 sentences on why it exists and which files it touches. The QA agent reads it back to catch drift.

→ Assign. Eight specialized subagents wait on the contract. Sonnet 4.6 for analysis (db, designer, specification, qa, devops, doc-gen). Opus 4.7 for code (frontend, backend). Manifest-enforced tool restrictions: the frontend agent literally cannot write backend files. The rule lives in the manifest, not the prompt.

→ Estimate. `/planr-pipeline:ship {slug}` prints a COST ESTIMATE before any code: per-task table (Create / Modify / Agent), token range, dollar cost, time. Explicit "proceed" gate. `--yes` bypasses for CI. No surprise $40 runs.

→ Ship. On Claude Code, each task dispatches to its own isolated subagent (multi-task mode). No cumulative-context bias. R6 retries up to three times. Project memory (`.planr/memory.md`) auto-injects decisions, traps, and corrections into every dispatch. Re-run `/ship` and the pipeline resumes from each task's status across invocations, machines, even runtimes.

→ Sync. `planr sync` runs bidirectional Linear sync with three-way merge. GitHub Issues too. Your plan stays in markdown in your repo, in sync with whatever your team uses.

One contract, three runtimes. The same `.planr/specs/` artifacts run on Claude Code, Cursor, and Codex. Author once, ship with whichever agent fits the work.

I built OpenPlanr because I want AI agents to feel less like prompt slot machines and more like a real team. A planner who decomposes. An estimator who shows the bill. A frontend dev who stays in lane. A QA who catches drift. That's what this is.

```
npm install -g openplanr
/plugin marketplace add openplanr/marketplace
```

MIT licensed. Open source. Built in the open.

Carousel walks the full flow: capture → decompose → assign → estimate → ship → sync. 👇

#OpenSource #DeveloperTools #AI #CodingAgents #ClaudeCode #Cursor #Codex #BuildInPublic #SoftwareEngineering

---

## 2 · Pin this as the first comment

> 📦 Links
>
> → CLI · `github.com/openplanr/openplanr`
> → Pipeline plugin · `github.com/openplanr/planr-pipeline`
> → Skill · `github.com/openplanr/skills`
> → Marketplace · `github.com/openplanr/marketplace`
> → npm · `npmjs.com/package/openplanr`
> → Docs + protocol spec · `openplanr.dev`
>
> Follow me on GitHub · `github.com/asemdevs`
>
> Happy to answer questions in the thread.

---

## 3 · Reply playbook (5 pre-written responses for likely questions)

### Q1 — "How is this different from Cursor's planning mode / Linear PRDs / Notion AI?"

> Cursor, Linear, and Notion are great for the *human* side of planning — capturing intent, writing PRDs, breaking down stories. OpenPlanr is the layer below that: the part where you make sure the **agent** consumes the plan correctly. Codebase context. ADR awareness. Enforced scope at the manifest level so the agent literally cannot drift. They're complementary — most of my users keep their PRDs where they already are and let OpenPlanr generate the agent-readable artifacts from them.

### Q2 — "Doesn't Claude already have memory and skills built in?"

> It does — and OpenPlanr's skill uses that machinery. The difference is `.planr/memory.md` is **project-scoped, lives in your repo, is human-readable, and is git-blamable**. Decisions, Traps, and Corrections are append-only and auto-injected only when keyword-relevant to the current dispatch. Claude's general memory is user-scoped and lives in Claude's profile. Different layer. Both useful.

### Q3 — "Is this locked to Claude Code?"

> No. Claude Code is the canonical adapter (it's the only runtime that can enforce tool restrictions at the manifest layer), but the same protocol runs on Cursor and Codex: `planr rules generate --target cursor --scope pipeline` or `--target codex`. Same `.planr/specs/` artifacts, same workflow. The compatibility matrix is in the docs.

### Q4 — "What happens when an agent goes off-script?"

> Three layers catch it. (1) Manifest-enforced tool restrictions — the frontend agent's `tools:` list literally doesn't include write access to backend paths. (2) Per-task error reports the QA agent reads on retry. (3) A non-negotiable human checkpoint between PO Phase (decomposition) and DEV Phase (code). And R6 — the QA retry loop — auto-appends recurring failure patterns to `.planr/memory.md` so future runs avoid them.

### Q5 — "I'm a solo dev — do I need all this ceremony?"

> Nope. Use the bare CLI. `planr quick {task}` is a single-task workflow with zero agent ceremony. The pipeline is for repeatability across teams or many sessions. Three planning postures live side by side: **agile** (full hierarchy), **quick task** (one-shot), **spec-driven** (formal handoff to the pipeline). Use whichever fits the work.

---

## 4 · Carousel outline (matches the attached PDF)

| # | Title                          | Role                                                                   |
|---|--------------------------------|------------------------------------------------------------------------|
| 1 | Brief in. Code out. — Hook     | Capability framing; keyword chips: Backlog · Spec · Decompose · Estimate · Ship · Sync |
| 2 | The Flow                       | Vertical 5-stage pipeline overview (Capture → Decompose → Estimate → Ship → Sync) |
| 3 | Step 01 · Capture              | `planr backlog` + `planr spec create + shape` (guided 4-question flow) |
| 4 | Step 02 · Decompose            | T-task frontmatter preview with rationale field highlighted            |
| 5 | Step 03 · Assign — 8 agents    | Grid of 8 specialized subagents with model tier (Sonnet / Opus)        |
| 6 | Step 04 · Estimate             | COST ESTIMATE terminal preview with token range, dollar, time          |
| 7 | Step 05 · Ship                 | Side-by-side: manifest boundaries + project memory                     |
| 8 | Step 06 · Sync                 | Bidirectional Linear + GitHub Issues with three-way merge              |
| 9 | Try it — Two commands          | CTA with install commands + links                                       |

---

## 5 · Post-launch actions (do these in the first 24h)

1. **Within 5 minutes of posting:** pin the comment from section 2 above.
2. **Hours 1–4:** reply to every comment within 30 minutes — LinkedIn rewards fresh engagement velocity hard.
3. **Hour 6:** drop a follow-up comment with a 30-second screen recording of `planr init` → `/planr-pipeline:plan` → `/planr-pipeline:ship` (if you have one ready). Even a Loom link works.
4. **Day 2:** quote-share your own post with a single takeaway line from the carousel that performed best in the replies. Free second-impression boost.
5. **Day 3–4:** post the strongest reply as a standalone "ICYMI" mini-post.
6. **Within the week:** cross-post a tighter version to Twitter/X (drop the hashtags, lead with the hook line, link to the LinkedIn post for the carousel).
