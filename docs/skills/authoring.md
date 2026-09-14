# Authoring OpenPlanr skills

OpenPlanr has one source of truth for each skill: a standard package under
`skills/planr-{name}/`. Host distributions are generated products, never places
to edit workflow prose.

## Package contract

Every canonical package contains:

```text
skills/planr-{name}/
  SKILL.md
  openplanr.skill.json
  references/          optional detail loaded on demand
  scripts/             optional deterministic helpers
  assets/              optional static resources
  schemas/             optional machine contracts
  templates/           optional output templates
  agents/
    openai.yaml         OpenAI discovery metadata
```

`SKILL.md` uses standard YAML frontmatter and gives the active host agent enough
direction to select the workflow, discover local context, produce its output,
handle recoverable failures, and find supporting resources. Keep it concise.
Move long schemas, examples, stack conventions, and role details into explicit
references and link them from the relevant workflow step.

`openplanr.skill.json` declares the Protocol 1.8 package identity and every
resource. Undeclared files are rejected. Executable permission is allowed only
for `script` resources, and scripts must be deterministic: they may inspect,
validate, render, store, or synchronize data, but never call a model provider or
make a product decision.

## Semantic boundary

Plan, Spec, Ship, Operate, Design, and review reasoning runs inside the active
Claude, Codex, or ChatGPT session. A semantic skill must not execute `planr
plan`, `planr spec decompose`, `planr-pipeline`, a provider SDK, or a second
model. Helpers are appropriate for deterministic work such as ID inspection,
schema validation, verification discovery, rendering, and sync.

The optional `planr` CLI remains the terminal surface for deterministic project
CRUD, setup, diagnostics, status, dashboard and artifact services, diagrams,
and GitHub/Linear integration. Skills must still work when it is absent.

## Development loop

```bash
npm run skill:lint -- skills/planr-{name}
npm run skill:preview -- skills/planr-{name}
npm run skill:generate
npm run skill:check
npm run skill:check:parity
npm run skill:check:purity
npm run skill:package
npm run skill:verify:release
```

Generated OpenAI, Claude, and Cursor packages live under `dist/plugins/` and are
ignored by Git. Local release archives live under `release/` and are also
ignored. Commit the canonical package and compact custody manifests only.

## Review checklist

- The description states when the skill should and should not be selected.
- The workflow reads repository context directly and uses native questions for
  decisions that materially change the result.
- Output structure is explicit and examples are concise.
- Every referenced file exists and every packaged resource is declared.
- Model reasoning stays in the active host agent.
- Deterministic helpers run without provider credentials or network unless the
  helper's declared purpose is an external integration.
- Generation, parity, purity, packaging, and focused tests pass.
