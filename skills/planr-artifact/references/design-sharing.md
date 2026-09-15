# Prepare a design's welcome before sharing

This step applies to `design-document.json` reviews. Generic HTML artifacts retain
their existing sharing behavior. The CLI publishes completed design revisions;
it does not author a welcome brief or infer requirements from project files.

Before every requested design share or publish, read the design document, supplied
brief, settled consultation answers and any existing sibling `review-context.json`.
Create the context file when missing. Write `brief.purpose` in one or two concrete
sentences about the product journey and the decision this review should inform.
Write up to three consequential questions in `brief.requests`, tied to actual
screens, authored alternatives or unresolved feedback. Do not copy another
project's text, invent requirements, or turn a guess into an approved decision.
Use `brief.audience` only when the intended reviewers are known.

With a thin brief, use the supplied journey and ask one concise question only
when a consequential review decision is missing. Reuse previous answers. If no
review question is supported, leave `requests` empty and report that limitation.
Preserve unrelated context, existing implementation guidance and settled wording.
Update an existing `revisionSummary` only with factual changes; never imply
approval or successful browser checks that have not occurred.

The required context structure is:

```json
{
  "kind": "openplanr-design-review-context",
  "schemaVersion": "1.0.0",
  "designId": "the-exact-id-from-the-design-document",
  "brief": { "purpose": "The purpose grounded in this design's brief.", "requests": [] },
  "implementation": { "tokens": [], "components": [], "responsive": [], "accessibility": [] }
}
```

Write actual content, not these placeholders. Empty implementation arrays mean
undocumented guidance. Keep any existing documented token values, component
states, responsive rules and accessibility requirements. Never copy local paths,
repository notes, credentials or an entire specification into shared context.

Open the design with `planr artifact <design-document.json>` after editing context;
the route validates and renders it. If it reports a draft error and falls back to
the previous working revision, fix that error before sharing the changed context.
When working through an installed design
skill instead, use its bundled `validate`, `render` and `open` utilities. Inspect
Welcome for the correct design title, purpose and review questions, then use the
explicit Share or Publish action. If browser inspection is unavailable, state
that the welcome is unverified. Changing the context file alone does not update
an already shared revision.

Older designs without context remain accessible through generic welcome guidance.
That fallback is not an authored project brief and does not complete this step.
