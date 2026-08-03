# OpenPlanr Launch Plan

> Three-layer distribution strategy for taking OpenPlanr from v1.3.0 to public adoption.

**Status:** Active — v1.3.0 released, Layer 1 in progress
**Layer 1 tracking:** `QT-001` in the `openplanr/skills` repo (Layer 1 scope moved out of this repo)
**Last updated:** 2026-04-24

---

## Strategy Overview

OpenPlanr is a CLI — installable via `npm i -g openplanr` or `npx openplanr@latest`. That makes it usable by humans today, but invisible to AI coding agents that don't know about it. Launch happens in three layers, each independently valuable, each amplifying the next.

| Layer | What | Effort | Impact | Status |
|-------|------|--------|--------|--------|
| **1** | Agent Skill — `openplanr/skills` repo | Hours–days | High visibility, zero-friction agent adoption | **In progress** |
| **2** | MCP Server — `openplanr/mcp-server` | Days–weeks | Native tool calling across Claude Code, Cursor, Codex | Not started |
| **3** | Platform plugins — Claude Code marketplace, Cursor marketplace, Codex plugin directory | Varies | Platform-native discovery | Not started |

**Sequencing logic:** Skill ships first because it's cheap and creates immediate adoption surface. MCP second because it validates the agent-integration thesis with richer tooling. Platform plugins last because each platform has different packaging and the validation from 1 & 2 informs where to invest.

---

## Layer 1 — Agent Skill

### What

A standalone repository (`github.com/openplanr/skills`) containing a single skill folder (`skills/openplanr/`) that any Claude-powered agent can load. The skill teaches Claude:

- When planning is needed
- How to install and invoke OpenPlanr (via `npx openplanr@latest <cmd> --yes`)
- What each command does
- How to interpret generated artifacts

### Artifacts

- **PRD:** `/Users/asemabdou/Work/openplanr-skills/PRD.md` — complete spec for building the repo
- **Scaffold directory:** `/Users/asemabdou/Work/openplanr-skills/` — sibling to OpenPlanr, ready to hand to an agent session

### Checklist

- [x] v1.3.0 CLI released (prerequisite)
- [x] PRD drafted in scaffold directory
- [ ] Create GitHub repo `openplanr/skills` (public, MIT)
- [ ] Hand PRD to an agent session and generate repo contents
- [ ] Test skill activation in Claude Code dev mode
- [ ] Test skill activation in Claude.ai upload
- [ ] Push v1.0.0 tag and GitHub release
- [ ] Add "Claude Skill" badge to main OpenPlanr README linking to the skill repo
- [ ] Announce on Twitter / X
- [ ] Submit to awesome-claude-skills and awesome-agents lists
- [ ] Write a blog post: "How we made OpenPlanr installable in 3 seconds for every Claude user"

### Success criteria

- Skill activates on >90% of planning-intent prompts
- Zero false positives on non-planning prompts in first 10 test cases
- 50+ stars on the skills repo within first month
- 100+ `/plugin marketplace add` installs within first month

---

## Layer 2 — MCP Server

### What

An MCP (Model Context Protocol) server that exposes OpenPlanr as native tools and resources. Unlike the skill (which teaches an agent to call the CLI), the MCP server surfaces commands directly as callable tools with strongly-typed inputs and structured outputs. Works in Claude Code, Cursor, Codex, and any MCP-compatible client.

### Scope

**Tools (commands exposed as callable functions):**

- `planr_init` — initialize a project
- `planr_plan` — full Epic → Features → Stories → Tasks cascade
- `planr_create_epic` / `planr_create_feature` / `planr_create_story` / `planr_create_task`
- `planr_create_quick_task`
- `planr_estimate` — AI story point estimation
- `planr_refine` — AI review with cascade option
- `planr_status` — project progress
- `planr_list` — list artifacts of a given type
- `planr_read` — read a specific artifact
- `planr_sync` — validate and repair cross-references
- `planr_generate_rules` — CLAUDE.md / AGENTS.md / .cursor/rules

