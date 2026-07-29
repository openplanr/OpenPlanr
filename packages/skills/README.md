<div align="center">

# OpenPlanr Runtime Skills

**Dedicated planning and complete delivery workflows across AI runtimes.**

Install once, then use the same planning and pipeline workflow on Claude Code,
Codex, or Cursor.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/openplanr.svg?label=openplanr%20CLI)](https://www.npmjs.com/package/openplanr)
[![Agent Skills Spec](https://img.shields.io/badge/Agent%20Skills-compatible-8A2BE2)](https://agentskills.io/specification)

[Main CLI](https://github.com/openplanr/OpenPlanr) · [npm](https://www.npmjs.com/package/openplanr) · [Command reference](https://github.com/openplanr/OpenPlanr/blob/main/docs/CLI.md) · [Issues](https://github.com/openplanr/skills/issues)

</div>

---

## The problem

AI coding agents are great at writing code — and bad at planning it. They jump to implementation without structuring the work into epics, features, stories, and tasks. You end up with code that solves the wrong problem, or the right problem at the wrong granularity.

[OpenPlanr](https://github.com/openplanr/OpenPlanr) is a CLI that fixes this. It turns a brief or a PRD into a full agile plan — markdown artifacts your team and your agents can read, refine, and implement against.

This bundle teaches compatible runtimes to drive both products correctly:
OpenPlanr for ongoing planning and project management, and planr-pipeline for the
complete PO → Design → Review → DEV → QA flow, including feature-local planning.

## What you can ask

Once installed, any Claude agent understands:

> *"Plan out the authentication feature from this PRD."*
> *"Break this user story into tasks."*
> *"Estimate story points for everything in Sprint 4."*
> *"Prioritize the backlog by impact and effort."*
> *"Generate `CLAUDE.md` and `AGENTS.md` from our planning artifacts."*

The skill detects the planning intent, runs the appropriate public `planr`
command, and summarizes the artifacts it produced. It uses `--yes` only after
the user has authorized that named action; it never treats a prior approval as
blanket consent for provider use, route application, PLAN, or SHIP.

## How it works

```
 You  ───►  runtime skill  ───►  planr router  ───►  .planr/*.md
                                                         │
                                                         ▼
                                            artifacts the agent
                                            then implements against
```

The bundle provides a unified router plus focused Operating Board, artifact
review, PLAN, Design, SHIP, dashboard, sync, and doctor skills. Codex
installation is handled by `planr setup`; Claude Code can consume this
marketplace; Cursor uses generated project rules.

Operating Board turns verified project evidence into a cited brief, decisions,
data gaps, and reviewed routes:

```bash
planr operate init
planr operate run --preview
planr operate run --dry-run
planr operate run
planr operate brief
```

The runtime skill is deliberately thin: all evidence policy, advisor isolation,
scoring, state transitions, route confirmation, and recovery remain inside the
public `planr operate` command. `--preview` calls no providers and writes
nothing; `--dry-run` may use a disclosed, consented provider but commits no
state. Runtime-native prompts render CLI-owned questionnaires and return typed
answers through resumable sessions; the skill never embeds defaults or infers
authority. Each non-read-only action has a separate confirmation digest.
Evidence quarantine returns a value-free public diagnose/classify flow instead
of encouraging config edits. Finding acceptance and route application are
separate. Answered gaps require `gaps verify` with explicit evidence IDs.

Pipeline-PO DEV routes pause at `awaiting-plan` and return the exact native PLAN
invocation. The skill resumes that same route only after human review and
matching planning provenance, with `shipInvoked: false`. `run --review-only`
may reconcile separately produced shipment proof and due outcome observations;
it never invokes SHIP or an external action.

Generic HTML review uses a quiet, edge-to-edge document presentation by
default. Design boards retain the zoomable canvas. Both use the same bundled,
opaque-origin review sandbox and the public `planr artifact` command.

Artifact sharing creates a stable encrypted live room by default. Reviewers
collaborate on one URL in real time; the creator receives a separate private
manage URL. Immutable fragment and encrypted short-link sharing remain
available through `planr artifact share <file> --snapshot`.

## Install

### Guided cross-runtime setup (recommended)

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
cd my-project
planr setup
planr doctor
```

The installer installs only the CLI. Guided setup detects Claude Code, Codex,
and Cursor, then asks which integrations and scopes to configure. User scope is
the safe default; it never writes project files into your home directory.

### Claude Code

Two commands — the first registers this repo as a plugin marketplace, the second installs the OpenPlanr plugin from it:

```bash
/plugin marketplace add openplanr/skills
/plugin install openplanr@openplanr-skills
```

Alternatively, after adding the marketplace, run `/plugin` to browse and install interactively. Claude Code activates the skill automatically when it detects planning intent.

### Claude.ai (Pro, Max, Team, Enterprise)

Download the skill folder and upload it as a custom skill:

```bash
git clone https://github.com/openplanr/skills
cd skills/skills/openplanr
zip -r ../../openplanr-skill.zip .
```

Upload the resulting `openplanr-skill.zip` via the Claude.ai skill upload UI. Full walkthrough in [`docs/INSTALL.md`](./docs/INSTALL.md).

### Claude API

Upload via the Skills API — see the [Skills API Quickstart](https://docs.claude.com/en/api/skills-guide). Full example in [`docs/INSTALL.md`](./docs/INSTALL.md).

## Use OpenPlanr directly

The CLI is the planning engine — this skill is a thin instruction layer. You can use OpenPlanr today without the skill:

```bash
npx openplanr@latest init
npx openplanr@latest plan
```

See the [CLI repo](https://github.com/openplanr/OpenPlanr) and the [command reference](https://github.com/openplanr/OpenPlanr/blob/main/docs/CLI.md).

OpenPlanr owns dedicated planning and artifact lifecycle. `planr-pipeline` owns
the complete delivery flow and also performs feature-local planning. Provenance
records which planning engine decomposed a spec.

## Who this is for

- **Solo developers** using Claude agents who want structure without heavyweight PM tooling
- **Small teams** standardizing on an agile hierarchy their agents can read
- **Enterprises** that need auditable, file-based planning that lives in git

## What's in this repo

```
skills/openplanr-unified/       # Product/runtime routing
skills/planr-artifact/          # Local review and private share/import/export
skills/planr-plan/              # Feature-local PO phase
skills/planr-design/            # Design workflows
skills/planr-ship/              # DEV + QA + finalization
skills/planr-dashboard/         # Local project visualization
skills/planr-sync/              # Read-only reconciliation audit
skills/planr-doctor/            # Unified diagnostics
skills/planr-operate/           # Evidence-to-decision operating cycles
skills/openplanr/               # Legacy skill retained for deprecation window
├── SKILL.md
├── references/
│   ├── commands.md             # Full ~40-command catalog
│   ├── workflows.md            # 7 canonical end-to-end workflows
│   ├── artifacts.md            # Frontmatter schema + hierarchy guide
│   └── troubleshooting.md      # Symptom → fix FAQ
└── examples/
    ├── plan-from-prd.md        # PRD → full agile hierarchy
    ├── quick-task.md           # Standalone checklist (no hierarchy)
    └── sprint-cycle.md         # Sprint create → track → close
```

See [`docs/INSTALL.md`](./docs/INSTALL.md) for install details, [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for how to propose changes, and [`docs/PUBLISHING.md`](./docs/PUBLISHING.md) for the release process.

## Related

- [OpenPlanr CLI](https://github.com/openplanr/OpenPlanr) — the planning engine this skill drives
- [Agent Skills specification](https://agentskills.io/specification)
- [Anthropic skills examples](https://github.com/anthropics/skills)
- [Claude Code plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugins)

## License

[MIT](./LICENSE) © OpenPlanr
