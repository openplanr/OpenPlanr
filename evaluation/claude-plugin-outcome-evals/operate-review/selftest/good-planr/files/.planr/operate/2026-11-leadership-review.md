---
cycle: 2026-11
lenses: [ceo, cpo, cto, cmo, coo, cfo]
---
# Leadership review, November 2026

## Where we stand

- **Activation fell** from 41.0% (July to September) to 33.6% in October, an 18% relative drop, starting
  with the onboarding flow shipped on 2026-10-01. Signups still grew (1,250 to 1,310).
- **Reliability:** three Sev-2 incidents in October (sync on 4 and 27 October, gateway on 15 October)
  after none in September; 40 notes lost edits; two sync postmortems are unfinished.
- **Roadmap:** Q4 puts the CTO and both sync engineers on team workspaces all quarter; nothing addresses
  activation or reliability.
- **Runway:** 8 months at $175k net burn (up from $150k), below the board's 12-month bar for raising.
- **Measurement gap:** no retention or churn data, so we cannot tell whether the activation drop hurts
  revenue later.

## Decisions and actions

| Action | Owner | Due | Evidence |
|--------|-------|-----|----------|
| Roll back or A/B the 1 October onboarding flow | Mira Chen | 2026-11-15 | Activation 41.0% to 33.6% |
| Finish both sync postmortems and fix the root causes before workspace work | Sam Lee | 2026-11-20 | Sev-2s on 4 and 27 Oct |
| Move one sync engineer off team workspaces until sync is stable | Sam Lee | 2026-11-10 | Roadmap item 1 |
| Freeze hiring and cut burn back to $150k to reach 10+ months | Dana Reyes | 2026-11-30 | Runway 8 months |
| Add monthly retention and churn to the metrics export | Leo Park | 2026-11-30 | No retention column |
