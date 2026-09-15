# Bundled design utilities

Run the linked design helper from the skill entrypoint relative to the skill's
directory. It contains deterministic operations and all required assets. It needs
Node 20 or later, with no global CLI, provider credentials or runtime downloads.
Use `--help` to inspect the installed command interface before writing documents
or invoking operations; the installed contract is authoritative.

```sh
node scripts/design.mjs inspect <design-document.json> --json
node scripts/design.mjs validate <design-document.json> --json
node scripts/design.mjs render <design-document.json> --json
node scripts/design.mjs open <design-document.json> --view canvas --no-open --json
node scripts/design.mjs feedback <design-document.json> --action inspect --json
```

Use `--view prototype` or `--view walkthrough` to select the initial presentation.
When a `planr` CLI is available, prefer its public `planr artifact` route for
opening the document; otherwise use this bundled script. Both compose the same
design and artifact runtime, preserving feedback and view behavior.

Read the command's JSON result and use its actual artifact path and URL. Verify
server health and the loaded artifact before reporting a studio ready. If opening
the browser automatically is unavailable, open the returned local URL through the
host's browser tool. Do not claim browser readiness from process startup alone.

The helper also exposes `export`, `feedback` and `verify`:

```sh
node scripts/design.mjs export <design-document.json> --view prototype --format html --output <new-export.html>
node scripts/design.mjs feedback <design-document.json> --action export --scope all --format markdown --output <new-review.md>
node scripts/design.mjs feedback <design-document.json> --action export --scope current --format json --output <new-review.json>
node scripts/design.mjs feedback <design-document.json> --action select --variant <variant-id>
node scripts/design.mjs feedback <design-document.json> --action resolve --pins <pin-id>,<pin-id> --summary "Applied and checked the requested changes."
node scripts/design.mjs verify <design-document.json> --report <browser-report.json>
```

Portable HTML retains local assets and reviewable content. PNG capture uses the
studio's PNG action or an available browser screenshot facility. Do not rename
HTML output to `.png`. Export to a new path; existing files are preserved.

For feedback, inspect current state before selecting a variant or resolving pins.
Use stable IDs from returned state. For `verify`, submit a report from actual
browser checks and screenshots using `--report <report.json>`; never fabricate
evidence. If no browser is available, leave verification unverified and state why.

The same script exports `auditRenderedScreen` and `auditDesignPage` for a host with
a compatible browser automation page. After actually taking screenshots and
exercising the journey, use the helper to collect computed contrast, overflow,
image availability and focus findings. Supply the current revision, artifact
entries, real screenshot paths and exercised scenarios. A report includes
`revision`, `checkedArtifacts`, `screenshots`, `scenarios` (with observed statuses),
and `issues` (with severity). These exports do not install or start a browser, and
cannot replace visual inspection of the screenshots.

Missing/invalid source or assets, concurrent writes and failed generation must
return actionable errors while retaining the previous working revision. Follow
the reported recovery path; do not delete locks or replace feedback blindly.

## Permanent design sharing

Before sharing or publishing a design, follow [team-review.md](team-review.md) to
author or refresh its sibling `review-context.json`. Validate and render after
context changes, then inspect the Welcome content. These utilities publish the
completed revision; they never generate a project-specific welcome brief for you.

Use the studio's Share action after the user requests company review. It creates
a stable hosted link plus a generated access token that reviewers enter separately.
The design remains accessible when the local machine is offline. Owner authority
saves automatically in a protected user-level file outside the project; recovery
export is optional. Only copy the reviewer token through the explicit Share controls.

The bundled utility supports `share`, `publish`, and `sync` with the same design
document argument. `share` creates or retries a review, `publish` sends an explicitly
requested new revision to the existing URL, and `sync` retrieves authenticated
feedback. Run `--help` for access-management and recovery options. The public CLI
equivalents are `planr artifact share`, `planr artifact publish`, and
`planr artifact sync`. No global CLI is required for the bundled helper.

Retention is until the owner revokes or deletes the review, while the service is
maintained. The owner can pause comments and rotate access tokens. Rotation blocks
the old token and protects future content; it cannot recall downloaded content.
Never retry an uncertain operation by creating a different workspace: retain the
saved operation and use its retry path. Report service unavailability explicitly.

## Team review and handoff

`planr artifact handoff <design-document.json>` and the bundled
`node scripts/design.mjs handoff <design-document.json>` prepare or refresh a
factual review handoff. Use `--json` for structured results and consult `--help`
for inspection, update and approval actions. Follow [team-review.md](team-review.md)
for active-agent refinement and owner approval. These deterministic operations do
not call a provider, publish a design or start Plan/Ship.
