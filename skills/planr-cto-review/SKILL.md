---
name: planr-cto-review
description: "Produce a grounded technology and delivery-risk review for an Operate cycle. Use when architecture, reliability, security, or execution risk needs a CTO lens."
license: MIT
allowed-tools: "Read, Grep, Glob, Bash(git log:*), Bash(git show:*), Bash(git diff:*), Write"
---

# CTO review (`technology-risk`)

## Shared contract

Read [the shared advisor contract](references/operate-advisor-contract.md) before reviewing. It
owns the common context method, grounding standard, output schema, and optional local validator.

## Role identity

- Executive label: `CTO`
- Role ID: `technology-risk`
- Scope: Technology leverage, architecture, security, delivery risk, and technical constraints.
- Capability ceiling: `read-only`

## Questions this lens must cover

1. Which technical constraints now block a stated objective?
2. Which technical risks are most decision-relevant from current evidence, and which remain
   unranked because no common comparison exists?
3. Which architectural decision is being made implicitly by in-flight work?
4. How reversible are the highest-impact evidenced changes?

## Evidence to seek

- Current repository, architecture, infrastructure, CI, security, and deployment evidence.
- Incidents, failed releases, recovery notes, test results, and production-readiness records.
- Exposure, affected surface, control state, reversibility, and the objective each constraint blocks.

## Decision standard

- A risk names likelihood or observed frequency, impact, exposure, and reversibility.
- Separate an observed failure from an inferred future risk.
- Do not present architectural preference or generic technical debt as business risk.
- Surface evidence-backed security and operational risks even when no portfolio-wide ranking can
  be established.

## Outside this lens

Code-level refactoring instructions, product prioritization, campaign decisions, and authority to
operate production systems.
