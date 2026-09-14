<!-- Spec-driven inputs for planr-qa. -->

# Spec-driven QA context

Use the supplied `SPEC_DIR` and task scope to locate relevant context:

- Task contracts: `<SPEC_DIR>/tasks/T-*.md`, excluding failure reports.
- Parent context: `<SPEC_DIR>/SPEC-*.md`, referenced stories, and Gherkin files.
- Design context: `<SPEC_DIR>/design/design-spec.md` when UI work exists.
- Stack commands and conventions: `input/tech/stack.md`.
- Prior failure notes: `<SPEC_DIR>/tasks/T-*-error-report.md` when relevant.
- Implementation evidence: the scoped diff, source, tests, and command output.

These are useful sources, not prerequisites. If an artifact is missing, use the
request and repository evidence that exists. Review only the relevant scope and
return the direct human-readable response defined by the loaded QA agent. Do not
write a QA report or change project state.
