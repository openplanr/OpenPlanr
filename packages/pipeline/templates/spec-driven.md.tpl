---
id: "{{SPEC_ID}}"
title: "{{TITLE}}"
slug: "{{SLUG}}"
schemaVersion: "1.0.0"
status: "pending"
priority: "P1"
created: "{{DATE}}"
updated: "{{DATE}}"
ui_files: []
tech_dependencies: []
---

# {{SPEC_ID}}: {{TITLE}}

## Context & Goal

_Describe the problem this feature solves and the expected outcome. 2-5 sentences. Focus on the user need; avoid implementation details._

## Audience

**Primary:** _Who makes or receives the core decision?_

**Affected:**
- _List every materially affected user or stakeholder._

## Outcome & Measurement

**Statement:** _State the user or business outcome._

**Measure:** _Name the observable metric or check._

**Target:** _Set the pass threshold._

**Timeframe:** _Set the measurement window._

## Functional Requirements

_Use action verbs. One bullet = one observable behavior._

- The user must be able to ...
- The system must ...

## Business Rules

_Constraints, validations, and logic that govern the feature._

- ...

## Constraints

_State technical, legal, operational, time, or budget boundaries._

## Evidence Expectations

_Name the observable checks required to accept each material outcome._

## Failure Modes

_Describe credible failures and how they will be detected._

## Rollback

_Describe the safe reversal or compensating action and its trigger._

## Scope Boundaries

### In Scope

- _List the exact capability included._

### Out of Scope

- _List the exact capability excluded._

## Acceptance Criteria

_Observable, testable outcomes._

- [ ] Given ..., when ..., then ...
- [ ] Given ..., when ..., then ...

## Declared Risk Specialists

_Optional declarations: security, performance, migration, api-contract, or
data-integrity._

## Notes for Decomposition

_Optional hints to guide decomposition. Not business requirements._

- Suggested US split: ...
- Special attention: ...
- Preserve: ...

---

> Edit this body, then run `/planr-pipeline:plan {{SLUG}}` to decompose into stories + tasks.
> Schema: `https://openplanr.dev/docs/reference/spec-schema`
