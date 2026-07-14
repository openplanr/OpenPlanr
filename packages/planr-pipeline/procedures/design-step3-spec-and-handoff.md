# Procedure: /design Step D — design-spec.md + Completion Contract + STOP

> Read by `commands/design.md` Step D. Authors the machine-readable design intent that
> closes the loop, then stops for human review (R1). One writer per run.

## D.1 — Author design-spec.md (one-writer precedence, SPEC-015 E2)

- **If `HAS_PNG`** (the user has mockups, `source == png`): do NOT write `design-spec.md`
  here. It is `designer-agent`'s job during `/plan` (vision extraction from the PNGs). This
  command produced only the visual artifact. Skip to D.2.
- **Else** (generating from spec/brief): author `design-spec.md` directly — never by
  re-reading the pixels you just generated (that round-trip is lossy; SPEC-015 F1). Fill the
  shared 10-section template `agents/modes/shared/design-spec-template.md` from the spec /
  brief. Write to the mode's design-spec path:
  - spec-driven: `<SPEC_DIR>/design/design-spec.md`
  - default: `output/feats/feat-${SLUG}/design-spec.md` (existing flat path — unchanged)
- Set `content_provenance` in `finalized.json` to `inferred` when the spec was thin and
  Section 10 (Open Questions) carries inferred-not-specified decisions; otherwise `spec`.

## D.2 — Release the lock

Delete `<DESIGN_DIR>/.design.lock`. (Also delete it on any fatal abort earlier in the run.)

## D.3 — Completion Contract (verify on disk — you are not done until all pass)

- [ ] artifact exists: `<DESIGN_DIR>/finalized.html` (prototype/walkthrough) or
      `<DESIGN_DIR>/canvas.html` + `<DESIGN_DIR>/vendor/DesignCanvas.js` (canvas)
- [ ] `<DESIGN_DIR>/finalized.json` exists and validates against
      `schemas/v1.0.0/design-manifest.schema.json`
- [ ] required `vendor/` runtime copied alongside the artifact
- [ ] `design-spec.md` exists at the mode path **OR** `HAS_PNG` precedence was applied
      (noted in the summary)
- [ ] no `.finalized.tmp.*` left behind; `.design.lock` removed

If any checkbox fails, abort via `fatal-error-format.md` — do not print the handoff.

## D.4 — Handoff (SPEC-015 F10 / DX-F6) + STOP

Print a deliverable handoff, not a file-write log:

```
✓ Design ready — <slug>  (<format> · <SCREEN_COUNT> screens · <reason for format>)

  Open:  file://<abs path to finalized.html|canvas.html>
  Spec:  design-spec.md authored → UI tasks will now generate
         (or: design-spec.md left to designer-agent — you have PNG mockups)
  Git:   committing design-spec.md + finalized.json; the rendered preview + vendor/
         runtime are gitignored (build output) — delete <DESIGN_DIR>/.gitignore to track them

  Review locally (optional): planr artifact <abs artifact path>
  Share (optional, explicit): planr artifact share <abs artifact path>
  Import returned feedback:   planr artifact import "<returned-review-url>"

  Next:  /planr-pipeline:plan <slug>
```

The optional review commands are independent of the workflow handoff. Do not run `share`
unless the user explicitly chooses it; opening/completing the design never publishes or uploads
the artifact. Importing a returned review URL is likewise explicit and does not run `/plan` or
`/ship`.

**Standalone designs** (`DESIGN_DIR` under `.planr/designs/<slug>/` — the user chose
"Standalone exploration" at A.2): there is no spec, so the loop does **not** close yet.
Replace the `Next` line with: *"standalone exploration — no spec; to build it, run
`/planr-pipeline:plan <slug>` (scaffolds its own spec) or re-run `/planr-pipeline:design
<slug>` and choose **Create a spec**."* Do not claim "UI tasks will now generate" for a
standalone design — its `design-spec.md` lives outside `.planr/specs/` and is not consumed
until promoted to a spec.

Then **STOP**. Do NOT run `/plan` or `/ship` (R1 + the design no-auto-chain clause in
`docs/rules.md`). Do not invoke Share automatically. The human reviews the artifact and the
spec, optionally shares/imports through the explicit commands above, then runs `/plan`.
