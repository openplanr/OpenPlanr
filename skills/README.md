# Canonical skill sources

Each OpenPlanr skill is one standard package under `skills/planr-{name}/`:

- `SKILL.md` is the workflow the host agent reads, with standard YAML frontmatter
  (`name`, `description`, `license`) and no tool pre-approvals;
- `openplanr.skill.json` declares the Protocol 1.8 package identity and every
  resource; undeclared files fail `npm run skill:lint`;
- `references/`, `scripts/`, `schemas/`, `templates/`, and `assets/` hold declared
  on-demand content; `agents/openai.yaml` carries Codex discovery metadata;
- `registry.json` lists every package with its triggers, contracts, and rule IDs,
  and `shared/` holds references that generation copies into several packages.

`scripts/skills/generate-v18.mjs` projects these sources into the ignored
`dist/plugins/` host packages and the tracked custody manifests. Never edit a
generated package; see [authoring](../docs/skills/authoring.md).
