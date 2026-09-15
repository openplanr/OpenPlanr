# Operate Dashboard Map

This page distinguishes the target dashboard, its owner contracts, and the
OpenPlanr browser product. It prevents a handoff agent from mistaking a
contract/model for a finished screen or local source for a released product.

## Authority layers

| Layer | Owner | Responsibility |
|---|---|---|
| Runtime and projection | `planr-pipeline` | Canonical state, owner-side selection, verified display envelopes, REST/SSE binding, privacy, and replay |
| Product UI | sibling `OpenPlanr` repository | React routes, presentation, focus/lifecycle, responsive behavior, and explicit user interaction |
| Product plan | [SPEC-020](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/SPEC-020-openplanr-unified-dashboard-redesign.md) | User stories, acceptance criteria, task dependencies, and completion status |
| Architecture constitution | [Operate 2.0 product workspace](../../.planr/products/operate-2.0/README.md) | Product direction, invariants, governance, domain model, and state machine |

The browser never becomes a second projection engine. It consumes a complete,
verified owner-issued display DTO and refuses the whole affected surface when
the binding or commitment is invalid.

## Implementation status

Use task frontmatter and the QA report under SPEC-020 for implementation
status. This durable map intentionally carries no branch name, commit hash,
installed-package version, task count, or completion claim. The top-level spec
describes the approved target and may lag individual task evidence.

The current unpublished source-checkout candidate mounts the production React
`App` through one runtime composition. It reads owner-issued bootstrap roots,
Planning graph/SSE, Operate Today/Cycles/Cycle, Actions/Action detail, Inbox,
Recovery, and audit surfaces through their exact bound endpoints. The real
browser lane loads that composition normally against signed owner fixtures and
checks ready routes, governed-dialog focus, axe, responsive/reflow states,
forced colors, reduced motion, hostile identity, and reviewed native PNG
baselines. Separate packed-consumer tests prove dashboard and pipeline custody.
This is development evidence, not a claim that the candidate is released.

## Bootstrap query-root seam

`dashboard-bootstrap@1.2.0` carries owner-issued `queryRoots` for the two product
areas: `planning` and `operate`. Each member is nullable because a compatible
installation may make only one product available. A non-null root is a closed
identity object containing exactly `actorId`, `projectId`, `scopeId`,
`domainId`, `domainVersion`, and `generation`.

OpenPlanr must start each product query from its corresponding root and keep the
root bound to the bootstrap's exact current project. Null means unavailable; it
never authorizes the browser to derive an identity from a route, reuse the other
product's root, substitute a sibling checkout, or guess a project. A project,
actor, scope, domain/version, or generation change invalidates the old root and
all queries derived from it.

## Verified display families

The current owner-issued display boundary is split deliberately:

| Contract | Surfaces |
|---|---|
| `operate-experience-display-surface@1.0.0` | Today, Inbox, Cycles collection, and the Cycle surface envelope |
| `operate-cycle-display-workspace@1.0.0` | The sanitized exact Cycle workspace carried by Cycle detail |
| `operate-executive-board-display-surface@1.0.0` | Business Cycle executive seats, Challenger findings, and Chair synthesis on Cycle detail |
| `operate-action-display-workspace@1.0.0` | Exact Action detail, lifecycle boundaries, and owner-issued governed controls |
| `operate-recovery-display-surface@1.0.0` | Access-safe Recovery state and available owner-issued recovery paths |
| `operate-experience-audit-display-surface@1.0.0` | Evidence, Outcomes, Outcome detail, History, Search, and Export |

Each envelope commits the selected payload and the source view anchors with
domain-separated SHA-256/JCS. OpenPlanr additionally binds the envelope to the
current project, generation, route, actor, scope, domain/version, Cycle, Event
head, and view hash before a model may expose rows to React.

## Executive-board presentation requirement

The source-checkout candidate presents the board defined in
[AGENTIC_EXECUTIVE_BOARD.md](AGENTIC_EXECUTIVE_BOARD.md): CEO, CTO, CPO, CMO,
COO, Challenger, and Chair. It must show each selected role's exact Assignment,
accepted Artifact or typed absence, evidence coverage, challenge, and synthesis.
It must not infer executive identity from a title string or manufacture a
missing role in browser code. Release evidence must preserve that behavior from
owner contract through packed install; source presence alone is insufficient.

## Legacy-client cutover

The retired direct-DOM client is not a fallback product. Do not weaken the
server or audit contracts, retain duplicate assets, or use a source-checkout
path to make that client appear available. OpenPlanr owns the single packaged
React product; rollback is a package-version operation.

## Completion evidence

A dashboard screen is complete only when all applicable evidence exists:

- owner contract/schema/verifier tests;
- packed source-to-install parity under Node 20;
- strict OpenPlanr type checking and product build;
- focused model and interaction tests;
- route, stale-response, SSE, cleanup, focus, privacy, and hostile-binding tests;
- real-browser accessibility, responsive/reflow, forced-colors, reduced-motion,
  governed-dialog focus, and reviewed Playwright native-golden evidence;
- automated axe, keyboard/focus, route-announcement, emulated-touch, 200%
  effective-reflow, responsive, forced-colors, and reduced-motion evidence.
  VoiceOver, NVDA, and physical-device testing remain unclaimed; the product
  owner accepted that limitation as non-blocking for SPEC-020 closure;
- no legacy asset or test-fixture path in the production bundle.

The current [dashboard reference](../dashboard.md) documents the unified server
and product boundary. The retired direct-DOM implementation is not a supported
fallback.
