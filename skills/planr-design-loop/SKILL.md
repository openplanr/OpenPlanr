---
name: planr-design-loop
description: Compare three materially different product design directions in a live review studio, collect pins and ratings, and develop the selected direction. Use for visual alternatives, comparison or a remix.
license: MIT
---

# OpenPlanr Design Loop

Help the user choose and refine a direction through a real comparison board.
Generate three alternatives by default; honor an explicit requested count.

Before consultation, run `openplanr design capabilities --json` and read the probe
and host tables in [utilities.md](references/utilities.md). Treat a successful
`openplanr design capabilities --json` as proof the runtime is ready. Never locate
or import the OpenPlanr workflow package, inspect `node_modules`, or call internal
runtime modules. The comparison board has no hosted canvas, so the host's artifact
tool does not replace it. At a stop, still consult and author the shared document,
every direction's sources and the specification, mark them **unverified** and
awaiting a board, and end with the stop's next action. On Claude Code, also offer
`/planr:design` to develop one direction on the hosted canvas.

1. Read [discovery.md](references/discovery.md) and
   [design-system.md](references/design-system.md). Inspect the brief, existing
   product, assets, reference screens, design document and previous preferences.
   Ask short, consequential unresolved questions through the host's native question
   surface, with one-question chat fallback. Reuse answers already provided.
2. Read [generation.md](references/generation.md) and
   [craft.md](references/craft.md). Define three distinct approaches to layout,
   hierarchy, typography and brand expression, all addressing the same journey.
   Keep the [document contract](schemas/design-document.schema.json) shared.
   Assign one direction per native agent in parallel when supported; otherwise
   create them sequentially in this active host session. Keep one owner for the
   shared document and final specification; agents write disjoint variant sources.
   That owner reads [team-review.md](references/team-review.md) and authors one
   sibling `review-context.json` before rendering. Ground its welcome purpose and
   up to three consequential review questions in the supplied brief and the
   directions' actual tradeoffs, without implying a winner or inventing requirements.
3. Build the comparison from those sources with the `openplanr design` commands
   in [utilities.md](references/utilities.md). All variants use the same screen
   identities and frame coverage. Show failures explicitly without inventing results or discarding
   completed variants. Canvas, Prototype and Walkthrough share one document and
   can be switched without regenerating content.
4. Inspect rendered screenshots and exercise each available direction's primary
   journey. Record concrete quality evidence; without browser inspection, mark
   the preview **unverified**. Read [review.md](references/review.md) for ratings,
   pins, selection and remix. Board feedback is authoritative for pins and ratings;
   chat may describe a broader remix but cannot impersonate a recorded board vote.
5. Apply the chosen direction and scoped changes while preserving unrelated
   screens, anchors, annotations and arrangement. Preserve the previous working
   revision. Record selected and rejected preferences locally with their reasons.
6. Use [handoff.md](references/handoff.md) and the
   [ten-section template](references/design-spec-template.md) to finalize the
   selected design, editable source, manifest and `design-spec.md`. If selection
   remains open, report the comparison as awaiting selection rather than implying
   a winner. Offer the studio's encrypted collaborative review when the user wants
   company feedback; before a requested share or publish, refresh, render and
   inspect the welcome context while preserving existing implementation guidance.
   Selection does not start Plan or Ship or authorize creating
   or sending a review link or deployment.

The `openplanr design` commands perform deterministic work only. They need no
provider credentials, semantic command subprocess or runtime downloads.

For company reviews and implementation handoff, follow
[team-review.md](references/team-review.md). Keep review guidance outside product
screens, preserve reviewer intent, and let the owner approve the refined handoff.

## Return

Lead with the comparison result or the direction still awaiting selection. Link
the working Studio and editable sources, plus the selected specification when
ready. Summarize the meaningful tradeoffs, actual checks and any unverified or
failed previews. Keep screen inventories, pins and ratings in their existing
artifacts; show the next selection or recovery action only when needed. Never
infer a winner from incomplete feedback or rerender just for summary wording.
