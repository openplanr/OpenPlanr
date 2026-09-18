# Contributing to OpenPlanr

Use an issue or pull request in [openplanr/OpenPlanr](https://github.com/openplanr/OpenPlanr)
to explain the problem and proposed behavior. Report vulnerabilities privately as
specified in [SECURITY.md](SECURITY.md). Participation follows our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Use Node.js 24 for contributor work, Git, and npm. Runtime compatibility checks
also cover Node.js 20 and 22. Run these commands from the repository root:

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

1. Read the related code, tests, and public [architecture guide](docs/architecture/README.md). Local ADRs and planning records stay in ignored `.planr/` and are not required by contributor CI.
2. Change the canonical owner first: Protocol contracts, then domain code, then
   downstream CLI, host adapters, and documentation as needed.
3. Add regression coverage for changed behavior and update user-facing guidance.
4. Regenerate derived files and include the required projections in the same PR.
5. Describe the concrete behavior change, validation results, and limitations.

Use product-oriented branch names such as `fix/diagram-labels` or
`feat/review-navigation`, and concise commits describing the change. Keep private
planning, credentials, local runtime state, and customer examples out of commits.

By submitting a contribution, you agree to license it under the license that
applies to the files you modify, and you represent that you have the right to do
so. This does not transfer your copyright. If a contribution introduces a new
license or changes a licensing boundary, discuss it with the maintainers before
opening the pull request and include the required license and notice files.

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
commit intentional source and generated-output changes before applying this gate.

`npm run verify` checks generated assets, boundaries, preservation records,
focused tests, and isolated packed-package behavior. It does not replace the full
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
ownership. A merge or successful CI run does not itself authorize a deployment,
package publication, or repository-history cutover. See
[Releasing](docs/RELEASING.md) for the release process.
