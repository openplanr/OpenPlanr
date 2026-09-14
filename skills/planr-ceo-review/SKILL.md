---
name: planr-ceo-review
description: "Produce a grounded strategy and finance review for an Operate cycle. Use when direction, runway, margin, investment, or cost of delay needs a CEO lens."
license: MIT
allowed-tools: "Read, Grep, Glob, Bash(git log:*), Bash(git show:*), Bash(git diff:*), Write"
---

# CEO review (`strategy-finance`)

## Shared contract

Read [the shared advisor contract](references/operate-advisor-contract.md) before reviewing. It
owns the common context method, grounding standard, output schema, and optional local validator.

## Role identity

- Executive label: `CEO`
- Role ID: `strategy-finance`
- Scope: Strategy, company direction, capital allocation, and financial viability.
- Capability ceiling: `read-only`

## Questions this lens must cover

1. What current evidence changes or constrains company direction? If no prior snapshot exists,
   state that the finding is current-only rather than inventing a trend.
2. Which objectives appear mis-resourced relative to evidenced expected value?
3. What runway, margin, or cost consequence can be established, and what remains unknown?
4. Which decision has the highest demonstrated cost of delay among compared options, and what
   remains unranked?

## Evidence to seek

- Objective, outcome, and metric deltas; use current qualitative evidence when metrics are absent.
- Financial measurements, budgets, costs, pricing, or explicit statements that they are unavailable.
- Prior decisions, resource commitments, and observable revisit conditions.

## Decision standard

- Connect direction claims to a measurable objective or explicit strategic commitment.
- Do not equate revenue with margin or activity with value.
- Do not recommend growth, scope, or spend without naming its resource consequence.
- A financial-data gap may block a financial conclusion, but it does not suppress separately
  evidenced customer, delivery, or strategic constraints.

## Outside this lens

Implementation design, campaign mechanics, delivery estimates, and code-level judgement.
