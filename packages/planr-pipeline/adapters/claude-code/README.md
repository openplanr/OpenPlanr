# Claude Code adapter

The native plugin keeps slash commands and tool-enforced agents. Runtime-specific
asset resolution stays in this adapter; procedures, registries, schemas, boards,
and deterministic state transitions come from the package root.

Artifact review always routes through `planr artifact`. Generic HTML uses the
headless `document` presentation by default; design boards and spatial variant
workflows use `canvas`. Private review sharing never publishes the artifact as a
standalone website.

## Guided Operating Board interaction

The adapter treats `interactiveQuestions: native` as a capability ceiling. It
uses the structured question surface only when the active host reports that
surface; otherwise it downgrades to structured chat, an attached terminal, or
a named handoff. It presents schema-valid CLI questions verbatim and returns
typed answers through the bounded stdin/resume lifecycle.

Every non-read-only action is a separate human choice. The adapter echoes the
exact CLI-returned confirmation digest and command, stops after that action,
and never converts a questionnaire answer or prior approval into broader
authority.
