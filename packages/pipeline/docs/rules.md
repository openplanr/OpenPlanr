# Framework Rules

> Engineering conventions for the PO → DEV workflow.

---

## Hard Rules (Never Violate)

### R1 — Match the Requested Workflow

`/planr:plan` prepares planning context and
`/planr:ship` implements a prepared task or clear local request. Return
the plan for a planning request and implement the work for an implementation
request. Ask a concise question only when missing product information would
materially change the result.

Release/package certification is separate. Run the auditable candidate-closure
workflow only for `--release-candidate` or an equivalent release action.

**Design sub-phase corollary:** `/planr:design` is an optional source of
product/design context. It may be invoked before planning, and `/plan` may suggest
it when UI intent has no design context. `--dry-run` and CI remain non-interactive.

**Design-system continuity corollary (v0.18.0):** a generated design must **continue** the
project's design system, never invent a standalone one. If no design system exists
and the choice would materially change the result, ask one concise design decision
(generate one / point to an existing one / describe the brand). Otherwise use
available project context and state any safe default. Whatever the user picks is
persisted to the project
(`.planr/design-system/` spec-driven, `input/design-system/` default) and reused by every future
`/design` + the PO designer-agent, so the whole product stays one coherent system.

---

### R2 — Task Count Per US
```
IF a design exists for the feature — a design-spec.md (authored by
/planr:design, or extracted by designer-agent) OR input/ui/*.png:
  tasks_per_us = 2
  task-1 = UI task → Frontend Agent
  task-2 = Tech task → Backend Agent

IF no design (no design-spec.md AND no PNG):
  tasks_per_us = 1
  task-1 = Tech task → Backend Agent (or combined UI+Tech)

NEVER: 3 or more tasks per US
```
Rationale: More than 2 tasks per US creates coordination complexity and ambiguous agent ownership.

The trigger is **design intent existing**, not specifically a PNG. `design-spec.md` is the
canonical signal — `specification-agent` already keys its `has_design` branch on it, so
keying R2 on the same artifact keeps the rule and the agent consistent. This is what lets
`/planr:design` close the loop: generate a design → `design-spec.md` exists → the
UI task is born, instead of degrading to a Tech-only ship. (Without this, a generated design
with no PNG would still yield `tasks_per_us = 1` and no UI task.)

---

### R3 — Capability Tiers Are Fixed; Adapters Own the Model Mapping
```
analysis-high      → DB Agent, Designer Agent, Specification Agent,
                     Entity Scaffold Agent, DevOps Agent, Doc-Gen Agent
implementation-high → Frontend Agent, Backend Agent
read-only-qa       → QA Agent
```
Rationale: `analysis-high` is sufficient for analysis, decomposition, and **structured** schema→scaffold output (Entity Scaffold Agent — Step 0.2). `implementation-high` is required for exploratory multi-file DEV codegen (Frontend + Backend task implementation).

The tier is the portable, rule-level assignment: `registry/roles.json` is authoritative and is what every runtime adapter reads. **No vendor model string is part of this rule or of the protocol.** Each runtime adapter maps a tier onto whatever it runs — the Claude Code adapter does so in `agents/*.md` frontmatter, and `docs/agent-model-map.md` records that adapter's current mapping and why.
Never change a role's tier without updating `registry/roles.json`, the agent files, and `docs/agent-model-map.md`.

---

### R4 — Tech Lead Never Edits task-{M}.md
```
❌ FORBIDDEN: Tech Lead manually editing task-{M}.md files
✅ REQUIRED:  If task content is wrong, edit us-{N}.md or spec-{name}.md,
              then re-run the Specification Agent
```
Rationale: Tasks are generated artifacts. Editing them directly creates drift
between the spec and the implementation plan.

---

### R5 — Preserve Boundaries Are Inviolable
```
Any {repositoryKey, path} listed under Preserve MUST remain unchanged for the
whole SHIP run. The engine verifies the boundary against the run's repository
baseline, including directories, additions, deletions, renames, and symlinks.
```
New runs declare this machine boundary in task frontmatter as block YAML maps:

```yaml
preserve:
  - repositoryKey: project
    path: src/protected
```

Use explicit `preserve: []` when no boundary is required. A legacy prose
`## Preserve` or `Files → Preserve` section remains readable human context but
cannot claim machine enforcement.

Rationale: Preserve is the hard implementation boundary. Create and Modify are
reviewed expectations; directly required companion files are allowed when they
are disclosed in the candidate diff and remain outside Preserve.

---

