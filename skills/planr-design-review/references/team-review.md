# Prepare a design for team review

## Author the welcome brief for this design

The studio follows this introduction with an optional reviewer profile step:
name, avatar color, and appearance. A reviewer can browse first and set a name
before commenting. Names are attached to comments; avatar color, theme, sidebar
widths, and canvas navigation are personal browser preferences. Do not author
those preferences into `review-context.json` or the shared product sources.
Verify the comment composer at different canvas zoom levels and keep reply drafts
intact when closing an editor or switching revisions.

For every newly authored design, create `review-context.json` beside
`design-document.json` before rendering. Before every requested share or publish,
read that file and refresh only the context affected by the current revision.
This is required authoring work in the active host session; the studio and sharing
service do not write the brief or infer it from project files. Follow the bundled
`schemas/design-review-context.schema.json` and use the exact document `id` as
`designId`.

Write `brief.purpose` as one or two concrete sentences about this product, the
journey being shown, and the decision the review should inform. Ground it in the
user's supplied brief, settled consultation answers, the current design and its
recorded open questions. Use `brief.audience` only when the intended reviewers are
known. In `brief.requests`, write up to three consequential review questions that
the visible design can help answer. Make them specific to the screens or choices
under review; do not copy another project's welcome text or fill a quota with
generic questions. For Design Loop, ask about the tradeoffs between the authored
directions without implying a winner. For Design Review, focus on the changed
journey and unresolved feedback while retaining still-relevant questions.

A thin brief is not permission to invent business goals, compliance rules,
audiences or approval criteria. Use the concrete journey already supplied; when a
consequential review decision cannot be inferred, ask one short question using the
host's native question surface or concise chat fallback. Do not ask again for
settled answers. If no review question is supported yet, keep `requests` empty and
report that limitation rather than presenting invented requirements as agreed.

Preserve existing implementation guidance, settled wording and unrelated context.
Keep `revisionSummary` factual: describe the current changes, without claiming
approval or browser verification that has not occurred. Publish only documented
token values, responsive rules, component states and accessibility requirements.
Never copy raw project paths, repository notes or an entire specification into
shared context. If a requirement is unknown, leave it undocumented rather than
presenting an inference as an approved requirement.

For example, if the supplied brief is a dispatch flow in which coordinators assign
crews and confirm deliveries, a minimal context can be:

```json
{
  "kind": "openplanr-design-review-context",
  "schemaVersion": "1.0.0",
  "designId": "fieldwork",
  "brief": {
    "purpose": "Review how coordinators assign crews and confirm deliveries before we scope implementation.",
    "requests": ["Is it clear which crew is assigned before confirming a delivery?"]
  },
  "implementation": {
    "tokens": [],
    "components": [],
    "responsive": [],
    "accessibility": []
  }
}
```

Replace the example identity and wording with this design's actual context. Empty
implementation arrays mean undocumented guidance, not a claim that the product
has no requirements.

Validate and render the document after editing context. Inspect the studio's
Welcome content for the correct design title, purpose and review questions before
sharing; browser inspection remains subject to the existing verification rules.
Only the rendered revision is published, so changing the file alone does not
update an existing shared review. Publish that revision only when requested.
Older designs without context remain reviewable with generic welcome guidance;
do not describe that fallback as an authored project brief or as completion of
this step.

## Keep guidance outside the product

Keep the product screens free of implementation commentary.
Use the existing design document and stable screen/variant/frame identities.
The studio renders the same sources in Canvas, Prototype and Walkthrough. Shared
reviewers see comments and pins, with developer inspection, ratings and refinement
controls omitted. The attached owner studio retains Review and Inspect as separate
pointer modes; Inspect reports authored guidance and bounded computed measurements,
not generated component code. Thumbnails are
navigation aids, not evidence that a screen was visually verified.

The review rail groups comments by screen, status and category. Read marks and
sidebar arrangements are personal. Treat Question, Suggestion, Request change and Blocker as reviewer intent. Request
change asks for a concrete modification; it is not automatic owner acceptance or a
blocker. Preserve older Fix comments without upgrading their severity. Category
labels accompany colors in both themes. Compact threads reveal replies on demand;
filtering and exports still cover all loaded comments.
Owner Accept, Defer and Decline dispositions describe planning intent; accepting
a suggestion does not resolve its pin. Resolve only after the affected revision
has been rendered and checked.

## Prepare and refine the handoff

When requested, run `planr artifact handoff <design-document.json>` or the bundled
`node scripts/design.mjs handoff <design-document.json>` utility. Both prepare a
factual draft from the recorded review; neither calls an AI model or starts Plan.
Read the utility's `--help` for the installed edit and approval interface.

Refine the draft in this active host session. Preserve comment quotations,
authorship, source revision and references. Separate accepted changes from
deferred/declined feedback and unresolved questions or blockers. Include affected
screens and verification gaps. Do not infer consensus from star ratings or an
author's display name. Identify contradictory feedback explicitly.

Return the concrete proposed handoff to the owner for approval. The owner approves
the exact content in the local board; an agent-written draft must never claim
approval. Approved snapshots remain recoverable. If the design, context, selected
direction or feedback changes, the handoff is outdated and must be reviewed again.
Keep `review-handoff.json` and its generated Markdown beside `design-spec.md`.

Plan reads this handoff on a separate invocation. It uses the existing ten-section
design specification and selected sources too; a review summary never replaces
the design specification. Sharing and publishing revisions also remain explicit
user actions and retain the existing review URL.

Canvas owns freeform artboard arrangement, pan, zoom and multi-direction comparison.
Prototype and Walkthrough fit one selected screen and responsive frame into the
viewer. Entering either view starts in Interact; reviewers explicitly choose
Annotate or Inspect when needed. Keep scrolling and gestures inside the authored
product native. Verify focused views after screen, device and sidebar changes,
including tablet drawers, and preserve the Canvas camera when returning to it.
