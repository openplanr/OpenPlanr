# Changesets

OpenPlanr uses independent package versions. Public targets are `openplanr`,
`planr-pipeline`, and `@openplanr/protocol`. Other workspaces are versioned for
integration but cannot be published to npm. All local product source remains MIT.
Package versions are separate from schema/document versions.

Write one changeset for each independently understandable package-facing change.
Several changesets can ship from one branch or consolidation commit. Release notes
must explain behavior and migration steps, not just file moves. Breaking supported
commands or imports requires a breaking-change note and appropriate version.

Run `npm run changeset -- status` to inspect pending changes and
`npm run version-packages` in a disposable checkout to rehearse versioning.
Changesets consumes the notes, updates versions and generates package changelogs.
Refresh the root lockfile and generated projections, then rerun release checks.
See [Releasing](../docs/RELEASING.md). Publication is a separate authorized action.
