<div align="center">

# OpenPlanr Skill

**Agile planning for AI coding agents.**

Install once — any Claude-powered agent can now plan your project before writing a line of code.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/openplanr.svg?label=openplanr%20CLI)](https://www.npmjs.com/package/openplanr)
[![Agent Skills Spec](https://img.shields.io/badge/Agent%20Skills-compatible-8A2BE2)](https://agentskills.io/specification)

[Main CLI](https://github.com/openplanr/openplanr) · [npm](https://www.npmjs.com/package/openplanr) · [Command reference](https://github.com/openplanr/openplanr/blob/main/docs/CLI.md) · [Issues](https://github.com/openplanr/skills/issues)

</div>

---

## The problem

AI coding agents are great at writing code — and bad at planning it. They jump to implementation without structuring the work into epics, features, stories, and tasks. You end up with code that solves the wrong problem, or the right problem at the wrong granularity.

[OpenPlanr](https://github.com/openplanr/openplanr) is a CLI that fixes this. It turns a brief or a PRD into a full agile plan — markdown artifacts your team and your agents can read, refine, and implement against.

This **skill** teaches Claude to drive the CLI on your behalf. You stay in the conversation; Claude runs the commands and reads back the results.

## What you can ask

Once installed, any Claude agent understands:

> *"Plan out the authentication feature from this PRD."*
> *"Break this user story into tasks."*
> *"Estimate story points for everything in Sprint 4."*
> *"Prioritize the backlog by impact and effort."*
> *"Generate `CLAUDE.md` and `AGENTS.md` from our planning artifacts."*

The skill detects the planning intent, runs the right `planr` command with the right flags (always in non-interactive `--yes` mode), and summarizes the artifacts it produced.

## How it works

```
 You  ───►  Claude (with skill)  ───►  planr CLI  ───►  .planr/*.md
                                                         │
                                                         ▼
                                            artifacts the agent
                                            then implements against
```

Installing the skill adds a `SKILL.md` instruction file plus references and worked examples. Claude loads the instructions on demand when it detects a planning intent and calls OpenPlanr via `npx openplanr@latest` (no global install required).

## Install

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

See the [CLI repo](https://github.com/openplanr/openplanr) and the [command reference](https://github.com/openplanr/openplanr/blob/main/docs/CLI.md).

## Who this is for

- **Solo developers** using Claude agents who want structure without heavyweight PM tooling
- **Small teams** standardizing on an agile hierarchy their agents can read
- **Enterprises** that need auditable, file-based planning that lives in git

## What's in this repo

```
skills/openplanr/
├── SKILL.md                    # The skill entry point (loaded by Claude)
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

- [OpenPlanr CLI](https://github.com/openplanr/openplanr) — the planning engine this skill drives
- [Agent Skills specification](https://agentskills.io/specification)
- [Anthropic skills examples](https://github.com/anthropics/skills)
- [Claude Code plugin marketplaces](https://docs.claude.com/en/docs/claude-code/plugins)

## License

[MIT](./LICENSE) © OpenPlanr
