---
name: planr-openplanr
description: Route a planning, specification, delivery, design, review, diagram, release, or operating request to the best OpenPlanr skill. Use when the right skill is unclear or the request spans several.
license: MIT
---

# OpenPlanr router

Decide which OpenPlanr skill owns the request, say which one and why in one
line, then invoke it. Invoke a skill by its host name: the skill id without the
`planr-` prefix, namespaced under `planr` (`planr-plan` is `/planr:plan` in
Claude Code and `$planr:plan` in Codex). Do not perform the routed work here.

## Route by intent

| The user wants to… | Skill |
| --- | --- |
| Turn a vague idea or requirement into a measurable specification | `planr-spec` |
| Break a specification or intent into stories and tasks | `planr-plan` |
| Check a plan before implementation starts | `planr-plan-review` |
| Build, fix, finish, or ship local work | `planr-ship` |
| Find the root cause of a bug, regression, or odd behavior | `planr-investigate` |
| Test the running application in a real browser | `planr-browser-qa` |
| Design a new interface or a coherent design direction | `planr-design` |
| Compare several design directions | `planr-design-loop` |
| Revise an existing design with pinned feedback | `planr-design-review` |
| Create or check an architecture, process, sequence, or data diagram | `planr-diagram` |
| Share, import, or export an HTML artifact review | `planr-artifact` |
| Know what is done, pending, blocked, or next | `planr-status` |
| Refine the open backlog and select the sprint for the next release cut | `planr-sprint` |
| See planning or Operate state in the browser | `planr-dashboard` |
| Check artifacts for graph, status, or schema drift | `planr-sync` |
| Judge release readiness or prepare a landing sequence | `planr-land` |
| Pick a versioning scheme, bump versions, write release notes | `planr-release` |
| Diagnose the CLI, plugins, installation, or upgrade state | `planr-doctor` |
| Run a leadership operating review across all lenses | `planr-operate` |
| Get one executive lens on an Operate cycle | `planr-ceo-review`, `planr-cto-review`, `planr-cpo-review`, `planr-cmo-review`, `planr-coo-review` |
| Stress-test an Operate cycle's claims, or synthesize its decisions | `planr-challenger-review`, `planr-chair-review` |

## Boundaries

- PLAN and SHIP are separate user-invoked workflows. Route to one; never chain
  `planr-plan` into `planr-ship` on the user's behalf.
- When a request spans several skills, route to the earliest step in that
  order (spec → plan → plan-review → ship → land → release) and name the rest.
- When the request is not OpenPlanr work at all, say so and answer directly
  without invoking a skill.
- Ask one concise question only when two candidate skills would produce
  materially different work.
