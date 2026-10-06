---
name: planr-challenger-review
description: "Challenge an Operate cycle's claims, alternatives, downside, and confidence. Use when assumptions or executive consensus need an independent stress test."
license: MIT
---

# OpenPlanr Challenger Review

Test only claims that could change a decision. A careful advisor note may pass without an
exception; do not create objections merely to make the review look busy.

## Context

Use `<cycle-dir>`, `<brief-path>`, `<output-path>`, and `<scope>`. Inspect the available `ceo.md`,
`cto.md`, `cpo.md`, `cmo.md`, and `coo.md` notes after the advisor pass. Do not read `chair.md` or
`board-report.md`. Use the selected roster in the scope or brief: an intentionally unselected lens
is `omitted by scope`, not unavailable, and creates no gap by itself. If a selected advisor note is
unavailable, record the decision impact rather than reconstructing that lens.

Write only `<output-path>`. Writes follow the host's normal permission rules; this skill
pre-approves nothing.

Invoked without `<cycle-dir>`, offer the most recent cycle under `.planr/operate/` that holds
advisor notes and use its `challenger.md` as the output path. When there is none, say so and point
to `planr-operate`; never create an empty cycle.

## Material exceptions

Report an exception when:

- a consequential claim lacks support or conflicts with stronger project context;
- multiple advisors repeat the same weak assumption as corroboration;
- a realistic alternative or dependency is missing;
- material downside or irreversibility is absent;
- confidence or comparative language exceeds the available context; or
- relevant qualitative context was dismissed only because ideal metrics were unavailable.

Do not challenge tone, formatting, harmless omissions, or a careful `Not established` statement.
Open original project sources only when needed to test a targeted material claim.

## File contract

```markdown
# Challenger review — independent-challenge

> **Contract:** operate-review-quality-contract@2.0.0
> **Verdict:** holds | holds with exceptions | not decision-ready
> **Bottom line:** <one sentence>

## Material exceptions

### X1 — <short title>
- **Target:** `<advisor file>#<finding or recommendation>`
- **Type:** unsupported | contradicted | correlated reasoning | missing alternative | unpriced downside | overconfident
- **Decision impact:** <choice that could change>
- **Challenge:** <concise explanation>
- **Sources:** <advisor sources and any direct contradicting path>
- **Resolution:** <smallest context or edit that settles it>

<At most five. If none: `No material exception found.`>

## Decisions that still hold

- <One line per advisor recommendation that remains usable, with its source ID.>

## Risks and dissent

- **Dissent:** <statement that must remain visible, or `None.`>
- **Resolution condition:** <observable condition>

## Decision-changing gaps

- <At most three gaps caused by unavailable or incomplete advisor context. Or `None.`>
```

Do not reproduce complete source inventories, the entire question rubric, or a second strategy
review. The Chair needs exceptions, surviving decisions, dissent, and resolution conditions.

## Optional quality check and return

When available, use this as a structural quality check:

```sh
node "<skill-root>/scripts/validate-note.mjs" "<absolute-output-path>" --profile challenger --contract-version 2.0.0 --json
```

Use diagnostics when useful and report any remaining structural issue.

## Return

Lead with the verdict and strongest established exception or surviving decision.
Link the output note and summarize exception/dissent counts, the evidence actually
consulted and any quality check performed. Keep the full challenge in the note;
identify incomplete context or unresolved dissent with its impact and resolution
action. Preserve the durable note shape and omit empty chat sections. Different
wording never requires another review or corrective run.