**Resources (artifacts exposed as readable files):**

- `planr://epics/EPIC-XXX` → markdown content
- `planr://features/FEAT-XXX`
- `planr://stories/US-XXX` (with inline Gherkin)
- `planr://tasks/TASK-XXX`
- `planr://quick/QT-XXX`
- `planr://backlog/BL-XXX`
- `planr://sprints/SPRINT-XXX`
- `planr://status` — current project tree

### Stack

- **Language:** TypeScript (matches main CLI, same tooling and testing)
- **SDK:** `@modelcontextprotocol/sdk` Node/TypeScript SDK
- **Transport:** stdio (local agents) + streamable HTTP (remote)
- **Distribution:** `@openplanr/mcp` on npm; invokable via `npx @openplanr/mcp`

### Checklist

- [ ] Create repo `github.com/openplanr/mcp-server`
- [ ] Scaffold with TypeScript + MCP SDK
- [ ] Implement core tools (init, plan, create_epic, create_feature, create_story, create_task, status)
- [ ] Implement resources (read, list)
- [ ] Implement AI-powered tools (estimate, refine, prioritize)
- [ ] Write MCP spec-compliant error handling and response formatting
- [ ] Integration tests against Claude Code and Cursor
- [ ] Publish `@openplanr/mcp@0.1.0` to npm
- [ ] Document install: `claude mcp add openplanr -- npx -y @openplanr/mcp`
- [ ] Cross-reference: update skill to mention MCP option for users who prefer native tooling
- [ ] Blog post: "Why we built an MCP server AND a skill for OpenPlanr"

### Success criteria

- MCP server works end-to-end in Claude Code and Cursor
- 500+ weekly npm downloads within first month post-announcement
- Every CLI command has an MCP tool equivalent OR is explicitly documented as CLI-only

### Dependencies on Layer 1

- Layer 1 validates that agents understand OpenPlanr's conceptual model
- Skill remains the primary onboarding path even after MCP ships (simpler mental model for new users)

---

## Layer 3 — Platform Plugins

### What

Platform-specific packages that give OpenPlanr native presence in each ecosystem's plugin marketplace. Each platform has different packaging requirements and discovery mechanisms.

### Platforms

#### 3.1 Claude Code Plugin

- **Format:** Plugin with commands, hooks, and agent definitions per Claude Code plugin spec
- **Distribution:** `/plugin marketplace add openplanr/claude-code-plugin` or inclusion in the official marketplace
- **Unique surface:** Slash commands (`/planr-plan`, `/planr-status`), skills bundled together, potential for agent definitions specialized for planning
- **Relationship to Layer 1:** The skill repo is already usable via `/plugin marketplace add openplanr/skills`. A dedicated plugin is a more curated experience with multiple skills, commands, and hooks bundled.

#### 3.2 Cursor Marketplace

- **Format:** `.cursorrules` bundle OR Cursor plugin (if/when they launch one)
- **Distribution:** Cursor's rule library / marketplace
- **Unique surface:** Inline agent behavior when editing files
- **Relationship to Layer 1 & 2:** The CLI already generates `.cursor/rules/*.mdc` via `planr rules generate`. A marketplace entry is a pre-packaged starter bundle so users don't need the CLI before they start planning.

#### 3.3 Codex Plugin

- **Format:** Per OpenAI Codex plugin directory specification
- **Distribution:** Codex plugin directory listing
- **Unique surface:** Native integration in Codex CLI sessions
- **Relationship to Layer 1 & 2:** Codex already reads `AGENTS.md` generated by `planr rules generate`. A plugin adds command integration.

### Checklist

- [ ] Evaluate each platform's current plugin maturity (blocked on external decisions)
- [ ] Prioritize platforms by user share among OpenPlanr target audience
- [ ] Claude Code plugin first (likely highest adoption)
- [ ] Submit to official marketplaces where applicable
- [ ] Maintain packaging parity across platforms where feasible

