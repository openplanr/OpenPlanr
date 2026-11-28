---
cycle: 2026-11
lenses: [ceo, cpo, cto, cmo, coo, cfo]
---
# Leadership review, November 2026

## Where we stand

- **Activation fell** from 41.0% (July to September) to 33.6% in October, an 18% relative drop,
  starting with the onboarding flow shipped on 2026-10-01. Signups still grew (1,250 to 1,310).
- **Sync reliability:** two Sev-2 sync incidents in October (4 October, edits failed for 22% of active
  users; 27 October, 40 notes lost edits) after a clean September. One postmortem is a draft, the
  other is not started.
- **Roadmap:** Q4 puts the CTO and both sync engineers on team workspaces all quarter; nothing
  addresses activation, reliability or SSO.
- **Largest account at risk:** Brightline Legal pays $6,900 of $28,920 MRR (about 24%) and will not
  renew on 15 December without single sign-on, which is not on the roadmap.
- **Runway is shorter than stated:** 8 months at $175k, but that burn leaves out the $22,000 a month
  Kite Studio contract starting 1 November. At about $197k, runway is about 7.1 months, against the
  board's 12-month bar for raising.
- **Measurement gap:** no retention or churn data, so we cannot tell whether the activation drop
  hurts revenue later.
- Not concerns: the August dip in weekly active users is the usual summer pattern and recovered in
  September; the 9 October alert storm had no user impact and is closed.

## Decisions and actions

| Action | Owner | Due | Evidence |
|--------|-------|-----|----------|
| Roll back or A/B the 1 October onboarding flow | Mira Chen | 2026-11-15 | Activation 41.0% to 33.6% |
| Finish both sync postmortems and fix root causes before workspace work | Sam Lee | 2026-11-20 | Sev-2s on 4 and 27 Oct |
| Scope SSO for Brightline before 15 December, or agree terms with them | Dana Reyes | 2026-11-12 | 24% of MRR, renewal 15 Dec |
| Re-forecast burn with the Kite Studio contract; decide whether the mobile beta waits | Dana Reyes | 2026-11-10 | $22,000/month, runway about 7.1 months |
| Add monthly retention and churn to the metrics export | Leo Park | 2026-11-30 | No retention column |
