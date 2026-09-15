# Spec Anatomy

> What every valid `spec-{name}.md` file must contain for the Specification Agent to decompose it correctly.
> Written by: Product Owner — manually, or via the planr CLI (`planr spec create + shape` for spec-driven mode).

---

## The Cardinal Rule

**Describe WHAT, not HOW.**

The spec is a business document, not a technical design.
The Specification Agent translates it into tasks.
The DEV agents translate tasks into code.

If you find yourself writing file paths, class names, or SQL queries in the spec — stop.
That belongs in `input/tech/stack.md` or in the agent's output.

---

## Required vs Optional Sections

| Section | Required | Quality Impact |
|---------|----------|----------------|
| Feature Identity (yaml header) | ✅ Required | Determines folder naming |
| Context & Goal | ✅ Required | Sets agent context |
| Audience | ✅ Required | Names the primary and affected users |
| Outcome & Measurement | ✅ Required | Defines observable success |
| Functional Requirements | ✅ Required | Primary decomposition source |
| Business Rules | ✅ Required | Enforced in task-2 tech spec |
| Constraints | ✅ Required | Bounds technical and operational choices |
| Evidence Expectations | ✅ Required | Names acceptance signals |
| Failure Modes | ✅ Required | Covers material failures |
| Rollback | ✅ Required | Defines safe recovery |
| Scope Boundaries | ✅ Required | Separates included work from non-goals |
| Acceptance Criteria | ✅ Required | Task DoD generation |
| Declared Risk Specialists | 🔵 Optional | Calls out specialist review needs |
| Notes for Decomposition | 🔵 Optional | Dependencies and decomposition hints |

---

## Functional Requirements — Quality Guide

Each bullet should follow this pattern:
```
[Subject] must/can/must not [verb phrase] [qualifier/condition]
```

Quality checklist per bullet:
- ✅ Contains an observable behavior (not a feeling or quality attribute)
- ✅ Has a clear subject (who/what does the action)
- ✅ Uses present tense, active voice
- ✅ Is specific enough to be tested
- ❌ Avoid: "the system should be fast" (not testable)
- ❌ Avoid: "users can manage their profile" (too vague — what does manage mean?)

---

## Business Rules — Quality Guide

Business rules govern **constraints and invariants**, not behaviors:

✅ Good business rules:
- "A subscription can have at most 5 seats."
- "Invoices cannot be deleted — only cancelled."
- "Price is always stored in the lowest currency unit (cents)."
- "Users must verify email before accessing paid features."

❌ Not business rules (these are functional requirements):
- "The user can view their subscription." → functional requirement
- "The UI shows a subscription badge." → UI requirement / design spec

---

## Outcome and Scope — Quality Guide

The outcome states what changes for the user and how that change is measured.
Scope boundaries keep decomposition focused:

```
Statement: Returning users can complete sign-in without support.
Measure: Successful sign-ins divided by submitted valid-credential attempts.
Target: At least 99%.
Timeframe: First 14 days after release.

In Scope: Password sign-in and invalid-credential feedback.
Out of Scope: SSO and password recovery.
```

Failure modes cover the important alternate behavior; acceptance criteria turn
both the successful and failing cases into observable scenarios.

---

## Acceptance Criteria — Quality Guide

Use the Given/When/Then format:
```
- [ ] Given [precondition], when [action], then [observable result].
```

Rules:
- Write criteria from the **user's perspective**, not the system's internals
- Include both success and failure cases
- Be specific: "the form shows an error message" is better than "validation occurs"
- These become the Definition of Done in the generated task files

---

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| "Implement a REST API for X" | Technical HOW, not WHAT | "The user must be able to X via the application" |
| Vague scope: "manage X" | Agent can't bound the US | List specific operations: view, create, edit, delete, search |
| No business rules | Agent misses validations | Add constraints explicitly: limits, formats, permissions |
| No acceptance criteria | Tasks lack DoD | Write 3+ testable Given/When/Then statements |
| Missing measurable outcome | Success is subjective | Add a measure, target, and timeframe |
| Missing scope boundary | Decomposition expands unpredictably | List exact in-scope capability and non-goals |

---

## Completeness Score

The Specification Agent evaluates spec completeness before decomposing:

| Score | Condition | Agent Behavior |
|-------|-----------|----------------|
| ✅ Complete | All required sections present and non-empty | Full decomposition |
| ⚠️ Partial | 1–2 required sections missing | Decompose with best-effort, flag gaps in US Notes |
| ❌ Incomplete | More than 2 required sections missing | Output error, ask the user to fill in the spec body |

---

*Written by: Product Owner*
*Default-mode template: `${CLAUDE_PLUGIN_ROOT}/templates/spec.md.tpl`*
*Spec-driven mode: `planr spec create + shape` produces a body that satisfies this anatomy.*
