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
| Functional Requirements | ✅ Required | Primary decomposition source |
| Business Rules | ✅ Required | Enforced in task-2 tech spec |
| User Flows | ✅ Required | US boundary detection |
| Acceptance Criteria | ✅ Required | Task DoD generation |
| Screens / UI References | ⚠️ Conditional | Triggers Designer Agent |
| Out of Scope | 🔵 Recommended | Prevents scope creep in decomposition |
| Dependencies | 🔵 Recommended | US dependency graph |
| Notes for Specification Agent | 🔵 Optional | Decomposition hints |

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

## User Flows — Quality Guide

Flows should describe the **happy path and key alternates**:

```
Flow 1 — Happy Path: [descriptive name]
  1. [Starting state + entry point]
  2. [User action]
  3. [System response]
  4. [Completion state]

Flow 2 — Error / Edge Case: [name]
  1. [Starting state]
  2. [Action that triggers edge case]
  3. [How system handles it]
```

Rule: Each flow in the spec tends to produce one User Story in the decomposition.
If you have 4 flows, expect roughly 4 US in the output.

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
| Missing flows | US decomposition is arbitrary | Write at least the happy path flow |

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
