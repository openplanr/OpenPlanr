# Contributing to OpenPlanr

Open an issue through the [issue forms](https://github.com/openplanr/OpenPlanr/issues/new/choose)
or start a [discussion](https://github.com/openplanr/OpenPlanr/discussions) to describe
the problem and the behavior you propose before a large change. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md). Participation follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

OpenPlanr requires Node.js 20 or later. CI verifies Node.js 20, 22, and 24; contributors
use Node.js 24 (`.nvmrc`). Run these commands from the repository root:

```bash
npm ci
./node_modules/.bin/playwright install chromium
npm run generate
npm run build
npm run test:focused
```

There is one root lockfile. Do not install independent dependency trees inside
workspace packages or introduce sibling-checkout requirements.

Generation creates ignored local host distributions as well as checked-in
projections. A fresh clone must run `npm run generate` before
`npm run check:generated`; check mode validates existing output and does not
bootstrap missing distributions. Build before running packed-package verification
so the CLI's compiled exports exist.

## Make a focused change

1. Read the related code, tests, and the [architecture guide](docs/architecture/README.md).
   [Working from a checkout](docs/contributing/dogfooding.md) explains how to install
   your build into your own coding agent.
2. Change the canonical owner first: Protocol contracts, then domain code, then
   downstream CLI, host adapters, and documentation as needed.
3. Add regression coverage for changed behavior and update user-facing guidance.
4. Regenerate derived files and include changed tracked manifests in the same PR.
5. Describe the concrete behavior change, validation results, and limitations.

Use product-oriented branch names such as `fix/diagram-labels` or
`feat/review-navigation`, Conventional Commit subjects, and a changeset
(`npm run changeset`) for every change that alters a published package. Keep private
planning, credentials, local runtime state, and customer examples out of commits;
`npm run check:docs` rejects internal identifiers, retired commands, and contact details
in public documentation.

By submitting a contribution, you agree to license it under the license that
applies to the files you modify, and you represent that you have the right to do
so. This does not transfer your copyright. If a contribution introduces a new
license or changes a licensing boundary, discuss it with the maintainers before
opening the pull request and include the required license and notice files.

## Keep maintenance work tied to behavior

For a new artifact, dependency, check, or abstraction, name its current consumer,
canonical owner, and the concrete failure it prevents. A manual developer command
is a consumer even when CI does not call it. Remove obsolete material only after
tracing imports, generators, package contents, tests, and documented entry points;
keep evidence of retired migrations in Git history.

Add checks for observable requirements and failures, and reuse existing checks
before adding another inventory or gate. See the
[repository maintenance decision](docs/architecture/repository-maintenance.md)
for canonical ownership and build-time distribution generation.

## Generated sources

Edit canonical skill content under `skills/`, role guidance under `agents/`, and
domain sources under their owning workspace. Do not hand-edit generated adapters
or compatibility projections. Run:

```bash
npm run generate
npm run check:generated
npm run check:boundaries
```

When changing CLI registration, refresh its command catalog after building:

```bash
npm run build --workspace=openplanr
npm run generate:command-catalog --workspace=openplanr
npm run generate
```

## Verification

Run focused tests while working. Before submitting a change that affects package
or runtime behavior, run the relevant full checks:

```bash
npm run generate
npm run lint
npm run build
npm test
npm run verify
```

In a clean verification checkout, run `git diff --exit-code HEAD --` after
generation and after the build. Ignored local distributions may be created, but
tracked files must reproduce without changes. During development, review and
commit intentional source and tracked manifest changes before applying this gate.

`npm run verify` checks generated assets, boundaries, public documentation, the committed
documentation diagram sets, focused tests, and isolated packed-package behavior. It does not replace the full
workspace test command or manual/browser checks for UI changes. The CI workflows
under `.github/workflows/` define their additional runtime and browser coverage.

Record failed or unavailable checks honestly. Do not update fixtures simply to
hide a regression, or make an unsupported compatibility claim from one local run.

Before pushing a branch that touches several packages, `npm run verify:ci` runs the
same commands as the Workspace CI jobs, in order, on your Node version (`--only` and
`--skip` take job ids from `--list`). It is slower than `npm run verify` and catches
the suites `verify` does not run: workspace lint, the full CLI test tree, the heavy and
Operate suites, and the package tests of every workspace.

## Review and release

Maintainers review changes for correctness, compatibility, usability, and clear
ownership. Merging to `main` publishes nothing by itself: pending changesets open a
version PR, and merging that PR is the release decision. See
[Releasing](docs/RELEASING.md).
