# Delegate profile and adapter contract (pilot v1)

`planr-delegate` accepts explicitly enrolled, trusted local executables. The profile
store defaults to `~/.config/openplanr/delegate/profiles`, outside a repository and
outside task capsules. The directory is `0700`; each record is `0600`, at most
16 KiB, and expires after 30 days. The private runner's `profile-preview`
discovers the destination before enrollment; `profile-enroll` re-probes that
destination and stores the profile, or renews one with the same name. `profile-remove`
removes it. The runner warns in the last seven days and never renews automatically.
Never put credentials in a profile or a capsule.

Profile fields are `name`, `kind` (`claude`, `codex`, `generic`), `executable`,
`argv` (string array), `allowedEnv` (environment variable names only),
`workingDirectory: "worktree"`, and `destination: {class, origin}`. An origin is
an HTTPS origin or an HTTP loopback origin. A `local` class requires loopback;
an `external` class excludes it. Claude and Codex may add an absolute `configDir`.
The same Claude configuration and destination rules apply to every Claude profile
name. For example, the existing `claude-local` enrollment can use the `claude`
executable with its existing `configDir`; the runner sets `CLAUDE_CONFIG_DIR`.
For Codex, `configDir` becomes `CODEX_HOME`, so a local provider can use a
separate configuration without changing the user's normal Codex settings.
Credentials remain environment values whose names are listed in `allowedEnv`;
the config may name an `env_key` but must not contain the key's value.
The name does not assert that inference stays local.

`probe` with a repository root reports readiness for all enrolled profiles.
`profile-preview` accepts a new declaration without `destination`, or an existing
name for renewal, and performs only read-only adapter and model-list probes.
Its public result omits argv, environment values, config contents, and task text.
`profile-enroll` requires the exact previewed `expectedDestination`; it probes
again and rejects a changed or unknown destination. A selected model is stored
in the profile. An unset model needs an explicit `allowBackendDefault: true`;
model choice is not repeated on each delegation. The preview does not create
a capsule or worktree.

`prepareProfile(name,{cwd,...})` loads and validates enrollment, resolves the effective
destination for the specified source checkout or worktree, and runs a read-only
capability probe before task content is sent. Built-in adapters require an
absolute `cwd`; a run or resume probes again against its actual worktree `cwd`.
It returns `{profile, destination, capabilities, adapter}`. The prepared
adapter rechecks the probe and destination immediately before `run` or `resume`.
Both accept `{profile,cwd,prompt,capsulePath,env,signal,timeoutMs}`; `resume` also requires
an exact `sessionId`. Both return `{status,sessionId,summary,question?,checks,issues}`
where status is `completed`, `blocked`, or `question`; a question has
`{text,options?}`. The runner owns prompt construction and run custody.

Claude inspects managed, user, project, and local settings along `cwd` and the
child environment for `ANTHROPIC_BASE_URL`. Codex inspects the user and project
config along `cwd`, including selected profiles and `openai_base_url`, plus
`OPENAI_BASE_URL` in the child environment. Any conflicting endpoint candidate
fails closed without guessing precedence. Config-altering CLI argv is not
enrolled for built-ins. Unresolvable defaults and provider-specific routes
such as Bedrock, Vertex, and Foundry fail closed until this resolver supports
them. A configured endpoint must exactly match the enrolled origin and class.
This is deliberately conservative: a product name or profile label does not
establish a data destination.

Built-ins probe `--help` without a task prompt, then use their structured
noninteractive output and exact session identifiers. `claude` launches with
`--print --output-format json` and resumes by `--resume <id>`; `codex exec`
uses `--json` events and resumes by `exec resume --json <id>`. Both receive the
task prompt on stdin. No command passes through a shell.

Claude's file tools require explicit access to a capsule outside its working
directory. The adapter rejects missing, symlinked, public, or non-regular
capsules and adds only the canonical directory containing that run's
`capsule.json` via `--add-dir`, on both run and exact-session resume. It does
not add the parent run or profile directory. This is a tool-access allowance,
not an OS read-only mount: enrolled executables are trusted, and the runner
checks the capsule's recorded digest after execution before accepting changes.

## Generic executable protocol

The executable plus its enrolled argv must support three additional flags:

| Flag | stdin | stdout |
| --- | --- | --- |
| `--planr-probe` | empty | one JSON probe object |
| `--planr-run` | one JSON request | one JSON terminal result |
| `--planr-resume` | one JSON request with exact `sessionId` | one JSON terminal result for that same session |

Every object contains `"protocol":"openplanr.delegate.adapter"` and
`"version":1`. A probe reports
`"capabilities":{"implementation":true,"structuredResult":true,"exactResume":true}`
and an effective `"destination":{"class":"local|external","origin":"..."}`.
A run request has `operation:"run"`, `prompt`, and `cwd`. A resume request
has `operation:"resume"`, `prompt`, `cwd`, and `sessionId`. Both may include
the exact absolute `capsulePath` as an additive v1 field. A wrapper that needs
to authorize reading the private capsule must use this field rather than parse
the human prompt; it must not broaden external write access. Terminal output
adds `status`, `sessionId`, `summary`, optional `question`, `checks`, and
`issues`. A resume output must retain the requested session ID. Incompatible
executables need a wrapper implementing this protocol; the runner does not
special-case vendor output.

The subprocess launcher uses argv arrays, bounded output and duration, and
supports AbortSignal cancellation. It discards stderr because some agents echo
prompts or secrets there. Operational errors contain stable codes and short
diagnostics, never the task prompt, raw environment, or stderr.
