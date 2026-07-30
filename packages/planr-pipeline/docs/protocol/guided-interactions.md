# Guided Interaction Protocol

Protocol v1.2 defines a runtime-neutral interaction layer for OpenPlanr
commands that require human input or explicit authority. OpenPlanr owns
question wording, validation, defaults, session state, previews, confirmation
digests, and mutations. Runtime adapters only present validated questions and
return typed answers.

## Contracts

The portable package exports strict validators for:

- `guided-question` and `guided-questionnaire`
- `guided-answer-envelope`
- `guided-session`
- `guided-confirmation`
- `structured-action`
- `evidence-diagnostic`

All records declare `protocolVersion: "1.2.0"`. Original questionnaires use
schema `1.0.0`; self-describing questionnaires use additive schema `1.1.0`.
The other guided records remain schema `1.0.0`. Unknown fields are rejected.
Question conditions are data-only comparisons; executable conditions are not
representable.

Schema 1.1 questionnaires include a digest-safe `submission` descriptor. It
provides exact argv tokens, stdin encoding and size, immutable envelope fields,
answer metadata and types, an exact `answers.copyFields` projection, and dynamic
sources for the questionnaire digest and runtime timestamp. The descriptor
participates in the questionnaire digest but refers to `/digest` by JSON pointer,
avoiding self-reference. A runtime copies only the declared answer fields, adds
the chosen value, and never serializes descriptor-only constraints such as
`required` or `valueType`. It therefore never guesses session, head, adapter, or
sensitivity metadata. Validators continue to accept unchanged schema 1.0
questionnaires.

Questionnaires and answers are bound to a command, project identity and heads,
questionnaire version and digest, expiry, and adapter identity. Session records
may persist only validated `public` or `internal` answers. Sensitive answers use
`persistence: "none"` and must be requested again after interruption.

## Presentation is not authority

Adapters declare `interactiveQuestions` as `native`, `chat`, `terminal`, or
`none`. This field describes presentation only. It cannot grant provider,
project-write, route, PLAN, SHIP, or external authority.

Structured actions classify effects:

```text
read-only | machine-local-write | project-write | provider-call | external-effect
```

Only confirmation-free read-only actions are valid. Every other action requires
an exact confirmation scope and digest. A questionnaire answer, prose
acknowledgment, prior `--yes`, or adapter capability cannot satisfy that
confirmation.

## Machine lifecycle handoffs

Guided questionnaires collect human answers; native advisor lifecycle handoffs
coordinate already-authorized, reversible runtime work. They are separate
Protocol contracts and neither can be used as authority for the other.
The selected cycle-start structured action supplies the governing confirmation
scope; a handoff carries that bounded lifecycle forward but grants no new
authority.

`operating-adapter-handoff` binds an adapter session to one cycle, evidence
snapshot, runtime, lease, idempotency key, and expiry. Its `next` array contains
only exact argv token arrays valid in the current state; `recovery` is separate.
Runtimes execute those arrays verbatim and submit advisor JSON only through the
declared bounded stdin contract. They never guess binding values, suffix an
idempotency key, parse prose next steps, or run `--help` to discover state.

The handoff is state-aware: `prepare-required`, `record-required`,
`finalize-required`, `continue-required`, or `cancelled`. After a role is
recorded, the next returned handoff removes that role's action. Resume is the
read-only recovery path for the same unexpired binding, cancel is a
machine-local cancellation, and the cycle-bound continuation returns control to
the public engine. Independent advisors and Chair remain separate phases.

The lifecycle uses the same effect vocabulary without weakening confirmation
rules: prepare/record/cancel are `machine-local-write`, resume is `read-only`,
and finalize is `project-write`. Continuation does not pre-authorize any later
`provider-call`, project mutation, or `external-effect`; the next structured
action must classify and govern that boundary independently.

## Safe evidence diagnostics

Evidence diagnostics may expose a policy-approved relative location and rule
category. They never contain raw values, excerpts, absolute paths, credentials,
or reversible value hashes. False-positive decisions bind the exact rule,
content digest, and project head and therefore expire on drift.

Use `validateGuidedInteractionArtifact()` for generic dispatch or the exported
contract-specific validators. `normalizeGuidedInteractionArtifact()` fills only
the fixed kind and version fields; it does not infer answers or authority.
