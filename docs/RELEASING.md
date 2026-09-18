# Releasing OpenPlanr

OpenPlanr uses independent package versions for `openplanr`, `planr-pipeline` and
`@openplanr/protocol`. All other workspaces are npm-private MIT source. Package
versions do not rename or reset document/schema versions. A source consolidation,
a package release and a hosted deployment are separate actions.

## Prepare and rehearse

Start from the exact reviewed commit on a short-lived branch. Review compatibility,
licenses, dependency changes, source boundaries and pending Changesets. Intentional
removal of supported CLI behavior requires a major CLI release with replacement
instructions. Pre-1 pipeline changes follow its documented compatibility policy.

```bash
npm ci
npm audit --omit=dev --audit-level=high
./node_modules/.bin/playwright install chromium
npm run generate
npm run build
npm run lint
npm test
npm run verify
npm run changeset -- status
```

Use Node 24 for the full suite; also run clean installation, generation/build,
focused/conformance and packed-package checks on supported Node 20 and 22. Each
clean job materializes generated ignored host distributions and compiled CLI
exports before verification. Check generated tracked outputs against the commit.

In a disposable checkout, run the version operation before changing the actual
release branch. Create a local rehearsal commit before testing: packed and
recovery tests clone `HEAD`, so their inputs must include the versioned files.

```bash
npm run version-packages
npm install --package-lock-only --ignore-scripts
npm run generate
npm run build
git add --all
git commit -m "chore: rehearse package releases"
npm run lint
npm test
npm run verify
```

Changesets consumes pending files, updates package and dependency versions and
writes readable changelogs together. Review all resulting notes, versions and
lockfile changes. Do not freeze checks to historical version strings or edit old
schema versions merely to match a package bump. Keep the rehearsal commit in the
disposable checkout. Commit the reviewed release changes on the actual release
branch only after the rehearsal passes. Several feature Changesets in one consolidation
commit are normal.

## Public repository and publication gates

Introduce the monorepo through a normal PR descended from current public `main`.
Preserve existing tags, releases and attribution. Keep custody archives and private
integration branches out of the push. Use normal short-lived branches and explicit review. Internal migration
checklists, ADRs and acceptance receipts live in ignored `.planr/` state.

The prepared `publish-packages.yml` workflow is manual, restricted to this public
repository's `main`, and disabled until `NPM_PUBLISH_ENABLED` is explicitly enabled.
Configure a protected `npm-release` environment with required reviewers and a
`main` branch policy. Configure each npm trusted publisher for organization
`openplanr`, repository `OpenPlanr`, workflow `publish-packages.yml`, environment
`npm-release`. These are provider settings, not automatically created by this
source change. Verify ownership/initial publication eligibility of the Protocol
scope before authorizing its first release.

Trusted publishing needs npm ≥11.5.1 and Node ≥22.14.0. The workflow uses Node 24,
checks the npm minimum and requests OIDC only in its final protected publishing
job. Contributor CI has read-only repository permissions and no private-service,
production or publication credentials. See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

Each dispatch names one package, exact version and distribution tag. Verify first,
then publish the verified archive with provenance and lifecycle scripts disabled.
The publication workflow requires the successful `Workspace CI` push run for the
exact `main` commit being released, then independently installs, audits, rebuilds,
checks for tracked drift and packs that package. It does not repeat the complete
monorepo test matrix for every package; the exact-commit CI run is the reusable
test and packed-package evidence. Wait for that run to finish before dispatching.
Publish Protocol and pipeline before a CLI requiring those registry versions.
Never silently replace an existing version. Use an explicitly approved prerelease
distribution tag for limited testing before promoting `latest`. Tagging, dist-tag
promotion, branch pushing, PR creation, merging and deployment remain separate
reviewed actions. Preserve historical `v*` tags; new package tags are qualified by
package name so independent releases cannot collide.

## Release train

Publication is automated from `main`; the only hand-turned steps are merging the
version PR and approving the `npm-release` environment once per release.

1. **Version PR.** `version-pr.yml` runs on every push to `main`. When changesets are
   pending it opens or refreshes `chore(release): version packages` (branch
   `changeset-release/main`) with `npm run version-packages:ci`: `changeset version`,
   a lockfile refresh on Linux, and `npm run generate` so the Protocol projections,
   plugin manifests and preservation catalog are inside the PR. The PR is opened by the
   release GitHub App, so Workspace CI runs on it. Merging it is the release decision.
2. **Publish.** `publish-packages.yml` runs after every green Workspace CI push run on
   `main`. Its `plan` job lists the public package versions that commit declares but npm
   does not have (`scripts/release/plan-release.mjs`); with nothing pending it ends
   there. Otherwise `verify` rebuilds the exact commit, checks for tracked drift and packs
   every pending package with its publication proof; `publish` waits for the one
   `npm-release` approval, then publishes in dependency order (Protocol → pipeline →
   CLI) through npm trusted publishing, refusing any existing version with different
   bytes and waiting for each publication to be visible before its dependents
   (`scripts/release/publish-archives.mjs`). The same job creates the package-qualified
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

Settings the train depends on: the `npm-release` environment with its required
reviewer; the npm trusted publishers for `publish-packages.yml` and that environment;
repository variable `NPM_PUBLISH_ENABLED=true`; a GitHub App installed on
`openplanr/OpenPlanr` and `openplanr/marketplace` with Contents and Pull requests
write access, recorded as variable `RELEASE_APP_ID` and secret
`RELEASE_APP_PRIVATE_KEY`; "Allow auto-merge" and the `main` merge queue. Without the
App variable the version PR and the provenance/marketplace jobs skip themselves; the
publish and tag steps still run.

Verification per release stays what it was: registry integrity matches the packed
archive, the SLSA attestation names the released commit and workflow run, and the
archive is the one packed from that commit in the same run. Re-verify by hand only when
the run itself is in doubt (`npm audit signatures` in a clean install, a rebuild from the
tagged commit).

## Hosted promotion and rollback

Keep the private web's digest-verified vendors until replacement packages exist in
the registry and pass the private consumer suite. Update exact pins in a private-web
PR; record public package versions/digests, web commit, and each deployed target's
version together. Test candidate and currently deployed combinations, encrypted
shares, company permissions, guest revocation, reviews, conflicts and recovery.

Retain independently deployable website/share/company/operator targets and prior
versions. Any storage migration must be backward compatible with the retained
rollback code; a source rollback alone cannot reverse incompatible stored data.
Re-run the ACME workflow in isolated staging before promotion. Public source and
package gates do not imply enterprise general availability or operational SLAs.

Versioning behavior follows [Changesets](https://changesets.dev/guide/getting-started).
