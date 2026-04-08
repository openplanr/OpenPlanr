# Changesets

This folder is managed by [@changesets/cli](https://github.com/changesets/changesets).

When submitting a PR, add a changeset describing your changes:

```bash
npx changeset
```

This creates a markdown file in `.changeset/` that describes what changed and whether it's a `patch`, `minor`, or `major` bump. The file is committed with your PR.

When changesets are merged to `main`, the Release GitHub Action opens a "Version Packages" PR that bumps the version and updates CHANGELOG.md. Merging that PR publishes to npm.
