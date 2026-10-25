# Working in OpenPlanr

OpenPlanr is a workspace monorepo for the CLI, protocol, skills and runtime packages.
Read [CONTRIBUTING.md](CONTRIBUTING.md) for the complete contributor workflow and
[architecture](docs/architecture/README.md) for ownership boundaries.

## Setup

- Use Node 24 from `.nvmrc` and the root npm lockfile.
- From the root: `npm ci`, `npm run generate`, then `npm run build`.
- Browser checks need Playwright's browser: `./node_modules/.bin/playwright install chromium`.
- Do not install independent dependency trees inside workspace packages.
- Generation writes tracked projections and ignored host distributions; review its diff.

## Checks

- While iterating: `npm run test:focused` and `npm run lint`.
- Run a workspace's CI-aligned tests with `npm test --workspace=<package name>`;
  use the actual name from that workspace's package metadata.
- For package/runtime changes: generate, lint, build, `npm test`, then `npm run verify`.
- `verify` covers generated assets, boundaries, docs, focused tests and packed behavior;
  it does not replace full workspace tests or browser coverage.
- For cross-package CI parity, use `npm run verify:ci`; see CONTRIBUTING for its limits.
- UI changes need the relevant browser workflow and visual verification. Report
  missing browsers, skipped checks and unavailable services explicitly.

## Constraints

- Edit canonical skill sources under `skills/`, role sources under `agents/`,
  and domain code in its owning workspace. Do not hand-edit generated projections.
- Run `npm run check:generated` and `npm run check:boundaries` after generation.
- Read nested instructions before changing `packages/cli` or `packages/pipeline`.
- Keep private planning, credentials and machine-specific paths out of public files.
- Published-package behavior changes need a changeset; documentation must claim
  only verified behavior. Follow the existing release process, not an ad hoc publish.
- Hooks are a convenience, not evidence that the full verification passed.
- Task briefs define scope and reporting; they do not replace repository checks.
