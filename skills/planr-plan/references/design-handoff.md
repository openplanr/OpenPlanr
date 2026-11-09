# Plan from a design

For a completed Design handoff, read `design-document.json`, the selected
direction, and the authored ten-section `design-spec.md`. The specification lives
inside `design/` in spec-driven mode and beside `design/` in default feature mode.
For a studio-backed design, read its `.design/studio-state.json`: the recorded
`selectedVariant` is authoritative. Verify that the authored document and the
specification describe that same direction before decomposing UI work. If they
disagree, synchronize the design handoff using the settled choice or report the
specific unsynced inputs; do not silently plan the original preview direction.
A hosted design canvas handoff has no `design-document.json` or studio state:
its `design-spec.md` names the canvas URL and the local board sources, which are
the design inputs; read the boards rather than the hosted canvas.
Use stable screen IDs, component recipes, responsive frames, and interaction
flows as UI-task context. Read the current render's verification result and
unresolved feedback; carry relevant gaps into explicit task checks. Preserve
`finalized.json` compatibility inputs for older designs. Do not regenerate an
existing design or re-extract an authored specification from preview images.

When `review-handoff.json` is present beside `design-spec.md`, read its current
approval and freshness with
`openplanr design handoff <design-document.json> --action inspect --json`. Use approved, current
handoff items as additional planning context, retaining revision/comment links and
unresolved questions. When `openplanr` is not found, does not know `design`, or
reports `E_DESIGN_RUNTIME_MISSING`, treat the handoff as unverified evidence rather
than agreed scope, continue when the specification is decision-complete, and name
the install fix given in the Plan skill. An outdated or unapproved draft is evidence, not agreed scope;
report the changed inputs and obtain the missing decision only when it affects the
requested plan. Never silently substitute a newer draft for an approved snapshot.
A missing review handoff does not block ordinary planning from a clear specification.

When the request carries an approved implementation package, validate that the
package is still the current approved version before treating its numbered
requirements as scope. A missing package leaves ordinary Plan unchanged.

## Approved implementation package

An implementation handoff is optional Plan input. Ordinary planning from a clear
specification remains unchanged when no package is present.

Use only an exact package whose `status` is `approved` and whose current pointer
matches its `id`, `version`, and `contentDigest`. Draft, revoked, superseded, stale,
or unavailable packages remain useful evidence, but are not agreed scope. Report
the mismatch and continue from other authoritative inputs only when the request is
still decision-complete.

Treat each numbered `REQ-NNN` as a traceable implementation requirement. Preserve
its exact source references and verification intent while expressing it through
story acceptance criteria and task Test Requirements. Every package requirement
must map to at least one `US-NNN:AC-NNN` reference and at least one `T-NNN`. Every
mapped task must name the matching acceptance ID in its Test Requirements.

When an approved package is used, validate the entire decomposition before writing
the first target artifact. Commit the generated story/task bytes and the sibling
`design-lineage.json` with `writeDesignPlanningArtifacts` from
`planr-pipeline/design-lineage`.
The helper validates the Protocol 1.11 lineage, ordinary planning coverage, exact
package identity, repository-relative paths, and a recoverable all-or-nothing
filesystem transaction. A failed requirement-to-acceptance-to-task mapping writes nothing. Keep Protocol 1.7 spec, story, and task frontmatter unchanged.

The lineage sidecar is closed data: the exact approved package identity, target
`SPEC-NNN`, and one mapping for every package requirement with one or more
acceptance references and task IDs.

Do not copy full design bodies into planning artifacts. Plan records references
and concise acceptance language. Plan ends with a separate Ship invocation and
does not start implementation, release, publication, deployment, or Git actions.
