# Compatibility

The monorepo owns the public `openplanr`, `planr-pipeline` and
`@openplanr/protocol` packages. CLI and pipeline distributions retain
self-contained compatibility projections; generation and packed-consumer checks
detect drift. Package versions remain independent of schema/document versions.

[Source provenance](../PROVENANCE.md) retains attribution and original source
cutoffs. Executable preservation fixtures under `conformance/migration/` verify
legacy contract coverage. Recovery archives, ADRs, migration checklists and local
verification reports stay outside the public tree.

See [Architecture](../architecture/README.md) and [Releasing](../RELEASING.md) for
current ownership and contributor workflows. Private-web vendors remain pinned
and digest-verified until equivalent registry packages pass consumer verification.
