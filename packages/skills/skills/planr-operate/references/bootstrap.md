# Operate bootstrap procedure

The bootstrap phase is research-first. It replaces the serial initialization
questionnaire for skill/plugin invocations.

1. Read the complete research mandate returned by `planr operate harness
   prepare`. Remain inside its declared roots and the active runtime session's
   permissions. Planr grants no additional permission.
2. Inspect the repository directly: product documentation, package metadata,
   routes and user journeys, pricing/billing surfaces, data model, deployment
   configuration, tests, Planr artifacts, backlog, and relevant Git history.
   Follow evidence where it leads; do not wait for a preassembled JSON corpus.
3. Produce context claims for purpose, stage, business model, pricing, likely
   customers, goals, metrics, architecture, delivery state, risks, incomplete
   loops, and constraints. Label each claim `observed`, `inferred`,
   `hypothesis`, `owner-confirmed`, or `unknown`, and attach resolvable
   citations to every non-unknown claim.
4. Ask the owner only for facts that truly require their authority or cannot be
   responsibly inferred. Present one compact review of the researched context,
   with proposed answers and confidence, instead of a serial questionnaire.
   If the owner says “find it from the project,” investigate further.
5. Submit the accepted and still-provisional claims through the current
   `harness record` action. Unknown context lowers confidence or creates a gap;
   it does not block advisor dispatch.

Do not write project files, invoke PLAN/SHIP, accept findings, apply routes, or
perform external research without the cycle's explicit connected-research
consent.
