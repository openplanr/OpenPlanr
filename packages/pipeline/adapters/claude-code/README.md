# Claude Code adapter

The native plugin keeps slash-command compatibility and host-native agents.
Canonical skills provide deterministic context, output conventions, and useful
diagnostics for the requested work.

Artifact review always routes through `planr artifact`. Generic HTML uses the
headless `document` presentation by default; design boards and spatial variant
workflows use `canvas`. Private review sharing never publishes the artifact as a
standalone website.

## Canonical skills

These package projections are generated from the workspace `skills/` source of truth:

- `planr-artifact`
- `planr-browser-qa`
- `planr-ceo-review`
- `planr-chair-review`
- `planr-challenger-review`
- `planr-cmo-review`
- `planr-coo-review`
- `planr-cpo-review`
- `planr-cto-review`
- `planr-dashboard`
- `planr-design`
- `planr-design-loop`
- `planr-design-review`
- `planr-diagram`
- `planr-doctor`
- `planr-investigate`
- `planr-land`
- `planr-operate`
- `planr-plan`
- `planr-plan-review`
- `planr-ship`
- `planr-spec`
- `planr-status`
- `planr-sync`

## Guided interaction

Infer reversible details from the repository. When a consequential decision
cannot be inferred, use Claude Code's native structured question surface; if it
is unavailable, ask one concise chat question at a time. Never dump a written
questionnaire on the user.

Spec, Plan, Plan Review, and Ship are guidance-first workflows. Planning-only
requests stop after the plan; implementation requests continue through the
relevant code changes and checks.

## Operate

The native `/planr-pipeline:planr-operate` skill copies
`skills/planr-operate/SKILL.md`. It scopes one review cycle with the human,
writes a single shared cycle brief, dispatches the five advisor lenses as
parallel subagents, then the challenger and the chair, and assembles a board
report from the files those lenses wrote. Each lens writes its own file and
returns only a short status summary, so no analysis is ever retyped through the
orchestrator. A lens that reports nothing is recorded absent and never filled in.
The board returns prioritized advice and concrete next actions. It does not
govern implementation or require a separate lifecycle decision.
