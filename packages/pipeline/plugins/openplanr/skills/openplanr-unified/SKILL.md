---
name: openplanr-unified
description: Compatibility router for legacy unified OpenPlanr invocations.
license: MIT
---

# OpenPlanr compatibility router

This alias preserves legacy invocation only. Route the request to exactly one
canonical skill; the canonical `planr-*` source owns the workflow.

| Canonical skill | Use when |
|---|---|
| `planr-artifact` | Open, share, import, or export an OpenPlanr HTML artifact review. Use when feedback must move between a local artifact and its review board. |
| `planr-browser-qa` | Run practical browser-backed QA against real routes, forms, viewports, accessibility, console, and network behavior. Use for UI, authentication, session, navigation, or browser-network changes. |
| `planr-ceo-review` | Produce a grounded strategy and finance review for an Operate cycle. Use when direction, runway, margin, investment, or cost of delay needs a CEO lens. |
| `planr-chair-review` | Synthesize an Operate cycle into a prioritized decision queue and action plan. Use after specialist reviews when leadership needs one coherent brief. |
| `planr-challenger-review` | Challenge an Operate cycle's claims, alternatives, downside, and confidence. Use when assumptions or executive consensus need an independent stress test. |
| `planr-cmo-review` | Produce a grounded market and growth review for an Operate cycle. Use when acquisition, positioning, demand, retention, or missing measurement needs a CMO lens. |
| `planr-coo-review` | Produce a grounded operations and customer-health review for an Operate cycle. Use when readiness, service delivery, capacity, or customer health needs a COO lens. |
| `planr-cpo-review` | Produce a grounded product and activation review for an Operate cycle. Use when customer value, activation, prioritization, or adoption needs a CPO lens. |
| `planr-cto-review` | Produce a grounded technology and delivery-risk review for an Operate cycle. Use when architecture, reliability, security, or execution risk needs a CTO lens. |
| `planr-dashboard` | Start or inspect the loopback-only OpenPlanr planning dashboard. Use when the user wants to view local planning or Operate state in the browser. |
| `planr-design` | Create or route an OpenPlanr product-design workflow using portable board assets. Use for a new UI direction; use the loop or review skills for iteration. |
| `planr-design-loop` | Explore multiple design directions and collect pinned board feedback. Use when the user wants to compare variants and select a direction interactively. |
| `planr-design-review` | Review and revise an existing OpenPlanr design from pinned board feedback. Use when a current design needs focused visual changes rather than new directions. |
| `planr-diagram` | Create, inspect, verify, or rerender professional offline diagrams. Use for architecture, process, sequence, data, state, or relationship visuals from intent or source. |
| `planr-doctor` | Diagnose OpenPlanr CLI, pipeline, runtime-adapter, installation, and lock health. Use when setup, discovery, versions, generated assets, or runtime behavior seems wrong. |
| `planr-investigate` | Diagnose a bug, regression, error, or unexplained behavior and optionally implement a bounded fix. Use for root-cause investigation, not planned feature delivery. |
| `planr-land` | Assess release readiness and prepare or inspect an OpenPlanr landing sequence. Use after implementation and checks are complete, before merge, publication, or deployment. |
| `planr-operate` | Run a focused operating review across seven executive lenses and produce a decision and action brief. Use for periodic product or company-level leadership review. |
| `planr-plan` | Turn a Protocol-compatible specification or product intent into schema-compatible OpenPlanr stories and implementation tasks. Use for planning and decomposition, not implementation. |
| `planr-plan-review` | Review an OpenPlanr plan for product, engineering, design, and developer-experience problems. Use after planning and before implementation to improve the plan. |
| `planr-ship` | Implement an OpenPlanr plan, specification, task, or clearly stated request end to end in the current repository. Use when the user asks to build, implement, fix, finish, or ship local work. |
| `planr-spec` | Shape vague product or engineering intent into a clear, measurable Protocol-compatible specification grounded in the current repository. Use when requirements need clarification before planning or implementation. |
| `planr-status` | Inspect project delivery or one feature's pipeline status without changing state. Use when the user asks what is done, pending, blocked, or next. |
| `planr-sync` | Audit OpenPlanr planning artifacts for graph and protocol drift. Use when statuses, references, schemas, or generated planning views may be inconsistent. |

Do not implement a second workflow or add lifecycle machinery in this alias.
Follow the selected canonical skill as written, preserve the user's scope, and
pause only at the real effect boundaries that skill identifies.