### Success criteria

- Listed in at least 2 of the 3 platform marketplaces within 6 months of Layer 2 release
- Plugin installs reach 5,000+ combined within 3 months of marketplace listing

---

## Cross-Cutting Workstreams

These work alongside all three layers:

### Documentation

- [ ] Main OpenPlanr README updated with "Installation options" (CLI, Skill, MCP, Platform)
- [ ] Dedicated docs site (GitHub Pages or similar) with visual walkthroughs
- [ ] Video: 3-minute demo of full planning flow driven by an agent
- [ ] Blog series: "Building a CLI for the agent era" (technical decisions, lessons learned)

### Announcements

- [ ] Twitter / X launch thread with demo video
- [ ] Post in r/ClaudeAI, r/LocalLLaMA, r/programming
- [ ] Submit to Hacker News (timing: Tuesday–Thursday morning PT)
- [ ] Product Hunt launch
- [ ] Submit to awesome lists: awesome-claude-skills, awesome-agents, awesome-mcp, awesome-cli
- [ ] Personal / company blog post
- [ ] DM outreach to agile-focused developer influencers

### Community

- [ ] Create Discord or GitHub Discussions for users
- [ ] Monitor issues across all repos (CLI, skills, MCP)
- [ ] Contributor guidelines + good-first-issue labels
- [ ] Monthly changelog digest email (opt-in)

### Metrics

Track weekly, in a single dashboard:

| Metric | Source | Target (3 months) |
|--------|--------|-------------------|
| npm weekly downloads | npmjs.com stats | 2,000+ |
| GitHub stars (main repo) | GitHub | 500+ |
| GitHub stars (skills repo) | GitHub | 200+ |
| MCP weekly downloads | npmjs.com stats | 1,000+ |
| Discord / Discussions active users | Platform | 100+ |
| Skill activations (if instrumented) | Anonymized telemetry | 10,000+/month |

---

## Non-Goals

To keep focus, these are explicitly NOT part of the launch:

- **Web UI / SaaS dashboard** — handled by external tools (KanbanOS, GitHub Projects, Linear). OpenPlanr stays file-based.
- **Spec-kit parity** — we are building OpenPlanr's own proprietary direction, not chasing competitor features.
- **VS Code extension** — most VS Code users are on Cursor or Claude Code already.
- **Paid tier / enterprise features** — community-first until organic adoption validates demand.
- **Integrations beyond GitHub** — Linear/Jira/Asana integrations are backlog candidates, not launch blockers.

---

## Timeline (Rough)

| Week | Milestone |
|------|-----------|
| 0 (current) | v1.3.0 released, Skill PRD drafted |
| 1 | Skill repo built, tested, v1.0.0 released |
| 1 | Skill announcement (Twitter, Reddit, Hacker News) |
| 2–3 | MCP server scaffolding and core tools |
| 4 | MCP server v0.1 published, integration tested |
| 5 | MCP announcement (second wave) |
| 6–8 | Platform plugin evaluation and first marketplace listing |
| 9+ | Metrics review, iterate on what's working |

Dates are aspirational — adjust based on feedback and actual effort. Do not let process slow down announcements; ship small and often.

---

## Decision Log

Decisions to revisit if circumstances change:

1. **Skill before MCP** — chosen because skill is cheaper to ship and creates adoption surface. Revisit if MCP proves to be the primary agent integration path and skill usage is low.
2. **TypeScript for MCP** — matches CLI stack. Revisit only if a compelling Rust / Go MCP framework emerges.
3. **No telemetry in v1.0** — privacy-first default. Revisit at v1.2+ if growth metrics become unobservable.
4. **MIT license across all repos** — maximum adoption surface. Revisit only if someone ships a hostile fork.
5. **No paid tier** — community-first. Revisit after 10,000+ weekly active users.