### R6 — Verification and Recovery Follow Results
```
After a coherent implementation batch, run the applicable commands from
input/tech/stack.md. Choose the useful order from the change and observed state:
  - LintCommand        (if defined)
  - TypeCheckCommand   (if defined)
  - BuildCommand       (required for this pipeline)
  - TestCommand        (required — must meaningfully exercise generated code for this repo)

On failure, inspect the actual error, fix the cause, and rerun the affected check.
If the same approach is not converging, widen context, reconsider the approach,
or use a different suitable agent/tool. Recovery remains adaptive and follows
the observed results.

When progress is not possible because of a missing material decision,
inaccessible dependency, or environment failure, return a concise handoff containing
the failing command, observed error, work already attempted, and the next useful
action. Independent ready work may continue when safe.

Forbidden shortcuts: --no-verify, // @ts-ignore (without justification), skip()'d tests,
                     stubbed return values to fool tests, removing assertions to green the run.
```

Rationale: verification should react to observed results. Fixed retry choreography adds
prompt weight and can stop useful work too early or repeat a bad approach.

---

### R7 — Review Is Proportionate; Release Closure Is Explicit
```
Ordinary work: review and iterate in proportion to risk and acceptance criteria.
Release candidate: use the explicit auditable closure workflow.
```

For ordinary planning, implementation, and review:

- let the coding runtime choose an appropriate review method and iterate when
  findings justify it;
- mark planning work complete from verified outcomes and relevant checks;
- summarize what changed, what was verified, and any material remaining risk.

Release-candidate certification uses its dedicated closure workflow.

Rationale: review should improve the result. Candidate custody is valuable at a
release boundary, but imposing it on daily work creates ceremony without adding
confidence.

---

### R8 — DB Agent Is Always READ-ONLY
```
❌ FORBIDDEN: Any DDL or DML from the DB Agent
✅ ONLY: SELECT statements on INFORMATION_SCHEMA or equivalent
```
Rationale: The DB Agent has production database credentials.
Any write operation could destroy data irreversibly.

---

### R9 — Agent Ownership Boundaries
```
Frontend Agent → UI files only (components, pages, styles, client state)
Backend Agent  → Tech files only (services, DTOs, entities, endpoints, DB queries)
Directly required generated files, declarations, lockfiles, fixtures, and adjacent
tests are allowed when required by the declared acceptance criteria, remain outside
Preserve, and are summarized with the implementation.
```
Rationale: role ownership keeps implementation coherent without turning an
estimate of changed paths into a hard file lock.

### R10 — Agent Role Parity (Build-Order Rule)
```
No pipeline release adds a new agent role (agents/<role>-agent.md + manifest entry)
without corresponding qa-agent verification coverage.
```
The qa-agent must know how to verify the new role's outputs: file existence, schema conformance, DoD checks. Roles producing non-code artifacts (e.g., designer-agent → design-spec.md) must have structural validation in the qa-gate. Build order: Foundation (db, specification, frontend, backend) → Verification (qa) → Optional (devops, doc-gen). New roles insert into this pyramid at the appropriate layer; verification always covers them.

---

## Soft Guidelines (Strongly Recommended)

### G1 — US Count Per Feature
```
Recommended: 2–6 US per feature
Acceptable: More if the feature is genuinely large
Avoid: 1 mega-US (too broad) or 10+ micro-US (too fragmented)
```

### G2 — Spec Quality Before Running
```
A spec that is vague or incomplete will produce poor decomposition.
Use `planr spec create + shape` (planr CLI) to guide POs through writing complete specs, or fill in the placeholder body the pipeline auto-scaffolds on the first `/planr:plan` invocation.
The Specification Agent's output quality is directly proportional
to the input spec quality.
```

### G3 — Run DB Agent Before PO Phase on New Projects
```
If the project has an existing database, always run Step 0.1 first.
The Specification Agent produces better task files when it can
reference real table and column names.
```

### G4 — Keep stack.md Up To Date
```
Update input/tech/stack.md whenever:
- A new dependency is added
- A naming convention changes
- A new stack file is added to .claude/stacks/
All agents read this file — stale stack.md = wrong generated code.
```

### G5 — Review Work in Proportion to Risk
```
Inspect the artifacts and code needed to establish confidence in the result.
High-risk or ambiguous changes deserve deeper review; a small well-covered change
may need only focused checks.
```

### G6 — Resolve Material Design Questions
```
Resolve an open design question when it materially changes the implementation.
Otherwise use the strongest available design-system context and state the
assumption in the result.
```

---

## Core flow

```
request + task context + repository conventions -> implementation -> checks -> result
```

---

*See: `docs/pipeline-overview.md` · `docs/agent-model-map.md`*
