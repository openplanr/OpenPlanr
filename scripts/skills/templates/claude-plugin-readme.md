# OpenPlanr for Claude Code

OpenPlanr closes the loop from intent to delivery. This plugin adds {{SKILL_COUNT}} skills and
{{ROLE_COUNT}} role agents that plan, design, build, review, and operate from durable context in
your repository. Specifications, user stories, tasks, and provenance live under `.planr/` in your
repository, reviewed and versioned like code.

Start with a specification:

```text
/planr:spec "Add passwordless sign-in for existing accounts"
```

Follow with `/planr:plan` to decompose the specification into stories and tasks, and
`/planr:ship` to implement one task. Plan and ship stay separate steps that you invoke.

## Install the CLI

Several skills call the deterministic `planr` CLI from the `openplanr` npm package, which ships
this plugin at the same version ({{PLUGIN_VERSION}}):

```bash
npm install -g openplanr
cd your-project
planr init
```

`planr setup --runtime claude --scope user` installs the same plugin from the marketplace bundled
with the CLI. Use one Claude Code channel per machine: this listing or `planr setup`, not both.
The same skills ship for Codex and Cursor through the `openplanr` package.

## What the plugin runs, sends, and fetches

- Skills run inside Claude Code. The plugin makes no model calls of its own and sends no
  telemetry. It has no hooks and no MCP servers.
- Skills call the `planr` CLI, bundled Node.js scripts, `git`, and the GitHub CLI (`gh`). They
  read and write files in your repository.
- The planning dashboard and local artifact reviews bind to loopback only.
- Only when you ask:
  - `sync` reconciles planning files with GitHub Issues through `gh`, or with Linear by sending
    the `PLANR_LINEAR_TOKEN` you set to `api.linear.app`. Writes need `--apply`.
  - `artifact` and the design skills share an encrypted review through `share.openplanr.dev`.
  - The CLI's optional design engine calls OpenAI only when you select its OpenAI provider and
    supply your own key.
  - Company workspaces, a pre-release hosted service, are used only when you configure one.

## Links

Source, issues, and discussions: [openplanr/OpenPlanr](https://github.com/openplanr/OpenPlanr).
Support: [SUPPORT.md](https://github.com/openplanr/OpenPlanr/blob/main/SUPPORT.md). Security:
[SECURITY.md](https://github.com/openplanr/OpenPlanr/blob/main/SECURITY.md). Privacy:
[openplanr.dev/privacy](https://openplanr.dev/privacy). MIT licensed.
