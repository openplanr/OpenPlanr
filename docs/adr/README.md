# Architecture decisions

These records explain the repository's architecture decisions and link the scripts that
enforce them. Each uses the sections of the ADR template in
`packages/cli/src/templates/adrs/adr-general.md.hbs`; a new record takes the next number.

- [001: Project the domain workspaces into planr-pipeline](001-projection-model.md): operate, artifact and design ship as digest-checked copies inside `planr-pipeline`.
- [002: Version public APIs in the export subpath](002-version-in-subpath.md): `planr-pipeline/operate/runtime-v2` carries the version; identifiers do not.
- [003: Limit composition fan-in and workspace edges](003-composition-fan-in-limits.md): import caps, facade-only composition roots, and an allowlist of workspace imports.
