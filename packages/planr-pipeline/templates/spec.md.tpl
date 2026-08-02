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

## User Flows

> *Describe the primary happy path(s) in narrative form.*

**Flow 1 — [Flow Name]:**
1. User lands on [screen/entry point].
2. User [performs action].
3. System [responds with behavior].
4. User [continues or completes].

**Flow 2 — [Alternative / Edge case]:**
1. ...

---

## Screens / UI References

> *List any PNG files deposited in input/ui/ that belong to this feature. Mirror the same paths into the `ui_files` array in the frontmatter above.*

```yaml
UIFiles:
  - input/ui/[screen-name-1].png    # [brief description]
  - input/ui/[screen-name-2].png    # [brief description]
```

*(If no UI files: the Designer Agent step will be skipped. 1 task per US.)*
*(If UI files present: Designer Agent runs. 2 tasks per US: task-1 UI, task-2 Tech.)*

---

## Out of Scope

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

## Dependencies

```yaml
DependsOn:
  - feat-[name]              # must be completed before this feature
  - input/tech/stack.md      # always
  - output/db/schema.json    # if database interaction required

BlockedBy:
  - "[external team / API / contract]"
```

---

## Notes for the Specification Agent

> *Optional hints to guide decomposition. Not business requirements.*

- Suggested US split: [e.g. "Auth flow, Dashboard view, Settings panel"]
- Special attention: [e.g. "The delete flow has a confirmation dialog — model as separate task"]
- Preserve: [e.g. "Do not modify the existing UserService.cs"]

---

*Template version: 1.1 · See docs/spec-anatomy.md for full authoring guide*
