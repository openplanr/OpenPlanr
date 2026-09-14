# Operate Continuation Plan

This is the executable handoff after the current local, unreleased branch. It
preserves the executive-board product mechanism, finishes the unified
dashboard, and leaves release/install as a separate user decision.

## Read before changing code

1. [README.md](README.md)
2. [AGENTIC_EXECUTIVE_BOARD.md](AGENTIC_EXECUTIVE_BOARD.md)
3. [DASHBOARD.md](DASHBOARD.md)
4. [Operate 2.0 constitution](../../.planr/products/operate-2.0/README.md), in
   its documented precedence order
5. [Operate Runtime Protocol 2.0](../protocol/operate-runtime-v2.md)
6. [SPEC-020](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/SPEC-020-openplanr-unified-dashboard-redesign.md)
   and [SPEC-022](../../.planr/specs/SPEC-022-operate-executive-board-and-generated-role-skills/SPEC-022-operate-executive-board-and-generated-role-skills.md),
   including every relevant story, task, and QA file

An ignored `.planr/local/operate-current-state.md` may provide laptop-local
orientation. Verify it against both working trees; it has no product or release
authority.

Do not treat the globally installed Operate skill as current design authority.
Do not start a release, install, publish, push, deploy, or marketplace update
from this plan.

## Deferred decision queue

The following owner decisions are intentionally outside SPEC-020 closure. Do
not implement or collapse them into dashboard cleanup. Study them in separate,
explicitly authorized work after the current developer-experience and skill
harnessing pass:

1. the generic `operate-role` executor;
2. the repository merge / rename decision;
3. the two future product tracks.

Recording these items here prevents them from being mistaken for forgotten
implementation work while preserving a clean decision boundary.

## Workstream 1: stabilize the seven-seat contract

Goal: preserve the implemented domain-owned role identities while keeping the
kernel role algebra small.

The current unpublished candidate already separates `roleKind` (`advisor`,
`challenger`, `chair`) from stable domain `roleId` and registers the five
business advisors, Challenger, and Chair. Continue from the reopened SPEC-022
task and QA truth rather than implementing that split a second time.

1. Retain exact role ID, role version, mandate appendix, analysis rubric, and
   output-contract binding at every schema and compiler boundary.
2. Keep the business catalog at five advisor seats; do not infer CFO,
   product-owner, or software-engineering seats from prose or labels.
3. Correct any fresh review finding in the contract owner first, then regenerate
   declarations, catalog inventory, fixtures, and adapters once.
4. Prove uniqueness, business/software isolation, rejection of label-based or
   foreign substitution, and exact accepted-output ownership.
5. Because this contract remains unpublished, correct its candidate bytes
   before a first release without rewriting a published historical version.

Likely owner paths:

- `schemas/v2.0.0/operate-domain-registration.schema.json`
- `registry/operate-v2-contracts.json`
- `lib/operate/contracts/compiler.mjs`
- `lib/operate/extensions-v2.mjs`
- matching declarations, generators, fixtures, and contract tests

## Workstream 2: stabilize routing, scheduling, and replay

Goal: preserve the implemented five-advisor fan-out, Challenger dependency, and
Chair dependency under deterministic replay.

1. Reverify that the router emits five independently bound advisor Assignments
   for a full business cycle and typed absence for every deliberately omitted
   lens in a scoped cycle.
2. Keep Assignment identity, mandate version, Snapshot/Delta binding, expected
   output contract, and accepted Artifact attribution exact per role.
3. Keep scheduler gates role-kind-aware: Challenger waits for all selected
   advisor terminals, and Chair waits for the terminal challenge dependency.
4. Preserve gaps and abandoned work as typed state; never reconstruct an
   unavailable Artifact from chat, hidden reasoning, or a peer report.
5. Retain exact replay/idempotency, divergent retry refusal, deterministic
   release order, authorization checks, and no duplicate Assignment release.

Likely owner paths:

- `lib/operate/intelligence-router-v2.mjs`
- `lib/operate/scheduler-v2.mjs`
- `lib/operate/intelligence-ledger-v2.mjs`
- `lib/operate/experience-projection-v2.mjs`
- `lib/operate/planning-bridge-v2.mjs`
- matching declarations and tests

## Workstream 3: verify generated runtime adapters

Goal: Codex and other runtimes execute compiler-issued Assignments without
owning the executive-board policy.

The current candidate generates the seven role executors from the canonical
catalog. Stabilization must keep that single-source relationship intact.

