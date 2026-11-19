# Getting started

Install OpenPlanr as a plugin or as individual skills, then choose the workflow your
request needs. The companion CLI adds planning utilities, diagram rendering, local
studios, diagnostics, and integrations.

## Requirements

- A coding agent that supports plugins or skills, such as Claude Code, Codex, or Cursor.
- A project directory for repository work.
- Node.js and npm when using an npm-based installer or the OpenPlanr CLI. The
  [skills installer](https://github.com/vercel-labs/skills#install-a-skill) and
  [OpenPlanr CLI package](../packages/cli/package.json) declare their own supported versions.

## 1. Install the plugin or skills

Choose one installation method per host.

### Claude Code marketplace

```text
/plugin marketplace add openplanr/marketplace
/plugin install planr@openplanr
```

Restart Claude Code, then invoke a plugin skill such as `/planr:ship` or `/planr:operate`.
Marketplace installation does not require installing the OpenPlanr CLI first. Workflows
that use CLI utilities still need the companion CLI described below.

### Individual skills

Install from the source repository with the standard skills installer:

```bash
npx skills add openplanr/OpenPlanr
```

In a normal terminal, the installer offers skill selection and Project/Global scope.
It detects available coding agents; it can select a single detected host automatically
or ask you to choose. Project scope is the default.

The flags are optional controls for selecting an exact installation or scripting it:

| Flag | Use it when |
| --- | --- |
| `--skill planr-spec` | You already know which skill to install |
| `--agent codex` | You want to select the destination host explicitly |
| `--copy` | You want independent file copies instead of links |
| `--global` | You want the skills available across projects |
| `--yes` | You want to accept the selections without confirmation prompts |

When the installer detects that it is running inside a coding agent, it uses
noninteractive defaults. For that case, name the skill and destination explicitly:

```bash
npx skills add openplanr/OpenPlanr --skill planr-spec --agent codex
```

All 30 source skill folders include their declared references and schemas; no OpenPlanr
build step is needed before the installer copies them. Installing a skill does not run
its workflow or install the optional CLI utilities it may call.

These source skills retain names such as `planr-ship`, rather than the plugin namespace
`planr:ship`. Use the installed name in the host's skill picker. An individual skill does
not install the plugin's native role definitions; workflows use the capabilities your
host provides.

You can also install a complete folder from [`skills/`](../skills/) through your host's
normal GitHub or local-folder skill installer. Retain `SKILL.md`, references, and all
supporting files. Restart the host when its installation flow requires it.

### CLI-managed plugins and rules

If you prefer OpenPlanr to manage installation and updates, install the companion CLI
below, then use `openplanr setup`. This route supports the unified plugin in Claude Code
and Codex, individual Codex skills, and Cursor project rules.

## 2. Add the companion CLI when needed

Several workflows call the CLI for capabilities such as diagram rendering, local
studios, planning validation, and diagnostics. Install it alongside the plugin or skills:

```bash
npm install -g openplanr
openplanr --version
```

The package installs two equivalent commands: `openplanr` and its short alias `opr`.
It requires a supported Node.js version (see [package metadata](../packages/cli/package.json)).
The installers never install or upgrade Node.js silently.

Alternatives:

```bash
npx openplanr@latest setup
curl -fsSL https://openplanr.dev/install.sh | sh
irm https://openplanr.dev/install.ps1 | iex
```

### CLI-managed setup

Run `openplanr setup` without flags in your terminal for guided host and scope choices.
When Codex has multiple available discovery modes, setup also asks which one to use.

`openplanr setup` detects the agents on the machine, shows exactly what it will write,
and installs the skills for the host and scope you choose. Preview first:

```bash
openplanr setup --runtime claude --scope user --dry-run
openplanr setup --runtime claude --scope user
```

| Host | Command | What it writes |
| --- | --- | --- |
| Claude Code | `openplanr setup --runtime claude --scope user` | A generated local marketplace and the unified `planr` plugin, registered with Claude Code |
| Codex | `openplanr setup --runtime codex --scope user --skill-mode unified-plugin` | The unified `planr` plugin, registered through Codex's plugin marketplace |
| Cursor | `openplanr setup --runtime cursor --scope project` | Thin `.mdc` discovery rules under `.cursor/rules/openplanr/` |
| Everything | `openplanr setup --runtime all --scope both` | All of the above |

User scope installs once per machine and is the default; project scope installs into
the current repository and is required for Cursor. Codex can also install each skill
separately (`--skill-mode direct`, invoked by bare name such as `$spec`) or as project
rules (`--skill-mode project-rule`). Project writes need a Git worktree
or an initialized `.planr/` project; setup never treats your home directory as a
project. Existing files are backed up byte for byte under `~/.planr/backups/`, and
only OpenPlanr-managed marker blocks are ever replaced. Direct and project skill
entries read an exact cached package under `~/.planr/runtime/packages/`; they do
not copy the runtime's schemas and scripts into your repository. `PLANR_HOME`
relocates that cache and OpenPlanr state; `CODEX_HOME` selects the native Codex
profile independently. Both scope reuses user discovery with project policy
rather than installing the same Claude or Codex skills twice. Regenerate local
loaders on each machine instead of committing their absolute cache paths.

Restart the coding agent after CLI-managed setup so it loads the new integration.

## 3. Enable structured planning when needed

Direct requests such as a small implementation or an operating review can start without
`.planr/`. To use OpenPlanr's structured planning directories:

```bash
cd your-project
openplanr init
```

`openplanr init` creates `.planr/config.json`, the artifact directories (`epics/`,
`features/`, `stories/`, `tasks/`, `quick/`, `backlog/`, `sprints/`, `adrs/`,
`checklists/`, `diagrams/`), an agile checklist, and an estimation guide. Commit `.planr/` with your code.

To let the agent see every skill and when to use it, generate the host guidance:

```bash
openplanr rules generate --target claude   # or codex, cursor, all
```

This adds an `## OpenPlanr capabilities` section to `CLAUDE.md` or `AGENTS.md` between
managed markers; your own content outside the markers is left alone.

## 4. Choose your first workflow

Start with `ship` for a clear change, `investigate` for a bug, `design` for interface work,
or `operate` for a grounded operating review. Use `spec` when requirements need clarification
and `plan` when the work needs decomposition.

For a feature that benefits from a specification, invoke the spec skill with your
installation's naming convention. Plugin examples:

```text
/planr:spec "Add passwordless sign-in for existing accounts"     # Claude Code
$planr:spec "Add passwordless sign-in for existing accounts"     # Codex
```

In Cursor, mention the `planr-spec` rule in Composer and describe the change. The
skill reads the repository, asks only the questions that change the outcome, and
writes `.planr/specs/SPEC-001-<slug>/SPEC-001-<slug>.md`.

Then:

| Step | Skill | Result |
| --- | --- | --- |
| Plan | `plan` | User stories and tasks under the specification, with acceptance criteria and file-level change lists |
| Review the plan | `plan-review` | Product, engineering, design, and developer-experience findings |
| Implement | `ship` | The requested change implemented, with check results and remaining gaps reported |
| Check status | `status` or `openplanr status --md` | Every specification, story, and task by status |

Plan and ship are separate steps. The agent never chains them on its own.

## 5. Keep CLI-managed installations healthy

```bash
openplanr doctor            # installation, adapters, and project health
openplanr doctor --fix      # preview and repair owned installation drift
openplanr sync              # validate and repair cross-references between artifacts
openplanr upgrade status    # compare the installed CLI and plugin with the published set
```

`openplanr runtime update codex` refreshes only that agent and keeps its saved scope
and discovery mode. Repairs preserve user edits, other agents, native profiles
and retained runs. Cursor integration requires a valid project; user scope is
not a supported recovery alternative.

When a skill misbehaves, start with `openplanr doctor --json` and the
[troubleshooting guide](../packages/cli/docs/TROUBLESHOOTING.md).

## Undo

Remove marketplace plugins and individual skills through the installer you used.
For CLI-managed integrations:

```bash
openplanr runtime rollback           # restore the last pre-setup state for every managed adapter
openplanr runtime remove claude      # remove one host's OpenPlanr-owned files (hashes must still match)
npm uninstall -g openplanr
```

Removal deletes only files OpenPlanr wrote and still recognizes; modified or unknown
files are reported and left in place. Delete `.planr/` from a project by hand if you
no longer want the planning files.

## Next

- [Skill catalog](generated/skills.md): every skill, its triggers, and what it defers.
- [CLI reference](../packages/cli/docs/CLI.md): every command and option.
- [Diagrams](diagrams/authoring.md): render and verify diagrams offline.
- [Host matrix](skills/host-matrix.md): what differs between Claude Code, Codex, and Cursor.

Tried it on a real feature? Tell us what you'd change in the [beta discussion](https://github.com/openplanr/OpenPlanr/discussions/324).
