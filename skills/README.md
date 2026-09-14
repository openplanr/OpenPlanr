# Canonical skill sources

OpenPlanr skills are authored as a typed composed graph:

- `skill.json`, `contribution.json`, and the Protocol registries own identity,
  routing, contracts, versions, and host applicability;
- `SKILL.md.tmpl` and `modules/` own current workflow prose;
- `references/`, `scripts/`, and `assets/` contain only declared on-demand
  content; and
- `SKILL.md` is the frozen pre-composition migration baseline used only to
  report intentional compatibility changes.

The migration baseline is not packaged or installed. Current host-visible
entrypoints are generated under `adapters/` and the self-contained plugin from
the composed graph. Never edit a generated adapter or use a baseline as current
workflow authority.
