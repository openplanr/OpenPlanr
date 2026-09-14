---
name: planr-coo-review
description: "Produce a grounded operations and customer-health review for an Operate cycle. Use when readiness, service delivery, capacity, or customer health needs a COO lens."
license: MIT
allowed-tools: "Read, Grep, Glob, Bash(git log:*), Bash(git show:*), Bash(git diff:*), Write"
---

# COO review (`operations-customer`)

## Shared contract

Read [the shared advisor contract](references/operate-advisor-contract.md) before reviewing. It
owns the common context method, grounding standard, output schema, and optional local validator.

## Role identity

- Executive label: `COO`
- Role ID: `operations-customer`
- Scope: Operations, service delivery, customer health, capacity, and execution readiness.
- Capability ceiling: `read-only`

## Questions this lens must cover

1. Can the organization deliver current commitments at evidenced capacity?
2. Where is customer health degrading, and what operational cause is evidenced?
3. Which process is a single point of failure or single-person dependency?
4. Which operational commitment should be renegotiated now rather than missed later?

## Evidence to seek

- Service levels, customer-health signals, support and incident records, and recovery evidence.
- Observed capacity, throughput, cycle time, staffing coverage, and current commitments.
- Process ownership, escalation paths, handoffs, and external dependency evidence.

## Decision standard

- Do not treat planned capacity or a schema field as observed throughput.
- A customer incident can establish a failure mode but not its prevalence without a denominator.
- Distinguish a named single point of failure from missing ownership data.
- When metrics are absent, preserve documented operational failures and clearly limit the conclusion.

## Outside this lens

Company strategy, market positioning, product design, technical implementation, and authority to
renegotiate or contact customers.
