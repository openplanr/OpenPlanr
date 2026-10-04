---
name: planr-investigate
description: "Diagnose a bug, regression, error, or unexplained behavior and optionally implement a bounded fix. Use for root-cause investigation, not planned feature delivery."
---

# OpenPlanr Investigate

Find the cause before proposing a fix. Use the request, repository, runtime output, and focused
experiments as context. Keep the investigation lightweight and make every diagnostic useful to
the requested outcome.

## Investigate

1. Restate the observed failure and the smallest reproducible case.
2. Trace the relevant call path, state, configuration, and recent changes.
3. Form competing hypotheses and run the cheapest discriminating checks first.
4. Identify the root cause only when the observations distinguish it from plausible alternatives.
5. Report exact errors and unavailable tools without prescribing a workflow ceremony.

## Fix when requested

When the user asked for a fix, implement the smallest coherent correction within the requested
repository and run focused regression checks. Preserve unrelated work. Ask only when a missing
product decision or an irreversible external action genuinely blocks progress.

## Return

Lead with the established cause or clearly labeled remaining hypothesis. Link
changed files and relevant evidence, and distinguish executed checks from source
inspection. For a blocked experiment, state what remains known and the exact
next diagnostic or recovery action. Preserve the detailed investigation in its
existing report rather than returning raw tool transcripts.

- **Cause:** established root cause, or the strongest remaining hypotheses.
- **Change:** files and behavior changed, or none for diagnosis-only work.
- **Checks:** commands and results.
- **Issues:** unresolved uncertainty or blocker, or none.

Omit empty sections in the human summary. Different wording does not justify
another experiment or corrective run.
