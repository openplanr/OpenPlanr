# Skills and operational runtime

OpenPlanr keeps reasoning in the active host agent. A skill's `SKILL.md` owns its
activation description and human result guidance. The source registry owns
membership, versions and compatibility; generated descriptions in that registry,
cards and documentation must match frontmatter. Display branding is OpenPlanr;
`planr` remains the plugin identity and `planr-*` remains the canonical skill ID.
Host namespaces and existing CLI aliases remain supported.

Human summaries state the observed outcome, useful linked deliverables, actual
checks and material uncertainty. Large inventories belong behind a durable index.
Existing machine reports remain unchanged. Native-agent claims and independently
checked results must be distinguished. Summary wording is not a validation gate.

Deterministic helpers have canonical owners. CLI copies of Operate validators
are generated from the skill runtime and checked against their owners before
publication. The pipeline remains an independently versioned npm package and
consumer of the unified plugin; it does not ship another plugin identity.

Runtime locks retain their adapter compatibility `protocolVersion`. New CLI and
pipeline consumers explicitly validate the additive v1.18.0 lock contract, which
allows recorded discovery modes. Legacy locks without modes remain readable.
Frozen schemas are not rewritten to describe new fields.

## Distribution boundaries

Suite packages will share operational runtime resources. Individual skill
archives must remain self-contained and usable without an installed CLI. The
shared layout must not make individual archives depend on sibling skill folders.
Installed resources must resolve offline from exact owned package bytes.

Direct integrations will install thin host entrypoints with exact locators into
an immutable runtime closure seeded during setup. Native plugins retain their
runtime inside the plugin package. Setup, upgrades and doctor repair use the same
ownership transaction, preserving modified or unknown files and retained runs.
These layout changes are delivered after the canonical contract batch.
