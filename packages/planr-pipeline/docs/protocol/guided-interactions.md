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

All records declare `protocolVersion: "1.2.0"` and
`schemaVersion: "1.0.0"`. Unknown fields are rejected. Question conditions are
data-only comparisons; executable conditions are not representable.

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

## Safe evidence diagnostics

Evidence diagnostics may expose a policy-approved relative location and rule
category. They never contain raw values, excerpts, absolute paths, credentials,
or reversible value hashes. False-positive decisions bind the exact rule,
content digest, and project head and therefore expire on drift.

Use `validateGuidedInteractionArtifact()` for generic dispatch or the exported
contract-specific validators. `normalizeGuidedInteractionArtifact()` fills only
the fixed kind and version fields; it does not infer answers or authority.
