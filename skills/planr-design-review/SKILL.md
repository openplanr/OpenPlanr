---
name: planr-design-review
description: Review and revise an existing product design using stable board pins and scoped browser-verified changes. Use for focused improvements while preserving unrelated screens and feedback.
license: MIT
---

# Planr Design Review

Improve the existing design in this active host session, retaining the user's
intent and recorded feedback.

1. Read [review.md](references/review.md), then inspect the existing design
   document, authored sources, specification, manifest, prior revision and board
   feedback using [utilities.md](references/utilities.md) and
   [scripts/design.mjs](scripts/design.mjs). Legacy HTML, canvas and image artifacts
   remain reviewable; preserve originals and distinguish static images from
   working interaction. Preserve the [document contract](schemas/design-document.schema.json).
   Use the public `planr artifact` route when available.
2. Consult [discovery.md](references/discovery.md) only for missing context or
   consequential ambiguity. Read the project's components and tokens using
   [design-system.md](references/design-system.md). Ask through native structured
   questions with concise chat fallback; do not ask again for settled decisions.
3. Map pins to stable screens and anchors. Report missing or stale targets as
   unresolved rather than attaching them elsewhere. Chat may request broad
   changes; board state remains the pin/rating authority. State shared-component
   scope before updating every affected instance.
4. Apply changes only to the targeted source or component, following
   [generation.md](references/generation.md) and [craft.md](references/craft.md).
   Keep unrelated screens, identities, feedback and arrangement intact. Stage a
   complete revision; a failed revision preserves the last working studio.
   Read [team-review.md](references/team-review.md) and update the sibling
   `review-context.json` for the changed journey and unresolved review questions.
   Create it when missing. Ground the welcome purpose and up to three consequential
   questions in the supplied brief and recorded feedback; preserve still-relevant
   wording and implementation guidance, and never invent requirements.
5. Inspect revised screenshots at affected responsive frames, exercise the
   changed journey and keyboard focus, and record evidence. Resolve pins only
   after the relevant change is rendered and checked. A static lint pass does not
   establish visual verification; absent browser inspection means **unverified**.
6. Synchronize the specification, document and compatibility manifest using
   [handoff.md](references/handoff.md) and the
   [ten-section template](references/design-spec-template.md). Update only affected
   specification sections. Record retained and rejected project preferences.

Return applied feedback and affected screens, remaining/stale pins, source and
studio paths, and verification results. Plan is an optional next invocation.
Opening, revising or selecting a design never auto-starts Plan, Ship, publication,
deployment, review-link creation or review-URL import. When company review is
requested, validate, render and inspect the current welcome context before using
the studio's encrypted Share flow. Preserve reviewer attribution.

For company reviews and implementation handoff, follow
[team-review.md](references/team-review.md). Keep review guidance outside product
screens, preserve reviewer intent, and let the owner approve the refined handoff.
Only an explicit **Continue to Plan** action may return the host-native Plan
invocation for the current approved package. Preparing or approving a package
does not write planning files, dispatch an agent, change Git, or start Ship.
