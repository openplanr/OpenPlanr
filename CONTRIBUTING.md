# Contributing to OpenPlanr

Open an issue through the [issue forms](https://github.com/openplanr/OpenPlanr/issues/new/choose)
or start a [discussion](https://github.com/openplanr/OpenPlanr/discussions) to describe
the problem and the behavior you propose before a large change. Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md). Participation follows the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Use Node.js 24 (`.nvmrc`) for development. Supported versions are declared in
[package metadata](package.json); CI verifies published packages on their supported Node.js 22 and 24 lines, and on Node.js 26
without blocking until it becomes LTS. Run these commands from the repository root:

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

The custody manifests digest every workspace `package.json`, so Dependabot npm updates
leave them stale. `dependabot-regenerate.yml` regenerates them on the pull request with a
read-only token and no secrets. `dependabot-regenerate-push.yml` then runs from `main`,
takes only the five custody manifests from that upload and pushes them as one commit.
Workflow runs started by that push wait for approval: approve them on the pull request
before reviewing it. If regeneration changes any other tracked path, the check fails and
the branch needs a hand regeneration.

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

Each workspace's `npm test` runs the same test commands its Workspace CI jobs run, so
`npm test --workspace=<package name>` from the root runs the tests CI runs for a change
inside that directory. The CLI's runs the suite CI splits into three shards, then the heavy,
Operate boundary and runtime integrity suites, each in its own process; those four run in
the nightly workflow, not on pull requests.

`npm run lint` is the formatting and lint gate: Biome runs from the root `biome.jsonc`
over every workspace, and CI fails on any error it reports. `npm run lint:fix` applies
its safe fixes and `npm run format` its formatting.

`npm ci` also installs two hooks; run it in every new checkout or worktree, since
`core.hooksPath` points at `.husky/_`, which only `npm ci` creates there. The pre-commit hook
(`.husky/pre-commit`, configured in `.lintstagedrc.mjs`) checks staged JavaScript,
TypeScript, JSON and CSS without rewriting them, and runs `check:comments` or
`check:docs` when a file they cover is staged. Apply any fixes with `npm run lint:fix`
before verification, review affected integrity pins, and stage the result. The pre-push hook
(`scripts/hooks/pre-push.mjs`) runs `check:generated`, `check:boundaries`, `check:docs`,
`check:comments`, `check:diagrams`, `lint` and `typecheck:declarations`, then `npm test` for
each changed workspace among Protocol, canvas, Operate, artifact, integrations and the
dashboard app. The CLI, pipeline, design and skill-runtime suites stay in CI. CI does not
install either hook. `HUSKY=0` or `--no-verify` skips them once.

In a clean verification checkout, run `git diff --exit-code HEAD --` after
generation and after the build. Ignored local distributions may be created, but
tracked files must reproduce without changes. During development, review and
commit intentional source and tracked manifest changes before applying this gate.

`npm run verify` checks generated assets, boundaries, public documentation, the committed
documentation diagram sets, focused tests, and isolated packed-package behavior. It does not replace the full
workspace test command or manual/browser checks for UI changes. The CI workflows
under `.github/workflows/` define their additional runtime and browser coverage. Pull
requests must pass two checks: `CI passed` from `ci.yml` and `Browser` from `browser.yml`,
which runs the canvas, dashboard and artifact Chromium lanes a change reaches. On a pull
request, `ci.yml` always runs the build and static checks and runs only the package test jobs
the changed files reach, as `scripts/ci/workspace-jobs.mjs` maps them; a path it does not map
runs every job, and a renamed file counts by its old path too. A version pull request that
changes only what `npm run version-packages:ci` writes runs only the build and static checks.
The merge queue runs every job and every Browser lane. Every pull
request job finishes within 12 minutes. `nightly.yml` runs the CLI integration suites and
coverage, the Node 22 contributor toolchain, packed proofs on Node 22, 24 and 26, the canvas
timing traces, artifact Chromium, Firefox and WebKit, the published-package first runs and
the dependency audit. It runs on the version pull request too. To run it on another branch,
use `gh workflow run nightly.yml --ref <branch>`.

Record failed or unavailable checks honestly. Do not update fixtures simply to
hide a regression, or make an unsupported compatibility claim from one local run.

Before pushing a branch that touches several packages, `npm run verify:ci` reads
`.github/workflows/ci.yml` and runs each job's commands, in order, on your Node version
(`--only` and `--skip` take the workflow's job ids, which `--list` prints). It runs the
build job's `npm run generate` and `npm run build` once in place of restoring its outputs,
runs every matrix entry in turn, and runs a job with a Node matrix once: its entry for your
Node, else its entry for the build job's Node. It runs every test job, whatever a pull
request would select. It does not replay `CI passed`, the job that fails unless every
selected Workspace CI job succeeded, the job selector, or the checks that read the pull
request or the runner, which it names instead. It is slower than `npm run verify` and
catches the suites `verify` does not run: workspace lint, the CLI test tree and the package
tests of every workspace. The CLI heavy and Operate suites run nightly; run them with
`npm test --workspace=openplanr`.

### Browser tests

Every browser test, the dashboard's Playwright configuration and the packed proofs launch
through `tests/support/browser-launcher.mjs`. It uses Playwright's bundled browser for the
selected engine (never the system Chrome) and starts Chromium with `--no-proxy-server`, so
loopback fixtures never wait on the operating system's proxy discovery. These variables
control it:

| Variable | Effect |
| --- | --- |
| `PLANR_BROWSER_TESTS=1` | Runs the opt-in Artifact and pipeline browser tests, which are skipped otherwise. The Design package's browser tests always run. |
| `PLANR_REQUIRE_BROWSER=1` | Makes the pipeline artifact browser tests fail instead of skip when `PLANR_BROWSER_TESTS` is unset; the browser certification workflow sets it. |
| `PLANR_BROWSER_ENGINE` | `chromium` (default), `firefox` or `webkit`. |
| `PLANR_BROWSER_EXECUTABLE` | Path to a browser binary (or wrapper script) to launch instead of Playwright's bundled browser for that engine. |
| `PLANR_BROWSER_CHANNEL` | A Chromium release channel such as `chrome`; ignored when an executable is set. |
| `OPENPLANR_PROOF_CHROMIUM_EXECUTABLE` | Chromium binary for the packed proofs and the diagram portability tests when `PLANR_BROWSER_EXECUTABLE` is unset. `npm run verify:packed` keeps a value you export and otherwise pins Playwright's bundled Chromium, because its isolated home cannot see Playwright's browser cache. |

Without a bundled browser (`./node_modules/.bin/playwright install chromium`) a launch fails
at once with the install command, rather than hanging.

## Review and release

Maintainers review changes for correctness, compatibility, usability, and clear
ownership. Merging to `main` publishes nothing by itself: pending changesets open a
version PR, and merging that PR is the release decision. See
[Releasing](docs/RELEASING.md).
