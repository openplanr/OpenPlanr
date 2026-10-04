# Skill distribution boundaries

Skill instructions and operational code have different owners and lifetimes.
`SKILL.md` owns activation descriptions, reasoning and result guidance. Canonical
packages own deterministic validation, editing, transport and recovery behavior.
The generator projects these sources into each supported host's layout.

Native suites contain one shared runtime closure and small skill entrypoints.
Standalone skill archives include their complete required closure, so copying a
suite skill folder is not a supported way to build a standalone download. Both
formats resolve resources relative to their installed package and work offline.

Project and direct integrations contain discovery metadata and locators for an
exact content-verified package under the OpenPlanr home. Native plugin installs
keep that closure inside the plugin package. A locator identifies a version and
content digest; it never selects a global CLI or downloads a runtime when invoked.
Local locator paths are machine-specific and must be regenerated on another
machine. Shared project policy and compatibility locks remain portable.

Setup, update and doctor use the same preview and recovery transaction. They seed
and verify required resources before switching discovery, and retire only owned,
unchanged copies. Runtime resources are retained during rollback because another
project or a retained session can still reference them. Unknown or modified files
are reported for inspection rather than treated as disposable cache contents.

Generated projections use a per-checkout ownership ledger outside tracked
manifests. Pulls and branch switches therefore do not erase retirement evidence.
Removal rechecks ownership and exact bytes; unavailable historical proof preserves
the file. This guarantee covers the domain, suite and skill-release projections
using the ledger, rather than every unrelated generator in the repository.

Footprint reports are generated in `adapters/manifests/skill-footprint.json`.
Archive verification checks canonical closures, licenses, content inventories and
offline helper execution. Native discovery tests separately record supported
invocations, namespace limitations and collisions; a readable package is not proof
that a host's interactive picker ranks or dispatches it correctly.

Executable assets ship as complete, independently parseable JavaScript. Shared
source units retain canonical behavior, licenses and content digests. Legacy asset
readers remain available for older installations. Package validation checks the
exact archive for portable paths, supported file formats and bounded resource
sizes before publication.
