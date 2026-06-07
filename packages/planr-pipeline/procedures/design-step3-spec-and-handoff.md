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

  Next:  /planr-pipeline:plan <slug>
```

Then **STOP**. Do NOT run `/plan` or `/ship` (R1 + the design no-auto-chain clause in
`docs/rules.md`). The human reviews the artifact and the spec, then runs `/plan`.
