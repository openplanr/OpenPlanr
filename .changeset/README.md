# Changesets

OpenPlanr uses independent package versions. Public targets are `openplanr`,
`planr-pipeline`, and `@openplanr/protocol`. Other workspaces are versioned for
integration but cannot be published to npm. All local product source remains MIT.
Package versions are separate from schema/document versions.

Write one changeset for each independently understandable package-facing change. Choose
`patch` unless the change is a milestone the maintainers call out (`minor`) or breaks
supported behavior (`major`); the CLI takes its middle number from the release week.
Several changesets can ship from one branch or consolidation commit. Release notes
must explain behavior and migration steps, not just file moves. Breaking supported
commands or imports requires a breaking-change note and appropriate version.

Run `npm run changeset -- status` to inspect pending changes. Once a changeset lands
on `main`, the `Version packages` workflow opens or refreshes the version PR with
`npm run version-packages:ci` (versions, changelogs, lockfile, generated projections);
merging that PR is the release decision and `publish-packages.yml` publishes what it
declares behind the `npm-release` approval. Rehearse locally with
`npm run version-packages` in a disposable checkout. See
[Releasing](../docs/RELEASING.md).
