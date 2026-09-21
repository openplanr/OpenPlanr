# Plan from an approved design package

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
filesystem transaction. Incomplete coverage must leave no newly generated plan
artifacts. Keep Protocol 1.7 spec, story, and task frontmatter unchanged.

The lineage sidecar is closed data: the exact approved package identity, target
`SPEC-NNN`, and one mapping for every package requirement with one or more
acceptance references and task IDs.

Do not copy full design bodies into planning artifacts. Plan records references
and concise acceptance language. Plan ends with a separate Ship invocation and
does not start implementation, release, publication, deployment, or Git actions.
