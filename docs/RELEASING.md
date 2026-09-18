# Releasing OpenPlanr

`openplanr`, `planr-pipeline`, and `@openplanr/protocol` are versioned independently
with [Changesets](https://changesets.dev/guide/getting-started); every other workspace
is private MIT source. Package versions never rename or reset schema and document
versions. Published versions are immutable: a correction is a new version.

## Before a change reaches main

Every change to a published package carries a changeset. Removing supported CLI
behavior requires a major CLI release with replacement instructions; the pipeline
follows its documented pre-1.0 compatibility policy. Run the full gates on the branch:

```bash
npm ci
npm audit --omit=dev --audit-level=high
./node_modules/.bin/playwright install chromium
npm run generate && git diff --exit-code HEAD --
npm run build && git diff --exit-code HEAD --
npm run lint
npm test
npm run verify
npm run changeset -- status
```

OpenPlanr requires Node.js 20 or later. CI verifies Node.js 20, 22, and 24; contributors
use Node.js 24 (`.nvmrc`). `release-proof.yml` (manual) repeats the immutable package
proof on all three lines. Do not freeze checks to historical version strings or edit
old schema versions to match a package bump.

## Publication gates

`publish-packages.yml` runs only from this repository's `main`, requires the green
Workspace CI run for the exact commit, and publishes through npm trusted publishing
(npm 11.5.1 or later, Node 22.14 or later) with provenance. Each pending package is
independently installed, audited, rebuilt, checked for tracked drift, and packed; the
packed archive is the one published. Protocol publishes before the pipeline, and the
pipeline before a CLI that requires those registry versions. Contributor CI has
read-only permissions and no publication credentials.

Settings the train depends on: the protected `npm-release` environment with its
required reviewer, npm trusted publishers for organization `openplanr`, repository
`OpenPlanr`, workflow `publish-packages.yml`, environment `npm-release`; repository
variable `NPM_PUBLISH_ENABLED=true`; and the release GitHub App (variable
`RELEASE_APP_ID`, secret `RELEASE_APP_PRIVATE_KEY`) installed on `openplanr/OpenPlanr`
and `openplanr/marketplace` with Contents and Pull requests write access, together with
"Allow auto-merge" and the `main` merge queue. Without the App variable the version PR
and the provenance and marketplace jobs skip themselves; publish and tag steps still run.

## Release train

Publication is automated from `main`; the only hand-turned steps are merging the
version PR and approving the `npm-release` environment once per release.

1. **Version PR.** `version-pr.yml` runs on every push to `main`. When changesets are
   pending it opens or refreshes `chore(release): version packages` (branch
   `changeset-release/main`) with `npm run version-packages:ci`: `changeset version`,
   `scripts/release-train/sync-lockfile.mjs` (which copies the new workspace versions and
   internal ranges into `package-lock.json` without re-resolving third-party packages, so
   `npm ci` still accepts it on every supported Node line), and `npm run generate` so the
   Protocol projections, plugin manifests, and preservation catalog are inside the PR. The
   PR is opened by the release GitHub App, so Workspace CI runs on it. Merging it is the release decision.
2. **Publish.** `publish-packages.yml` runs after every green Workspace CI push run on
   `main`. Its `plan` job lists the public package versions that commit declares but npm
   does not have (`scripts/release-train/plan-release.mjs`); with nothing pending it ends
   there. Otherwise `verify` rebuilds the exact commit, checks for tracked drift and packs
   every pending package with its publication proof; `publish` waits for the one
   `npm-release` approval, then publishes in dependency order (Protocol → pipeline →
   CLI) through npm trusted publishing, refusing any existing version with different
   bytes and waiting for each publication to be visible before its dependents
   (`scripts/release-train/publish-archives.mjs`). The same job creates the package-qualified
   annotated tags and GitHub releases (changelog section plus the publication evidence;
   only the CLI release is marked Latest).
3. **Provenance and marketplace.** `provenance` appends the rows to
   `docs/PROVENANCE.md` and opens an auto-merging docs PR through the merge queue.
   `marketplace` projects the generated Claude plugin into `openplanr/marketplace`
   (`plugins/planr/`, `.claude-plugin/marketplace.json`, the README plugin table) and
   opens a PR there, or pushes to its `main` when the repository variable
   `MARKETPLACE_DIRECT_PUSH` is `true`.
4. **Fallback.** `workflow_dispatch` on `publish-packages.yml` publishes all pending
   packages or one named package and version, with the same gates.

## After publication

Every release proves three things: the registry integrity matches the packed archive,
the SLSA attestation names the released commit and workflow run, and the archive is the
one packed from that commit in the same run. [PROVENANCE.md](PROVENANCE.md) records the
integrity, the attested build commit, and the payload digest of each published version.
Re-verify by hand only when a run is in doubt: `npm audit signatures` in a clean install,
or a rebuild from the tagged commit compared file by file. Historical `v*` tags are
preserved; new tags are package-qualified (`openplanr@2.2.1`) so independent releases
never collide.
