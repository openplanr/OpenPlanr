# Host-aware skill runtime

`@openplanr/skill-runtime` keeps host interaction and lifecycle behavior in code
instead of repeating it across generated prompts. Skills declare what they need;
the runtime selects a supported presentation without changing the workflow.

## Capability and interaction resolution

Protocol 1.6 host profiles declare an ordered interaction list. Codex and Claude
Code prefer a native structured question, then chat, terminal, and finally a
headless safe default. Cursor begins with chat; the pipeline profile begins with
terminal. A runtime report may narrow a declared capability to unavailable or
denied, but it cannot add a capability missing from the profile.

```js
import { resolveInteraction } from '@openplanr/skill-runtime/resolver';

const result = resolveInteraction({
  hostProfile,
  runtimeCapabilities,
  questions: [guidedQuestion],
  repositoryContext,
  session,
});
```

Interaction batches contain one to three Protocol guided questions. Exact,
non-sensitive repository context can answer a question without displaying it.
`visibleWhen` conditions stay available to an interactive host while their
source answer is pending, then only the branch activated by the bound answer is
required or included in the answer envelope. An informational-only batch
completes immediately and returns its active information without fabricating an
answer or selecting an input surface.
Headless mode uses only an explicitly declared safe default; it returns a typed
blocked result when a material answer is still required. Denied and unavailable
capabilities never become fabricated work.

Session identifiers and Protocol answer bindings are runtime plumbing. Skills do
not ask users to copy an identifier, digest, or confirmation phrase.

Host bindings are exact typed pairs: native uses `native-questions`, chat uses
`structured-chat`, terminal uses `attached-terminal`, and headless has no runtime
capability. Every interactive binding must name a capability declared by the
same profile, surfaces are unique, and headless—when present—is the final
fallback. Resolver consumers may pass either a complete digest-bound Protocol
skill session or unbranded legacy interaction metadata. A value branded
`kind: "skill-session"` must contain the complete Protocol document; partial
stubs are rejected by both the declarations and runtime validation.

## Presentation-only host overlays

Protocol host profiles may select overlay modules, but an overlay is never
appended as prompt Markdown. Its source is a closed `skill-host-presentation`
JSON document whose substitutions must be compiler-owned values for that host.
The compiler applies only those bounded wording or invocation substitutions and
attributes each changed byte range to the overlay source. Dependencies,
references, authority changes, and additional workflow, output, capability, or
effect fields fail lint and check with the same owner, path, and repair.

## Lifecycle defaults

```js
import {
  persistSessionProgress,
  recoverSession,
  resolveLifecycleSettings,
  startSkillInteraction,
  startSkillLifecycle,
} from '@openplanr/skill-runtime/lifecycle';
```

The default is local and quiet: learning, history, telemetry, remote sync,
automatic updates, and external-data collection are disabled. Learning,
telemetry, and external data require both configuration and an explicit guided
consent decision. Headless execution never invents consent.

The lifecycle composer receives the same project identity already bound to the
guided interaction session and forwards it to consent resolution. It does not
ask the user to provide or manage that internal value.

`startSkillInteraction()` is the consumer facade for a host run. It starts or
recovers the lifecycle session, passes the recovered question batch to the
existing interaction resolver, and supplies guided questionnaire metadata as a
separate binding. Its result contains the unchanged `lifecycle` and
`interaction` results; it does not add another decision or permission layer.

Recovery is best-effort. Compatible safe state resumes; closed, expired, stale-
question, private, malformed, or incompatible state starts a fresh internal
session with a short notice. Question identifiers, versions, and shapes are bound
to the checkpoint so an interrupted run cannot restore an obsolete interaction.
A checkpoint is never required to continue useful work.

`startSkillLifecycle()` composes environment detection, first-run guidance,
project-local configuration, compatibility, expiry cleanup, and recovery. State
is stored below `.planr/runtime/skill-sessions/`; Git repositories add that path
to their local exclude file without changing the project's tracked `.gitignore`.
If a safe ignored directory cannot be prepared, the skill continues in memory.

Every public state writer prepares and verifies the ignored project-local runtime
directory before writing. When that cannot be done safely, progress and settings
remain in memory and learning persistence is declined without blocking the skill.

`persistSessionProgress()` writes one bounded checkpoint atomically. Checkpoints
expire after seven days by default, are selected by skill rather than by a
user-supplied identifier, and are removed on expiry or explicit session close.
Configuration lives at `.planr/runtime/skill-runtime.json`; it controls local
preferences but never substitutes for explicit learning, telemetry, or
external-data consent.

Learning records accept concise redacted notes only, live below
`.planr/runtime/skill-learning.jsonl`, and cannot target canonical skill sources.
Raw prompts, artifact bodies, credentials, and secrets are rejected or removed.

## Effect boundary

Operation classification is diagnostic routing, not a second permission system.
Planning and read-only work stay local. Project writes, external effects, and
destructive effects are delegated to the host, whose normal safety controls remain
the only execution boundary. `executeAtEffectBoundary()` calls the selected local
or host executor exactly once. A missing executor returns a typed unavailable
result. Typed `completed`, `partial`, `blocked`, `unavailable`, and `cancelled`
results preserve their status and details; a host `denied` result remains visible
and maps to unavailable. A `completed` result is valid only when every reported
check passed and no unresolved issue remains; contradictory completion envelopes
are rejected at the boundary. Partial, blocked, unavailable, and cancelled
results may carry failed or unrun checks and actionable issues. Executor
exceptions propagate unchanged.
