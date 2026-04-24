<div align="center">

# OpenPlanr Skill

**Agile planning, built for AI coding agents.**

Install this skill once — any Claude-powered agent can now plan your project before writing a line of code.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](#status)
[![Agent Skills Spec](https://img.shields.io/badge/Agent%20Skills-compatible-8A2BE2)](https://agentskills.io/specification)

[Main CLI](https://github.com/openplanr/openplanr) · [npm](https://www.npmjs.com/package/openplanr) · [Docs](https://github.com/openplanr/openplanr/blob/main/docs/CLI.md) · [Issues](https://github.com/openplanr/skills/issues)

</div>

---

## Status

> **Alpha.** This is the public home of the OpenPlanr agent skill. The v1.0 release is being built out from the PRD. Watch this repo to be notified when it ships. Install instructions below will become live with the v1.0.0 release.

## The problem

AI coding agents are great at writing code — and bad at planning it. They jump to implementation without structuring the work into epics, features, stories, and tasks. You end up with code that solves the wrong problem, or the right problem at the wrong granularity.

[OpenPlanr](https://github.com/openplanr/openplanr) is a CLI that fixes this. It turns a brief or a PRD into a full agile plan — markdown artifacts your team and your agents can read, refine, and implement against.

The CLI works from a terminal. This **skill** teaches Claude to run the CLI on your behalf, without you having to memorize commands.

## What you get

Once installed, you can ask any Claude agent:

> *"Plan out the authentication feature from this PRD."*
> *"Break this story into tasks."*
> *"Estimate story points for everything in Sprint 4."*
> *"Generate agent rules from our planning artifacts."*

The skill detects the intent, runs the right `planr` command with the right flags, and reads back the result — no manual CLI invocation required. You stay in the flow of talking to the agent.

## How it works

```
 You  ───►  Claude (with skill)  ───►  planr CLI  ───►  .planr/*.md
                                                       │
                                                       ▼
                                          artifacts the agent
                                          then implements against
```

Installing the skill adds a `SKILL.md` instruction file that Claude loads when it detects a planning intent. The skill tells Claude to run OpenPlanr via `npx openplanr@latest` (no global install needed), always with `--yes` for agent-friendly non-interactive execution.

## Installation

All three channels will be live with the v1.0.0 release.

<details>
<summary><b>Claude Code</b></summary>

Two commands — the first registers this repo as a plugin marketplace, the second installs the OpenPlanr plugin from it.

```bash
/plugin marketplace add openplanr/skills
/plugin install openplanr@openplanr-skills
```

Alternatively, after adding the marketplace, use `/plugin` to browse and install interactively. Claude Code activates the skill automatically when it detects planning intent.

</details>

<details>
<summary><b>Claude.ai (Pro, Max, Team, Enterprise)</b></summary>

Download the skill folder and upload it as a custom skill via the Claude.ai settings panel. Full walkthrough coming in `docs/INSTALL.md`.

</details>

<details>
<summary><b>Claude API</b></summary>

Upload via the Skills API — see the [Skills API Quickstart](https://docs.claude.com/en/api/skills-guide).

</details>

## What about the OpenPlanr CLI?

The CLI is the actual planning engine — this skill is a thin instruction layer. You can use OpenPlanr today without the skill:

```bash
npx openplanr@latest init
npx openplanr@latest plan
```

See the [CLI repo](https://github.com/openplanr/openplanr) and the [command reference](https://github.com/openplanr/openplanr/blob/main/docs/CLI.md).

## Who this is for

- **Solo developers** using Claude agents who want structure without heavyweight PM tooling
- **Small teams** standardizing on an agile hierarchy their agents can read
- **Enterprises** that need auditable, file-based planning that lives in git

## Roadmap

| Milestone | Status |
|-----------|--------|
| PRD drafted | Done |
| Repo scaffold | Done |
| `SKILL.md` + references | In progress |
| Worked examples | Planned |
| Installation docs | Planned |
| v1.0.0 release | Planned |
| Claude Code marketplace listing | Planned |
| MCP server (separate repo) | Planned |

## Contributing

Contribution guidelines will be published alongside v1.0.0 in `docs/CONTRIBUTING.md`. In the meantime, [open an issue](https://github.com/openplanr/skills/issues) with feedback, ideas, or activation test cases you'd like the skill to handle.

## Related

- [OpenPlanr CLI](https://github.com/openplanr/openplanr) — the planning engine this skill drives
- [Agent Skills specification](https://agentskills.io/specification)
- [Anthropic skills examples](https://github.com/anthropics/skills)

## License

[MIT](./LICENSE) © OpenPlanr
