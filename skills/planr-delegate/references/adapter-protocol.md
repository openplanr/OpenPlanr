# Delegate profile and adapter contract v1

`planr-delegate` accepts explicitly enrolled, trusted local executables. The profile
store defaults to `~/.config/openplanr/delegate/profiles`, outside a repository and
outside task capsules. The directory is `0700`; each record is `0600`, at most
16 KiB, and expires after 30 days. The private runner's `profile-preview`
discovers the destination before enrollment; `profile-enroll` re-probes that
destination and stores the profile, or renews one with the same name. `profile-remove`
removes it. The runner warns in the last seven days and never renews automatically.
Never put credentials in a profile or a capsule.

Profile fields are `name`, `kind` (`claude`, `codex`, `cursor`, `generic`), `executable`,
`argv` (string array), `allowedEnv` (environment variable names only),
`workingDirectory: "worktree"`, and `destination: {class, origin}`. An origin is
an HTTPS origin or an HTTP loopback origin. A `local` class requires loopback;
an `external` class excludes it. Claude and Codex may add an absolute `configDir`.
The same Claude configuration and destination rules apply to every Claude profile
name. For example, the existing `claude-local` enrollment can use the `claude`
executable with its existing `configDir`; the runner sets `CLAUDE_CONFIG_DIR`.
For Codex, `configDir` becomes `CODEX_HOME`, so a local provider can use a
separate configuration without changing the user's normal Codex settings.
Credential environment names belong in `allowedEnv`; existing engine auth stores
remain private engine configuration. Never copy credential values into a profile,
capsule, run record or ordinary output.
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

Claude resolves the configured endpoint from supported settings and provider/auth
environment. Its stock vendor default is `https://api.anthropic.com`, disclosed
as external. Unmodelled provider routes such as Bedrock, Vertex or Foundry,
proxy variables and conflicting endpoints fail closed. Signed-in vendor use does
not mean local inference. Codex similarly resolves the selected provider,
`OPENAI_BASE_URL` or supported vendor default, then verifies the enrolled origin
and class. Config-altering CLI argv is not enrolled for built-ins.

Built-ins use structured noninteractive output and exact session identifiers.
Claude runs with restricted safe mode, no repository settings sources, an empty
strict MCP configuration, and only Read, Edit, Write, Glob and Grep. Bash is also
explicitly denied. The adapter retains the signed-in engine authentication while
excluding hooks, API-key helpers and project MCP execution. Codex uses
`workspace-write`, `approval_policy="never"`, empty `notify`, disabled web search
and disabled discovered MCP entries, including quoted configuration tables.
Engine configuration custody is rechecked before dispatch and exact resume;
repository engine settings changed by a delegate cannot execute on its next turn.

Claude's native file tools receive only the canonical capsule directory through
`--add-dir`. The capsule includes a digest-covered `readable/index.json` and
readable mirrors of every selected file, so ignored planning context requires no
Bash decoding. The adapter validates private regular capsule files and does not
add parent run/profile directories. This is a tool-access allowance, not an OS
read-only mount. The runner verifies capsule and mirror integrity after execution.

Codex shell tools run under its engine sandbox, which may permit reading host
user files beyond the worktree. Provider traffic and shell outbound networking
follow the selected engine's policy. Generic executables retain their ordinary
OS read/write/execute/network access. Only trusted profiles are supported; scope
limits accepted integration, not every operation of an untrusted process.

Prompts travel over stdin and every subprocess uses an argv array without a shell.
Codex events stream without retaining full command output; the adapter retains
only session/progress evidence, bounded final text and usage. Timeouts and
cancellation terminate the tracked process group, not only its direct child.
Operational results omit source bytes, prompt text and sensitive environment.

## Native Cursor

Cursor uses the normal signed-in `agent` CLI. Its profile requires
`trustNativeConfiguration: true`; the preview's `executionPolicy` discloses that
user/project hooks, plugins, managed team configuration and MCP remain active.
These extensions can execute and make additional requests beyond the enrolled
Cursor API origin. This is a trusted native configuration, not the isolated
Claude/Codex configuration. The adapter never edits global settings or copies
credentials.

The adapter pins `--sandbox enabled`, `--auto-review`, the exact worktree and
private capsule root, and the enrolled API endpoint. It uses stdin with
`--print --output-format stream-json`, persists the observed session, and resumes
only with `--resume <exact-id>`. No force/yolo or automatic MCP approval is used.
A successful native terminal envelope and a valid final assistant JSON message
are both required. Progress, tool output and concatenated envelope text are
discarded. Repository `.cursor`, `.claude`, `.codex` and `.mcp.json` configuration
is covered by worktree custody and cannot change before a subsequent turn.

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