1. Keep `skills/planr-operate/SKILL.md` as the only cycle starter and generated
   role skills as Assignment executors that refuse unissued work.
2. Give an executor only the issued role label, stable role ID, mandate,
   analysis rubric, input refs, capability ceiling, and output contract.
3. Do not restore the old monolithic installed skill or copy its missing
   companion-file assumptions.
4. Regenerate Codex/Cursor assets and parity fixtures from the catalog; do not
   hand-tune one adapter after generation.
5. Prove no vendor-specific model selection, private paths, hidden prompts, or
   sibling-checkout imports enter generated assets.

## Workstream 4: locally completed unified dashboard candidate

The current unpublished OpenPlanr candidate now has one production composition
for Planning and Operate. It consumes owner-issued bootstrap query roots and
bound Planning, Today, Cycles/Cycle, executive-board, Inbox, Actions/Action
detail, Recovery, and audit reads. The permanent package-owned legacy browser
client has been removed.

SPEC-020 is locally complete. Preserve its current frontmatter and QA evidence:

1. The 2026-08-20 independent review passed with no P0, P1, or P2 findings. Do
   not substitute older task passes or screenshots for that exact evidence.
2. Correct owner contract/schema/selector defects in planr-pipeline before
   changing OpenPlanr parsers, runtime composition, models, or presentation.
3. Preserve exact bootstrap root and project binding, single read/SSE custody,
   abort/cleanup behavior, and whole-surface refusal for stale or foreign data.
4. Preserve governed Action/Inbox boundaries: the browser may display an exact
   runtime-issued command and confirmation, but never create authority or
   infer mutable state.
5. Re-run strict typing, focused integration, production build, dual-tarball
   install custody, and the production-App browser lane with reviewed native
   visual baselines after any relevant correction.
6. T-028 is done for the automated harness and retained evidence protocol.
   VoiceOver, NVDA, and physical-device journeys were not performed or claimed;
   the owner accepted that limitation as non-blocking for local closure. Axe,
   keyboard/focus, responsive targets, effective 200% reflow, forced colors,
   reduced motion, hostile identity, and Playwright golden comparisons remain
   automation, not substitutes for future human checks.

Executive seats must continue to come from the owner-issued verified board
surface. React labels are presentation only; the UI must not infer role
selection, completion, or authority from title text.

## Workstream 5: verification matrix

Each coherent implementation batch must run focused gates first, then:

- schema generation/check and Operate contract compilation;
- runtime/router/scheduler/ledger conformance;
- business and software end-to-end cycles;
- source package, tar inventory, extract, clean offline install, and public
  export checks under exact Node 20;
- generated-adapter parity and cross-runtime asset scans;
- OpenPlanr strict type checks, focused integrations, full build, and relevant
  full suites;
- browser purity, whole-surface refusal, privacy, replay/restart, SSE, cleanup,
  focus, accessibility, responsive/reflow, preference-state, and Playwright
  native-golden gates;
- any future manual VoiceOver, NVDA, and physical-device evidence, recorded
  separately from automated accessibility coverage and never inferred from it;
- Preserve/hash checks defined by the active task.

QA must report reproducible product or contract findings. Hash custody supports
independence; it is not a substitute for product risk, and repeated rehashing
must stop when candidate bytes and Preserve roots are unchanged.

## Workstream 6: separate release gate

Only after the implementation and independent QA are complete, ask the user for
one explicit release decision. That later release task may:

- choose and apply package versions;
- update VERSION/CHANGELOG/release notes and compatibility metadata;
- build final tarballs and reinstall the released package/skill locally;
- publish, push, tag, deploy, or update marketplaces only when separately
  authorized.

Until then, the branch and its local package builds are development evidence.
The globally installed release remains the previous release and must not be
presented as this branch.

## Handoff completion checklist

- [x] The receiving agent can state the source precedence without guessing.
- [x] The receiving agent can distinguish current code, target design, and
      historical installed skill behavior.
- [x] The executive board is implemented as five business advisor role IDs,
      Challenger, and Chair without business titles in the kernel.
- [x] The dashboard shows only owner-issued verified board and surface data.
- [x] Every pending or reopened SPEC-020 and SPEC-022 task is either completed
      with current independent evidence or remains honestly pending.
- [x] Manual VoiceOver, NVDA, and physical-device journeys remain explicitly
      unclaimed; the retained checklist and automated evidence are separate.
- [x] No release/install/push/deploy occurred without a separate user decision.
