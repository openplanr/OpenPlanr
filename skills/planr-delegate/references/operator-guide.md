# Native onboarding and private helper inputs

Run `node <installed-skill>/scripts/runner.mjs <action>` with one JSON object on
stdin. The helper is private skill infrastructure, not a public `planr` command.

`probe` accepts `repositoryRoot` and optionally `engine` or `profile`. It discovers
`claude`, `codex` and Cursor's `agent` on PATH and checks compatible native event
streaming and exact continuation. Authenticate with the selected CLI's normal
login flow; OpenPlanr does not copy authentication tokens into its records.
Terminal-less hosts return an actionable unsupported-host diagnostic.

Native selection order is explicit engine/profile, saved choice, sole installed
engine, then a question if ambiguous. Missing CLIs are not installed automatically.
A provider hidden behind native configuration is shown as **native-managed**.
Do not infer local inference from a profile name or invent an endpoint.

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
Template failures require fixing the backend itself. OpenPlanr does not rewrite
messages/templates, load models automatically or silently change providers.

If a native CLI uses read-only permissions for non-interactive runs, delegation reports attention rather than enabling writes. Resolve access in that CLI’s own configuration or explicitly authorized exact-session invocation, then continue the recorded session. Model summaries are never sufficient evidence of implementation.
