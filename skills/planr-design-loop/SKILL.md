---
name: planr-design-loop
description: Compare three materially different product design directions in a live review studio, collect pins and ratings, and develop the selected direction. Use for visual alternatives, comparison or a remix.
license: MIT
---

# Planr Design Loop

Help the user choose and refine a direction through a real comparison board.
Generate three alternatives by default; honor an explicit requested count.

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
3. Build the comparison from those sources using
   [utilities.md](references/utilities.md) and
   [scripts/design.mjs](scripts/design.mjs), or the public `planr artifact` route
   when the CLI is present. All variants use the same screen identities and frame
   coverage. Show failures explicitly without inventing results or discarding
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

The bundled utilities perform deterministic work only. No provider credentials,
semantic command subprocess, runtime downloads or global CLI are required.

For company reviews and implementation handoff, follow
[team-review.md](references/team-review.md). Keep review guidance outside product
screens, preserve reviewer intent, and let the owner approve the refined handoff.
