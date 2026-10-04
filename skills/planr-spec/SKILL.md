---
name: planr-spec
description: Shape vague product or engineering intent into a clear, measurable Protocol-compatible specification grounded in the current repository. Use when requirements need clarification before planning or implementation.
license: MIT
---

# OpenPlanr Spec

Shape vague product or engineering intent into a decision-complete
specification inside this active coding session. Do not invoke a planning CLI or
another model process.

## Ground the specification

Read the request, repository instructions, ADRs, product documentation,
existing planning artifacts, relevant implementation code and tests, stack
configuration, design inputs, database context, and current behavior. Infer
facts the repository already answers.

When a missing decision materially changes scope or observable behavior, use
the host's structured question interface. Ask no more than three short,
mutually exclusive questions at once and put the recommended option first. If
the host lacks that interface, ask one concise chat question. Do not present a
long prose questionnaire.

When native agents are available, use the specification role to consolidate the
contract and dispatch database or designer roles only when their lens affects
the decision. Otherwise perform those lenses sequentially in the active agent.

## Author directly

Read [the specification contract](references/specification-contract.md). Write
the specification to the repository's active planning layout, using a
project-global monotonic `SPEC-NNN` ID. Inspect the repository's existing
sequence and planning files before choosing it; never reuse a deleted ID.

Requirements and acceptance criteria must be observable. Put non-goals under
out-of-scope boundaries. Record concrete repository paths and verification
signals when they are known. Keep unresolved questions out of the saved
contract when a repository-backed default exists.

Validate the completed artifact before returning. If a helper is unavailable,
perform the same deterministic checks directly; never fall back to a
model-backed CLI.

## Return

Lead with what is ready, then use concise links and the checks actually performed.
If the specification is partial or blocked, name the missing decision and its impact.

- **Outcome:** what the specification now defines and whether it is ready for Plan.
- **Artifact:** a clickable saved path, or `not saved` for an explicitly inline result.
- **Decisions:** only consequential locked choices and grounded defaults; keep the full record in the specification.
- **Checks:** acceptance coverage and validation actually completed, including any unavailable check.
- **Open question:** only a decision that still changes the product; omit when
  none remains.
- **Next:** a copy-ready host-native `planr-plan` invocation for the saved spec.

The summary is a human view of the specification, not another schema or a reason
to rerun a completed operation for different wording.
