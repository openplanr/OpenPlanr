# Operate continuation handoff

This directory is the single entry point for continuing the Operate runtime,
agentic executive board, and unified dashboard work. It is a map, not a copy of
the underlying contracts. Follow its links so the product constitution,
registries, schemas, specifications, and task artifacts remain authoritative in
their existing locations.

This is intentionally source-checkout documentation. The private `.planr`
constitution, SPEC, task, QA, and laptop-state artifacts are not turned into
public package payloads. Branch-specific state belongs in the ignored
`.planr/local/operate-current-state.md` note when maintainers need one.

## Start here

1. Read [AGENTIC_EXECUTIVE_BOARD.md](AGENTIC_EXECUTIVE_BOARD.md) before changing
   role registration, routing, mandates, skills, or agent dispatch. The
   agentic executive board is a product requirement, not legacy behavior to
   delete accidentally.
2. Read [DASHBOARD.md](DASHBOARD.md) for the dashboard ownership boundary and
   the route/screen/contract map.
3. Read [CONTINUATION_PLAN.md](CONTINUATION_PLAN.md) for the dependency-safe
   implementation sequence and completion gates.
4. Follow the authoritative reading order below before editing production code.

The implementation spans two repositories with independent package and release
histories:

| Repository | Responsibility |
|---|---|
| `planr-pipeline` | Protocol and schema owner; runtime kernel; domain, role, projection, display-contract, dashboard-server, packaging, and conformance contracts |
| `OpenPlanr` | Installed CLI consumer; project-local persistence and composition; React dashboard product; browser behavior and integration tests |

The current unpublished source-checkout candidate includes the seven-seat
business board and production Planning/Operate dashboard composition. Its
automated evidence exercises owner-ready browser routes, governed-dialog focus,
responsive/reflow and preference states, real visual baselines, and packed
consumer installs. SPEC-020 and SPEC-022 are locally complete with independent
PASS reviews. This is not the installed release. Manual VoiceOver, NVDA, and
physical-device touch sessions remain explicitly unclaimed; the owner accepted
that limitation as non-blocking for the local SPEC-020 closure.

Do not use a globally installed CLI, a sibling checkout, or prose in this
directory as evidence for the current source. Verify task status and QA in the
active specifications, then verify exact package bytes. Release and installation
remain separate decisions.

## Authority and source precedence

This handoff index does not supersede the Operate constitution. Resolve a
conflict in this order:

1. [INVARIANTS.md](../../.planr/products/operate-2.0/INVARIANTS.md) defines
   correctness.
2. [GOVERNANCE.md](../../.planr/products/operate-2.0/GOVERNANCE.md) and the
   [executive-board skill-split decision](../../.planr/products/operate-2.0/phases/EXECUTIVE_BOARD_SKILL_SPLIT_DECISION.md)
   define authority, plane separation, domain ownership, and the locked board.
3. [STATE_MACHINE.md](../../.planr/products/operate-2.0/STATE_MACHINE.md),
   [DOMAIN_MODEL.md](../../.planr/products/operate-2.0/DOMAIN_MODEL.md),
   [TOOL_API.md](../../.planr/products/operate-2.0/TOOL_API.md),
   [ARTIFACT_MODEL.md](../../.planr/products/operate-2.0/ARTIFACT_MODEL.md), and
   [EVIDENCE_MODEL.md](../../.planr/products/operate-2.0/EVIDENCE_MODEL.md)
   define normative contracts.
4. [ARCHITECTURE.md](../../.planr/products/operate-2.0/ARCHITECTURE.md) defines
   component and repository responsibilities.
5. [PRODUCT_VISION.md](../../.planr/products/operate-2.0/PRODUCT_VISION.md)
   defines product direction and the operating loop.
6. The approved [SPEC-020](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/SPEC-020-openplanr-unified-dashboard-redesign.md)
   and [SPEC-022](../../.planr/specs/SPEC-022-operate-executive-board-and-generated-role-skills/SPEC-022-operate-executive-board-and-generated-role-skills.md),
   their story files, task frontmatter, QA reports, and SPEC-020
   [design specification](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/design/design-spec.md)
   define the authorized implementation and recorded amendments.
7. [registry/operate-v2-contracts.json](../../registry/operate-v2-contracts.json),
   the versioned schemas, package exports, and tested implementation define what
   the current branch actually implements. Documentation cannot create a
   runtime capability that these surfaces do not implement.
8. Files in this directory explain desired continuity and work order. They do
   not override task frontmatter, QA evidence, or a normative contract.

The owner direction captured in
[AGENTIC_EXECUTIVE_BOARD.md](AGENTIC_EXECUTIVE_BOARD.md) is binding continuation
scope within those constraints. It maps the candidate that now exists, but only
the versioned contracts, current task status, and reproducible QA evidence can
prove that a particular boundary satisfies it.

## Complete context reading order

An agent taking over the implementation should read these groups in order.

### 1. Product constitution

- [Operate 2.0 constitution index](../../.planr/products/operate-2.0/README.md)
- The invariant, governance, normative contract, architecture, and product
  vision documents listed in the precedence section
