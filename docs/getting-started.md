# Getting started

This guide takes you from an empty terminal to your first specification written by
your coding agent. It takes about five minutes.

## Requirements

- a supported Node.js version (see [package metadata](../packages/cli/package.json)) and npm.
- One coding agent: Claude Code, Codex, or Cursor.
- A project under Git, or a directory you are willing to initialize.

## 1. Install the CLI

```bash
npm install -g openplanr
openplanr --version
```

The package installs two equivalent commands: `openplanr` and its short alias `opr`.

Alternatives:

```bash
npx openplanr@latest setup                       # no global install
curl -fsSL https://openplanr.dev/install.sh | sh  # macOS and Linux
irm https://openplanr.dev/install.ps1 | iex       # Windows PowerShell
```

The installers require Node.js and never install or upgrade it silently.

## 2. Install the skills into your coding agent

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

In Claude Code you can install the same plugin from the public OpenPlanr marketplace
instead of `openplanr setup --runtime claude`. Use one path, not both:

```text
/plugin marketplace add openplanr/marketplace
/plugin install planr@openplanr
```

Several skills call the `openplanr` CLI, so keep the CLI from step 1 installed.

Restart the coding agent after setup so it loads the new skills.

## 3. Initialize the project

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

## 4. Write the first specification

Open the project in your coding agent and invoke the spec skill:

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
| Implement | `ship` | One task implemented in the repository, verified, and recorded in `.planr/provenance.jsonl` |
| Check status | `status` or `openplanr status --md` | Every specification, story, and task by status |

Plan and ship are separate steps. The agent never chains them on its own.

## 5. Keep it healthy

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
