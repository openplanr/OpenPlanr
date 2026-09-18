<p align="center">
  <img alt="OpenPlanr" width="72" src="https://raw.githubusercontent.com/openplanr/OpenPlanr/main/docs/assets/brand/openplanr-mark.svg">
</p>

<h1 align="center">openplanr</h1>

<p align="center">
  The <code>planr</code> CLI: planning files, validation, diagrams, host setup, diagnostics, and tracker sync for OpenPlanr.<br>
  Close the loop from intent to delivery with Claude Code, Codex, and Cursor.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/openplanr"><img alt="npm version" src="https://img.shields.io/npm/v/openplanr?style=flat-square&labelColor=08080C&color=237A72&label=openplanr"></a>
  <a href="https://www.npmjs.com/package/openplanr"><img alt="npm downloads" src="https://img.shields.io/npm/dm/openplanr?style=flat-square&labelColor=08080C&color=237A72"></a>
  <a href="https://github.com/openplanr/OpenPlanr/actions/workflows/ci.yml"><img alt="Workspace CI" src="https://img.shields.io/github/actions/workflow/status/openplanr/OpenPlanr/ci.yml?branch=main&style=flat-square&labelColor=08080C&color=237A72&label=CI"></a>
  <a href="https://nodejs.org"><img alt="Node.js 20 or later" src="https://img.shields.io/node/v/openplanr?style=flat-square&labelColor=08080C&color=237A72"></a>
  <a href="https://github.com/openplanr/OpenPlanr/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-237A72?style=flat-square&labelColor=08080C"></a>
</p>

OpenPlanr gives your coding agent 27 skills for specifying, planning, reviewing, designing,
diagramming, shipping, and operating work from plans stored in your repository under
`.planr/`. This package is the deterministic half: the `planr` command that stores and
validates those files, renders diagrams and reports, installs the skills into each host,
diagnoses the installation, and syncs with GitHub Issues and Linear. It never calls a
model. Reasoning happens in the agent; the CLI keeps the record straight.

## Install

```bash
npm install -g openplanr
planr --version
```

Also available as `openplanr` and `opr`. Alternatives: `npx openplanr@latest setup`, or
the installers `curl -fsSL https://openplanr.dev/install.sh | sh` and
`irm https://openplanr.dev/install.ps1 | iex`. Requires Node.js 20 or later.

## Quick start

```bash
planr setup --runtime claude --scope user
# Codex:  planr setup --runtime codex --scope user --skill-mode unified-plugin
# Cursor: planr setup --runtime cursor --scope project

cd your-project
planr init
planr rules generate --target claude   # adds the skill map to CLAUDE.md (or codex → AGENTS.md)
```

Restart the coding agent, then ask for a specification: `/planr:spec "…"` in Claude Code,
`$planr:spec "…"` in Codex, or mention the `planr-spec` rule in Cursor. Continue with
`plan` to decompose it into stories and tasks and `ship` to implement one task. Plan and
ship stay separate steps that you invoke.

`planr setup --dry-run` previews every file before anything is written; existing files
are backed up byte for byte and `planr runtime rollback` restores them. See the
[setup guide](docs/CROSS_RUNTIME_SETUP.md).

## What the CLI does

| Group | Commands | Purpose |
| --- | --- | --- |
| Planning files | `spec`, `epic`, `feature`, `story`, `task`, `quick`, `backlog`, `sprint`, `template`, `checklist`, `update`, `search`, `graph` | Create, validate, and query artifacts under `.planr/` in three postures: spec-driven (`SPEC-NNN-{slug}/`), agile hierarchy, and quick tasks |
| Hosts | `setup`, `runtime`, `rules generate`, `doctor`, `upgrade` | Install and update the skills for Claude Code, Codex, and Cursor; generate host guidance; diagnose drift; compare with the published set |
| Delivery | `status`, `sync`, `land`, `export`, `report`, `dashboard` | Delivery status across specs and backlog, cross-reference repair, landing plans, stakeholder reports, and the loopback-only planning dashboard |
| Design and diagrams | `artifact`, `diagram` | Review any HTML artifact with pins and decisions; render and verify diagrams offline across 39 grammars |
| Operations and trackers | `operate`, `github`, `linear`, `company` | Run durable Operate cycles; two-way sync with GitHub Issues and Linear; publish selected artifacts to a company workspace |

Every command supports `--yes` for non-interactive use and most support `--json`. The
[CLI reference](docs/CLI.md) documents every command and flag.

## Skills run in your agent

The skills (`spec`, `plan`, `plan-review`, `sprint`, `ship`, `browser-qa`, `design`,
`design-loop`, `design-review`, `diagram`, `artifact`, `land`, `release`, `doctor`,
`investigate`, `status`, `sync`, `dashboard`, `openplanr`, `operate`, and the seven Operate
reviews) ship inside this package and are installed by `planr setup`. The
[skill catalog](https://github.com/openplanr/OpenPlanr/blob/main/docs/generated/skills.md)
lists each skill's triggers, deferrals, and packaged references.

| Host | Install | Invoke |
| --- | --- | --- |
| Claude Code | `planr setup --runtime claude --scope user` | `/planr:<skill>`; `ship` dispatches nine role agents |
| Codex | `planr setup --runtime codex --scope user --skill-mode unified-plugin` | `$planr:<skill>` |
| Cursor | `planr setup --runtime cursor --scope project` | mention the `planr-<skill>` rule in Composer |

## Documentation

- [CLI reference](docs/CLI.md)
- [Cross-runtime setup, migration, and rollback](docs/CROSS_RUNTIME_SETUP.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Artifact review and private sharing](docs/ARTIFACT_REVIEW.md)
- [Project documentation](https://github.com/openplanr/OpenPlanr/blob/main/docs/README.md),
  [getting started](https://github.com/openplanr/OpenPlanr/blob/main/docs/getting-started.md),
  and [support](https://github.com/openplanr/OpenPlanr/blob/main/SUPPORT.md)

## License

[MIT](LICENSE). The OpenPlanr name and logo are covered by the
[trademark policy](https://github.com/openplanr/OpenPlanr/blob/main/TRADEMARKS.md).
