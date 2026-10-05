# Native onboarding and private helper inputs

Run `node <installed-skill>/scripts/runner.mjs <action>` with one JSON object on
stdin. The helper is private skill infrastructure, not a public `openplanr` command.
The equivalent stdin form includes `"action":"probe"` without a command-line
action. When both forms supply an action they must agree. Unknown actions return
the supported action list and usage.

`probe` accepts `repositoryRoot` and optionally `engine` or `profile`. It discovers
`claude`, `codex` and Cursor's `agent` on PATH and checks compatible native event
streaming and exact continuation. Authenticate with the selected CLI's normal
login flow; OpenPlanr does not copy authentication tokens into its records.
Terminal-less hosts return an actionable unsupported-host diagnostic.

Keep selection precedence: explicit engine/profile, saved choice, a sole
compatible native choice, then a question when the engine or profile remains
ambiguous. Without an explicit or saved selection, run `probe` with the repository
root and present both native defaults and saved profile choices. Group by engine
if the host limits question options, then ask for its default or saved profile.
Do not omit local-model profiles or manufacture duplicate aliases.

Label each choice with its engine, profile and configured model (or native default),
readiness and effective destination when the probe exposes it. Distinguish recorded
profile configuration from the effective result in this host's environment. A
provider hidden behind native configuration is **native-managed**; that does not
verify local inference. Do not infer routing from a name, a previously recorded
origin, or a probe in another host. If the user requests local execution and routing
is unknown or inconsistent, show the diagnostic and resolve the native configuration
before dispatch. Do not silently switch to a cloud default. Unavailable profiles
remain visible with their exact recovery action. Missing CLIs are not installed
automatically, and discovery does not establish that a backend is ready.
The runner blocks conflicting routes and concrete declared/effective destination
mismatches. Its diagnostic names the routing sources and safe origins, without
printing configuration contents or credentials. Resolve that conflict in the native
configuration and prepare a new preview; the helper does not strip routing variables.

## Prepare a run

```json
{
  "repositoryRoot": "/absolute/project",
  "engine": "codex",
  "request": "Implement the requested change and run the relevant checks.",
  "selectedFiles": ["src/example.ts", "tests/example.test.ts"],
  "scopePaths": ["src/example.ts", "tests/example.test.ts"],
  "retainWorktree": false
}
```

`taskSelector` can replace `request` when an exact planning task exists.
`selectedPaths` separately chooses dirty files to copy; other checkout edits remain
untouched. `preservePaths` adds immutable paths. The returned preview includes the
complete context inventory, owned worktree, configuration trust and pinned helper.
Use its runner/integration paths for this run even after a package update.
The context diagnostic separates encoded package size from decoded source bytes,
reports required and optional file counts and the largest sources, and includes
measured model capacity when available. It does not invent a tokenizer result or
task duration from model metadata. Narrow sources or split a large local task before
preparing it; all required files remain available in full, while optional background
is read when needed.

`prepare-worktree` accepts `runId` and `commands`, for example:

```json
{
  "runId": "returned-run-id",
  "commands": [
    {"executable": "npm", "args": ["ci"], "cwd": "."},
    {"executable": "npm", "args": ["run", "build:dependencies"], "cwd": "."}
  ]
}
```

Select prerequisites from the repository; this example is not a universal setup
recipe. Successful preparation is recorded once. Failed preparation is retryable.
Tracked preparation changes remain part of the review candidate.

## Optional profiles

A native profile is a convenience for a pinned model or alternate configuration:

```json
{
  "name": "local-model",
  "kind": "claude",
  "executable": "/absolute/path/to/claude",
  "argv": ["--model", "explicit-model-id"],
  "configDir": "/absolute/existing/configuration"
}
```

Use `profile-preview`, then `profile-enroll` to save a private v2 profile. It has
no renewal period. Do not put credential values in arguments or records. Native
configuration/environment is inherited, including trusted hooks, plugins and MCP.
The profile's explicit model stays pinned; an empty model selection preserves the
native default/automatic routing. Observed models are reported when events expose them.

Existing v1 profile files remain unchanged. They can supply an explicit selection
for a new native v2 run; retained runs still use their original pinned helper and
policy. Saving over a legacy native profile is refused; use a new optional name.
Experimental generic adapters retain their versioned enrollment/protocol.

Local server/model/authentication probes are diagnostic and send no task content.
They use bounded, authenticated read-only model metadata requests; model load
state is reported only when the backend exposes it. They never load a model or
submit a completion automatically. An unsupported metadata endpoint remains
unverified rather than proof that native execution cannot work.
Template failures require fixing the backend itself. OpenPlanr does not rewrite
messages/templates, load models automatically or silently change providers.
When changing a local model, use the exact model ID advertised by that backend;
a GGUF filename or display label is not automatically its request ID. Apply an
explicit model override only to this run through the existing native options;
rewrite or enroll a saved profile only when the user requests it.

If a native CLI uses read-only permissions for non-interactive runs, delegation reports attention rather than enabling writes. Resolve access in that CLI’s own configuration or explicitly authorized exact-session invocation, then continue the recorded session. Model summaries are never sufficient evidence of implementation.

## Diagnostics and unused runs

`dispatch` and `resume` return the retained diagnostic directly, including safe
native failure reasons, reported HTTP status and the known destination. They do
not copy arbitrary tool output or credentials into public results. Check routing
before signing in again after an authentication failure. A changed selection
reports its before/after values or named routing candidates and requires a fresh
`prepare`; no substitute session or provider is selected.

`status` and `wait` report live execution duration and the latest observed native
event. Tool names and safe file references are evidence of activity, not proof
that the task is complete. Missing events remain unavailable; the helper does not
scan unrelated native transcripts.

`abandon` accepts `runId` and optional `runDirectory` for a run that never executed.
It closes the private record and removes only an owned, unchanged worktree. Active
processes, retained sessions, setup/verification work, changed custody and unknown
or modified files require inspection and remain retained. Repeating a successful
abandon is safe. Existing sessions continue through their original pinned helper;
new commands do not retroactively replace retained code.
