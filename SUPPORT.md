# Support

## Ask a question

Use [GitHub Discussions](https://github.com/openplanr/OpenPlanr/discussions): **Q&A** for
setup and usage questions, **Ideas** for proposals, **Show and tell** for what you built.
Search first; many setup questions are answered in the
[getting started guide](docs/getting-started.md) and the
[troubleshooting guide](packages/cli/docs/TROUBLESHOOTING.md).

## Report a bug

Open an issue through the [issue forms](https://github.com/openplanr/OpenPlanr/issues/new/choose).
Include:

```bash
planr --version
planr doctor --json
```

plus the host (Claude Code, Codex, or Cursor) and its version, the scope you installed
with, the exact command or skill invocation, what you expected, and what happened.
Doctor output redacts secrets; check it anyway before pasting.

## A skill misbehaves

Use the **Skill behavior** form. Say which skill, what you asked, what it produced, and
which files under `.planr/` it touched. Rerun `planr setup` and restart the host first;
a same-version plugin that carries old content is replaced by setup.

## Security

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Commercial and hosted workspaces

Questions about company workspaces, pilots, or commercial terms: see
[COMMERCIAL.md](COMMERCIAL.md) and contact the maintainer through
[AsemDevs on GitHub](https://github.com/AsemDevs).

## What to expect

Support is best-effort from the maintainers and community. There is no response-time
commitment for the open-source project. Bugs with a reproduction and doctor output are
triaged first.
