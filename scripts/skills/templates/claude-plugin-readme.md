# OpenPlanr for Claude Code

OpenPlanr closes the loop from intent to delivery. This plugin adds skills and specialist
agents that plan, design, build, review, and operate from durable context in
your repository. Specifications, user stories, tasks, and provenance live under `.planr/` in your
repository, reviewed and versioned like code.

Start with a specification:

```text
/planr:spec "Add passwordless sign-in for existing accounts"
```

Follow with `/planr:plan` to decompose the specification into stories and tasks, and
`/planr:ship` to implement one task. Plan and ship stay separate steps that you invoke.

## Install the CLI

Several skills call the deterministic `openplanr` CLI from the `openplanr` npm package, which ships
this plugin at the same version ({{PLUGIN_VERSION}}):

```bash
npm install -g openplanr
cd your-project
openplanr init
```

`openplanr setup --runtime claude --scope user` installs the same plugin from the marketplace bundled
with the CLI. Use one Claude Code channel per machine: this listing or `openplanr setup`, not both.
The same skills ship for Codex and Cursor through the `openplanr` package.

## What the plugin runs, sends, and fetches

- Skills run inside Claude Code. The plugin makes no model calls of its own and sends no
  telemetry. It has no hooks and no MCP servers.
- Skills call the `openplanr` CLI, bundled Node.js scripts, `git`, and the GitHub CLI (`gh`). They
  read and write files in your repository.
- The planning dashboard and local artifact reviews bind to loopback only.
- Bundled scripts are readable JavaScript. The design studio and review stage pages ship as
  readable source files; the local review server joins them after checking their recorded
  SHA-256 digests, without downloading or decoding code.
- OpenPlanr does not harvest unrelated credentials or send native agent credentials to OpenPlanr
  services. Coding-agent runs you request use that agent's own sign-in, described below.
- Sharing a design or diagram review creates owner access keys for that review and stores them,
  readable only by you, in `design-shares` or `diagram-shares` under `~/.planr` (or
  `PLANR_HOME`; earlier installs used `~/.openplanr`). Design reviews and handoffs read the
  record locally to show an existing share's link and status. The keys are sent only to the
  review address stored with them, without cookies or redirects, when you share, update, sync
  or export feedback, hand off, revoke, or recover that review. Recovery reads only the file
  path you give.
- While a local design studio page is visible, it syncs a review you shared before every 15
  seconds. This pulls published team feedback and finishes delivering previously queued
  review metadata; it never publishes local design changes.
- When you ask `delegate` to run another coding agent, that agent's own CLI runs with its normal
  sign-in, environment, model routing, and trusted hooks or plugins. Checking a profile that
  uses a local model server reads its model list from that server's address without
  credentials; a server that requires sign-in is reported as not checked.
- Only when you ask:
  - `sync` reconciles planning files with GitHub Issues through `gh` (writes need `--apply`),
    or with Linear through your Linear connector or the `openplanr linear` CLI, which keeps its own
    token.
  - `artifact` and the design skills share an encrypted review through `share.openplanr.dev`.
  - The CLI's optional design engine calls OpenAI only when you select its OpenAI provider and
    supply your own key.
  - Company workspaces, a pre-release hosted service, are used only when you configure one.

## Links

Source, issues, and discussions: [openplanr/OpenPlanr](https://github.com/openplanr/OpenPlanr).
Support: [SUPPORT.md](https://github.com/openplanr/OpenPlanr/blob/main/SUPPORT.md). Security:
[SECURITY.md](https://github.com/openplanr/OpenPlanr/blob/main/SECURITY.md). Privacy:
[openplanr.dev/privacy](https://openplanr.dev/privacy). MIT licensed.
