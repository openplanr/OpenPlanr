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

Read the files the request names, plus `AGENTS.md` and `CLAUDE.md` when tracked,
in one batch. Expand only for a missing contract, a dependency or a contradiction,
and stop when each claim has evidence or a named gap. Infer facts the repository
already answers.

When a missing decision materially changes scope or observable behavior, use
the host's structured question interface. Ask no more than three short,
mutually exclusive questions at once and put the recommended option first. If
the host lacks that interface, ask one concise chat question. Do not present a
long prose questionnaire.

If no one can answer, as in a headless run, do not ask: choose the
repository-backed default, or the recommended one when the repository does not
settle it, and record each such choice as a bullet starting `Assumption:` under
`## Notes for Decomposition`, naming the decision and the alternative not taken.
Record a decision you settle inside a functional requirement the same way.

When native agents are available, use the specification role to consolidate the
contract and dispatch database or designer roles only when their lens affects
the decision. Otherwise perform those lenses sequentially in the active agent.

## Author directly

Read [the specification contract](references/specification-contract.md). When the
repository has no `.planr/`, write the specification where it already keeps
specifications, or return it in chat or one file when it keeps none. With
`.planr/`, write it to the active planning layout using a project-global monotonic
`SPEC-NNN` ID: inspect the existing sequence and planning files before choosing it
and never reuse a deleted ID.

Requirements and acceptance criteria must be observable. Put non-goals under
out-of-scope boundaries. Record concrete repository paths and verification
signals when they are known. Keep unresolved questions out of the saved
contract when a repository-backed default exists.

Validate the completed artifact before returning: run `openplanr spec validate <SPEC-ID>`
when the specification is under `.planr/` and `command -v openplanr` succeeds, otherwise check the path, frontmatter,
headings and acceptance IDs against the specification contract directly. Never
fall back to a model-backed CLI.

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

Follow [the shared return rules](references/return-contract.md).
