---
name: planr-chair-review
description: "Synthesize an Operate cycle into a prioritized decision queue and action plan. Use after specialist reviews when leadership needs one coherent brief."
license: MIT
---

# Chair synthesis (`chair`)

Turn the available advisor and Challenger notes into a concise decision and action brief. Do not
repeat their repository searches or invent an absent lens.

## Context

Use `<cycle-dir>`, `<brief-path>`, `<output-path>`, and `<scope>`. List the cycle directory and read
the advisor notes and `challenger.md` that are present. If context is missing, state the exact gap
and its decision impact; continue when the remaining notes still support useful synthesis. Read the
selected roster from the scope or brief and label an intentionally unselected lens `omitted by
scope`; do not turn that omission into an issue or decision-changing gap.

Write only `<output-path>`.

## Synthesis standard

- Lead with the outcome that most affects the requested decision.
- Use `P0` for an immediate customer, production, legal, financial, or delivery concern; `P1` for
  the next important choice; `P2` for a watch item. Use `unranked` when context cannot order items.
- A decision states one recommendation clearly enough to compare with a credible alternative.
- An action includes a first step, expected result, practical check, dependencies, and revisit
  condition.
- Suggest a person or role only when supported; otherwise use `unassigned`.
- Carry material contradictions and downside, not every review comment.
- Reference source note IDs and direct project paths compactly.

## File contract

```markdown
# Chair synthesis — <cycle name>

> **Contract:** operate-review-quality-contract@2.0.0
> **Overall signal:** act now | decide next | watch | insufficient context
> **Executive call:** <what matters most and why>

## Decision queue

### D1 — [P0|P1|P2|unranked] <decision title>
- **Recommendation:** <clear choice>
- **Why now:** <consequence or opportunity>
- **Suggested owner:** <person, role, or unassigned>
- **Confidence:** high | medium | low — <reason>
- **Alternative:** <credible alternative and trade-off>
- **First step:** <smallest concrete start>
- **Expected result:** <observable result>
- **Check:** <how to assess the result>
- **Dependencies:** <IDs or none>
- **Revisit when:** <observable condition>
- **Sources:** <advisor finding IDs and direct project paths>
- **Dissent:** <Challenger exception IDs or none>

<At most five. If none: `No decision-ready proposal was established.`>

## Action plan

| ID | Priority | Action | Suggested owner | First step | Success measure | Check | Depends on |
|---|---|---|---|---|---|---|---|
| A1 | P0 | ... | ... | ... | ... | ... | D1 |

<At most seven. If none: `No proposed actions.`>

## Risks and dissent

- <Only an item that could change a decision or priority. Or `None.`>

## Decision-changing gaps

- **G1 — <gap>:** <decision affected and what would settle it>

<At most five. Or `None.`>

## Review coverage

| Lens | Outcome | Note | Informed |
|---|---|---|---|
| ... | reported / no material finding / omitted by scope / unavailable | `file.md` or `—` | D1 / watch / none |
```

The decision queue and action plan are the primary output. Keep source references selective and
unknowns specific to the decisions they affect.

## Optional quality check and return

When available, use this as a structural quality check:

```sh
planr operate validate-note "<absolute-output-path>" --profile chair --contract-version 2.0.0 --json
```

Use diagnostics to improve the note when useful and report any remaining structural issue.

Return overall signal, decision count, action count, output path, and any unresolved issue in at
most five lines.