- [Acceptance tests](../../.planr/products/operate-2.0/ACCEPTANCE_TESTS.md)
- [Traceability matrix](../../.planr/products/operate-2.0/TRACEABILITY_MATRIX.md)

The constitution uses `Operate 2.0` for the architecture and protocol program.
The public product name in new UI and user guidance is **Operate**.

### 2. Agentic operating model

- [Agentic executive board requirement](AGENTIC_EXECUTIVE_BOARD.md)
- [Current contract registry](../../registry/operate-v2-contracts.json)
- [Extension registration implementation](../../lib/operate/extensions-v2.mjs)
- [Intelligence router](../../lib/operate/intelligence-router-v2.mjs)
- [Canonical portable Operate skill](../../skills/planr-operate/SKILL.md)
- [Generated Codex adapter skill](../../adapters/codex/skills/planr-operate/SKILL.md)

Keep the kernel domain-neutral. Business executive roles belong to a versioned
public business-domain definition, with stable role identities, contracted
inputs and outputs, capability ceilings, dependency rules, challenger behavior,
and Chair synthesis. Presentation labels alone are not an implementation.

### 3. Runtime protocol

- [Operate Runtime Protocol 2.0](../protocol/operate-runtime-v2.md)
- [Protocol index](../protocol/README.md)
- [Package exports](../../package.json)
- [Generated contract catalog](../../lib/protocol/generated/contract-catalog-v2.mjs)
- [Protocol and Operate conformance](../../conformance/verify-operating-runtime-v2.mjs)

The runtime protocol document is the technical reference for the kernel. It is
not the sole source for product vision, executive-role definitions, or dashboard
implementation status. Check task frontmatter and QA evidence before
interpreting product-experience coverage as completed UI.

### 4. Unified dashboard

- [Dashboard handoff](DASHBOARD.md)
- [SPEC-020](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/SPEC-020-openplanr-unified-dashboard-redesign.md)
- [Design specification](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/design/design-spec.md)
- [Task directory](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/tasks)
- [QA evidence ledger](../../.planr/specs/SPEC-020-openplanr-unified-dashboard-redesign/qa-report.md)
- [Pipeline dashboard reference](../dashboard.md)
- [Pipeline dashboard contracts and transport](../../lib/dashboard)
- [OpenPlanr React dashboard source](../../../OpenPlanr/src/dashboard)
- [OpenPlanr Operate consumer services](../../../OpenPlanr/src/services/operate)

Task frontmatter and the QA ledger are the current completion record. Do not
infer completion from screen files existing, from older SPEC counts, or from the
released dashboard.

### 5. Continue the work

- [Continuation plan](CONTINUATION_PLAN.md)
- The exact target task, its complete dependency chain, acceptance mapping,
  Preserve set, and corresponding QA entries
- Optional laptop-only orientation in ignored
  `.planr/local/operate-current-state.md`, verified against both working trees

Change the contract-owning repository first, then OpenPlanr adapters and UI.
Run the focused task gates and the relevant regression, conformance, packed
package, and browser gates before marking a task done. Preserve files named by
the task exactly.

## Non-negotiable continuation rules

- Treat SPEC-020 and SPEC-022 as locally completed source candidates; verify
  their QA ledgers before changing their boundaries.
- Keep PLAN and SHIP as separate invocations. Creating a SPEC never invokes
  either automatically.
- Keep the retained VoiceOver, NVDA, and physical-device checklist truthful:
  automated browser coverage does not substitute for human evidence, and no
  manual session is claimed by this closure.
- Preserve the agentic executive-board outcome while moving its implementation
  to versioned domain contracts. Do not revive a second legacy kernel.
- The browser consumes verified owner projections. It does not infer privacy,
  lifecycle, authority, or command arguments locally.
- The dashboard never becomes an authority engine. All mutations use opaque,
  runtime-issued action and confirmation boundaries.
- No source checkout, sibling import, or local overlay may stand in for an
  installed-package release gate.
- Stop only for a genuine product decision, irreversible/destructive work,
  secrets, external effects, publication/release, or a real blocker.

## Copyable handoff prompt

```text
Continue the Operate work from docs/operate/README.md. Read every document in
its required order, then verify the active SPEC task frontmatter and QA evidence
against both local repositories. Preserve the agentic executive-board requirement in
docs/operate/AGENTIC_EXECUTIVE_BOARD.md, keep the v2 kernel domain-neutral, and
continue from the locally completed SPEC-020 and SPEC-022 task and QA truth in
docs/operate/CONTINUATION_PLAN.md. Change planr-pipeline contracts first and
OpenPlanr consumers second. Do not claim manual assistive-technology or physical
device evidence that was not performed. Do not install, push, publish, release,
deploy, bump a version, or change a changelog without separate explicit authority.
```

## Maintaining this handoff

After a coherent task batch:

1. Update the authoritative task frontmatter and QA report first.
2. If useful, update ignored `.planr/local/operate-current-state.md` with a
   short verified laptop-local orientation note; never treat it as release proof.
3. Update the relevant focused handoff document only when its map or requirement
   changed.
4. Keep detailed schemas, acceptance criteria, and evidence in their
   authoritative files. Link them here instead of copying them.
