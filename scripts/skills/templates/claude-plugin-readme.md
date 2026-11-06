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
  read and write files in your repository. The design skills run every local design operation
  through `openplanr design`; the plugin ships no design runtime.
- The planning dashboard and local artifact reviews bind to loopback only.
- Bundled scripts are readable JavaScript.
- Skills and bundled scripts store and read no GitHub, Linear or model-provider credentials and
  send no agent credentials to OpenPlanr services. Coding-agent runs you request use that
  agent's own sign-in, described below.
- Sharing a design or diagram review runs in the `openplanr` CLI, not in the plugin. The CLI
  creates the review's owner access keys, stores them readable only by you under `~/.planr` (or
  `PLANR_HOME`), and sends them only to the review address stored with them. The plugin's
  bundled scripts read no owner keys and contact no OpenPlanr host.
- Without the CLI, the design skills still write the design document, sources and
  specification, marked unverified, and tell you the command to install it. On Claude Code,
  the design skill can build on Claude's hosted design canvas instead.
- While a local design studio page for a shared design is visible, it asks the CLI to sync the
  review every 15 seconds. This pulls published team feedback and finishes delivering
  previously queued review metadata; it never publishes local design changes.
- When you ask `delegate` to run another coding agent, that agent's own CLI runs with its normal
  sign-in, environment, model routing, and trusted hooks or plugins. Checking a profile that
  uses a local model server reads its model list from that server's address without
  credentials; a server that requires sign-in is reported as not checked.
- Only when you ask:
  - `sync`, `sprint` and `status` reach GitHub and Linear through your coding agent's own
    GitHub or Linear connection, or through the GitHub CLI (`gh`) when it is signed in.
  - `artifact` and the design skills share an encrypted review through the `openplanr` CLI,
    which sends it to `share.openplanr.dev`.
  - Company workspaces, a pre-release hosted service, are used only when you configure one.

## Links

Source, issues, and discussions: [openplanr/OpenPlanr](https://github.com/openplanr/OpenPlanr).
Support: [SUPPORT.md](https://github.com/openplanr/OpenPlanr/blob/main/SUPPORT.md). Security:
[SECURITY.md](https://github.com/openplanr/OpenPlanr/blob/main/SECURITY.md). Privacy:
[openplanr.dev/privacy](https://openplanr.dev/privacy). MIT licensed.
