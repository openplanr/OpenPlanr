# Canvas release readiness checklist

Use this checklist to prepare a separately approved first release. Passing these
checks does not publish a package. Follow the [release process](../../RELEASING.md)
when the owner approves release preparation.

## Current state

`@openplanr/canvas` is unpublished, private, and version `0.0.0`. Artifact and
design consume it through exact workspace dependencies. Pipeline carries the core
and stylesheet as `lib/canvas` through the design projection in
`scripts/domains/project-domains.mjs`; it has no canvas runtime dependency.
The dashboard is an intended workspace consumer, but this revision has no canvas
import or dependency in `apps/dashboard`. Confirm its adoption before claiming
that all consumers use the engine; add its dependency and approved boundary edge
as part of that integration.

The package exposes the core, React bindings, testing helpers, and structural CSS.
Its [README](../../../packages/canvas/README.md) describes the built API and the
effective local and runner budgets. React remains an optional peer; the core has
no runtime dependencies.

## Gates before a first release

Run from the repository root with the root lockfile installed and Playwright's
bundled browsers available:

```bash
npm run generate
npm run build
npm run build -w @openplanr/canvas
npm test -w @openplanr/canvas
npm run test:packed -w @openplanr/canvas
npm run test:browser -w @openplanr/canvas -- --grep-invert '(bench-trace|budgets)\.spec\.ts'
npm run test:browser:nightly -w @openplanr/canvas
npm run lint
npm run check:docs
npm run check:boundaries
npm run verify
git diff --check
```

- [ ] Build and declaration checks pass from the same revision as the tarball.
- [ ] Unit tests include README parity against all built entry declarations;
  the package-shape test still confirms the private package during readiness work.
- [ ] The isolated packed consumer installs exact lockfile tool versions outside
  the workspace, builds, renders the 708-node fixture, pans and zooms without
  console or page errors. This opt-in check needs network access and Chromium.
- [ ] Functional Chromium and Firefox suites pass. The command above excludes
  timing suites using their file names, matching the browser workflow.
- [ ] Traced budgets pass nightly against main and on the release PR, using
  `.github/workflows/nightly.yml`. Ordinary PRs run functional browser coverage.
  Reproduce the Chromium runner budgets with:

  ```bash
  CI=true CANVAS_SECOND_DENSITY=1 npm run test:browser -w @openplanr/canvas -- bench-trace budgets
  ```

  Retain the Firefox canvas cache check and the artifact Chromium, Firefox and
  WebKit evidence from that workflow. The current canvas configuration has no
  WebKit project; do not claim cross-browser canvas traces from artifact runs.
  Locally, omit `CI=true` to enforce
  the stricter local limits. Runner remount timing and rAF intervals are reported
  only; the first-frame limit is 250 ms rather than the local 150 ms.
- [ ] `npm run verify` passes, including generated assets, declarations and strict
  packed workspace verification. Keep the pipeline projection self-contained
  while canvas is private. Regenerate custody metadata after package script
  changes: `ecosystem.json` records the canvas `package.json` digest even while
  the package remains private. This is generated output, not a publishing flip.
- [ ] Record command, exit code, browser/version, GPU renderer, budget set and
  revision with the release evidence. Resolve pending measurements explicitly;
  compositor dropped frames at fit are not measured by the shared evaluator.

## Proposed publishing flip (needs owner approval)

These are proposals, not changes made by readiness work. The scaffold commit
`fa940e7b` records the original registrations and publication custody tests.

- [ ] Make `packages/canvas/package.json` publishable only in an approved release
  preparation change. Keep `private: true` and `0.0.0` until then.
- [ ] Restore `packages/canvas` in `PUBLIC_PACKAGE_PATHS` in
  `scripts/lib/workspace-release-policy.mjs`. Workspace identity, build order,
  TypeScript compilation and boundaries are already registered.
- [ ] Restore the `@openplanr/canvas` target in `PUBLIC_TARGETS` in
  `scripts/release-train/lib/targets.mjs`, after protocol and before pipeline,
  with `path: 'packages/canvas'` and `tagLatestRelease: false`. Update the release
  plan and changeset-bump tests in `tests/release-train/` for that order.
- [ ] Restore the `@openplanr/canvas` dispatch option in
  `.github/workflows/publish-packages.yml`.
- [ ] Restore the canvas target and compiler-output custody block in
  `scripts/prepare-publication.mjs`: derive expected compiled bytes from tracked
  sources, verify those bytes, and retain their hashes through packing. Restore
  `tests/release-train/canvas-publication.test.mjs` to reject stale, extra ignored,
  and packing-time-mutated modules and declarations.
- [ ] Mark canvas public in `scripts/marketplace/generate-ecosystem.mjs` and
  `scripts/marketplace/openplanr-ecosystem.schema.json`, then regenerate the
  ecosystem outputs. Update the package-shape privacy assertion as part of that
  approved flip, not during readiness work.
- [ ] Add the first `minor` changeset for `@openplanr/canvas`, producing `0.1.0`.
  Name only shipped, verified behavior: camera and input, culling and overview,
  keyboard accessibility, React bindings, chrome, and shared testing helpers.
  Do not claim unimplemented consumer adoption or a release that has not happened.
- [ ] Review the version PR and retain its verification evidence before the
  existing release train and npm release approval proceed.

### Pipeline dependency decision

Should `planr-pipeline` take an exact `@openplanr/canvas` dependency once canvas is
public, or retain the projected core? Obtain an owner decision before changing
that boundary. An exact dependency requires coordinated work:

- Add the exact released canvas version to `packages/pipeline/package.json` and
  permit that dependency in `scripts/lib/workspace-release-policy.mjs`.
- Replace the projected canvas imports and remove the duplicate design-projection
  copy through its canonical generator.
- Remove canvas from `PROJECTED_PACKAGE_NAMES` in
  `scripts/verify-packed-workspace.mjs`, retaining the checks for other private
  projections and testing that raw imports resolve only through the public package.
- Update `scripts/verify-packed-workspace-strict.mjs` and its underlying packed
  proof so `npm run verify:packed:strict` installs the canvas tarball beside
  pipeline in isolation, with exact dependency/version and pan/zoom coverage.

## Rollback

Before publication, revert the approved publishing preparation change to restore
the private package and projection contract. After publication, consumers can pin
the last verified version; deprecate a bad release and publish a corrected
version through the release train rather than unpublishing it.
