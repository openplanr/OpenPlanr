<!-- Default-mode inputs for planr-qa. -->

# Default-mode QA context

Use the feature name or paths supplied by the caller to locate relevant context:

- Task contracts: `output/feats/feat-{name}/us-*/tasks/task-*.md`.
- Parent context: the feature spec and user stories referenced by those tasks.
- Design context: `output/feats/feat-{name}/design-spec.md` when UI work exists.
- Stack commands and conventions: `input/tech/stack.md`.
- Prior failure notes: adjacent `T-*-error-report.md` files when relevant.
- Implementation evidence: the scoped diff, source, tests, and command output.

These are useful sources, not prerequisites. If an artifact is missing, use the
request and repository evidence that exists. Review only the relevant scope and
return the direct human-readable response defined by the loaded QA agent. Do not
write a QA report or change project state.
