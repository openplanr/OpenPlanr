# spec-{name}.md — Detailed Functional Spec (DFS)

> **Owner:** Product Owner
> **Purpose:** Describe WHAT the feature must do, not HOW to build it.
> No numbered User Stories here — only functional bullets.
> This file is the primary input for the Specification Agent.
>
> **Default-mode template.** Uses the v1.0.0 schema frontmatter (since SPEC-001 / SPEC-002, harmonized for cross-mode schema compatibility) so the same `schemas/v1.0.0/spec.schema.json` validates default-mode and spec-driven specs alike. Spec-driven users should still prefer `templates/spec-driven.md.tpl` — both modes remain first-class.

---

## Feature Identity

```yaml
id: "FEAT-NNN"                      # default-mode feature id; project-scoped
title: "[Human-readable title]"
slug: "[feat-name]"                 # used as folder name: output/feats/feat-{slug}/
schemaVersion: "1.0.0"
status: "pending"                   # pending | shaping | shaped | decomposing | decomposed | ready-for-pipeline | in-pipeline | done
priority: "P1"                      # P0 | P1 | P2 | P3
milestone: "[v1.0 | sprint-3 | etc.]"
po: "[Product Owner identifier]"
created: "[YYYY-MM-DD]"
updated: "[YYYY-MM-DD]"
ui_files: []                        # PNG paths under input/ui/, empty when no UI surface
tech_dependencies: []               # informational upstream tech deps, empty when none
```

---

## Context & Goal

> *What problem does this feature solve? Who is the primary user?*

[Describe the business context in 2–5 sentences. Focus on the user need and the expected outcome, not on implementation.]

---

## Audience

**Primary:** [Who makes or receives the core decision?]

**Affected:**
- [List every materially affected user or stakeholder.]

---

## Outcome & Measurement

**Statement:** [State the user or business outcome.]

**Measure:** [Name the observable metric or check.]

**Target:** [Set the pass threshold.]

**Timeframe:** [Set the measurement window.]

---

## Functional Requirements

> *What must the system do? Use action verbs. One bullet = one observable behavior.*

- The user must be able to [action] so that [outcome].
- The system must [behavior] when [condition].
- [Role] can [capability] from [location/context].
- The system must prevent [undesired action] when [guard condition].
- [Add as many bullets as needed — no limit on scope here]

---

## Business Rules

> *Constraints, validations, and logic that govern the feature.*

- [Rule 1: e.g. "A user can have at most 3 active subscriptions at a time."]
- [Rule 2: e.g. "Deletion is soft — records must be archivable, not permanently removed."]
- [Rule 3: e.g. "All monetary values are stored in cents (integer), displayed in dollars."]

---

## Constraints

> *State technical, legal, operational, time, or budget boundaries.*

- [Constraint]

---

## Evidence Expectations

> *Name the observable checks required to accept each material outcome. UI
> references belong in `ui_files` and may be described here when relevant.*

- [Outcome] is accepted when [observable check] reaches [threshold].

---

## Failure Modes

- [Credible failure] — detected by [signal or behavior].

---

## Rollback

[Describe the safe reversal or compensating action and its trigger.]

---

## Scope Boundaries

### In Scope

- [Exact capability included.]

### Out of Scope

> *Explicitly list what this feature does NOT include.*

- [Not in scope: e.g. "Email notifications for this action — covered in feat-notifications."]
- [Not in scope: e.g. "Admin view — covered in feat-admin-panel."]

---

## Acceptance Criteria

> *How do we know this feature is done? Observable, testable outcomes.*

- [ ] Given [condition], when [action], then [observable result].
- [ ] Given [condition], when [action], then [observable result].
- [ ] All existing tests pass after integration.
- [ ] No regressions in [related feature].

---

## Declared Risk Specialists

[Optional declarations: security, performance, migration, api-contract, or
data-integrity.]

---

## Notes for Decomposition

> *Optional hints to guide decomposition. Not business requirements.*

- Suggested US split: [e.g. "Auth flow, Dashboard view, Settings panel"]
- Special attention: [e.g. "The delete flow has a confirmation dialog — model as separate task"]
- Preserve: [e.g. "Do not modify the existing UserService.cs"]
- Dependencies: [real upstream outputs consumed by this feature]

---

*Template version: 1.1 · See docs/spec-anatomy.md for full authoring guide*
