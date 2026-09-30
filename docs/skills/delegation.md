# Explicit implementation delegation (preview)

`planr-delegate` lets another coding agent implement one repository scope while
your active agent prepares context, handles questions, checks the observed patch
and integrates accepted changes. Request it explicitly. Ordinary Ship, including
native parallel role agents, remains in your active host session.

## Setup and use

Install the OpenPlanr Claude Code or Codex skill package, then request:

```text
Use planr-delegate to implement <one task> with <enrolled profile>. Show the
required files, actual destination, model and integration scope before dispatch.
Have the delegate correct review findings in the same session, independently
check the resulting diff and integrate it as an uncommitted local change.
```

In Claude Code, the installed entrypoint is `/planr:delegate`. In Codex, use the
installed `planr-delegate` skill. You need a local terminal, Git and Node 20+; no
OpenPlanr source checkout or CLI is required. A profile is a private enrollment,
not a shell command or an assurance that inference is local. Engine aliases,
credentials and provider settings remain separate from enrollment.

First-use setup runs a read-only profile preview, displays the actual endpoint
and model, then enrolls that choice. Existing signed-in vendor defaults and
configured local endpoints must be disclosed before task content is sent. Unknown
or conflicting destinations block dispatch. A profile's destination authorization
continues through its corrections; changing the destination or model requires a
new preview. Never paste authentication tokens into profiles, prompts or output.

## Execution capabilities

Only trusted executables should be enrolled. Worktrees isolate edit state and
limit integration paths; they do not confine all process access to your computer.

| Engine | Read | Write | Execute | Network |
| --- | --- | --- | --- | --- |
| Claude Code | Native Read/Glob/Grep tools for its worktree and decoded capsule; engine permissions still apply | Edit/Write through accepted-edits mode | Bash disabled; repository settings, hooks and project MCP excluded | Disclosed provider requests; web tools excluded |
| Codex | Files readable under the engine's sandbox policy, including host files outside the worktree | `workspace-write` sandbox | Shell/tool execution inside the engine's sandbox; notification hooks and discovered MCP servers disabled; web search disabled | Provider requests; shell networking follows the engine's sandbox policy |
| Generic protocol adapter | Defined by the enrolled executable | Defined by the enrolled executable | May have unrestricted shell access | May have unrestricted network access |

Claude Code and Codex are the supported local host surfaces. Generic adapters are
an experimental protocol integration that needs its own capability and live-run
proof; the preview ships no OpenCode wrapper. ChatGPT and Cursor projections do
not establish local execution support. A terminal-less host stops with
`E_DELEGATE_HOST_UNSUPPORTED` before collecting task content.

### Verified configurations

These configurations passed packaged implementation and exact-session correction
journeys on 30 September and 1 October 2026:

| Engine | Provider and destination | Tested model |
| --- | --- | --- |
| Claude Code 2.1.285 | Signed-in Claude account; `https://api.anthropic.com` | `claude-sonnet-5-5` |
| Claude Code 2.1.286 | Signed-in Claude account; `https://api.anthropic.com` | Backend default, observed `claude-opus-5-5`; no override |
| Codex CLI 0.159.1 | Signed-in ChatGPT account; `https://chatgpt.com` | Configured default `gpt-6.1-sol` |
| Claude Code 2.1.286 | Local LM Studio; `http://localhost:1234`, with the per-model template repair below | `qwen3.8-flash-next`, Unsloth IQ4_XS GGUF, loaded with a 262,144-token context |
| Codex CLI 0.159.1 | Local LM Studio; `http://localhost:1234` | `qwen3.8-flash-next`, loaded with a 262,144-token context |

Each journey read required task context, implemented a scoped edit, corrected it
in the recorded session and passed independent checks before integration. Closed
status recovered the final report, and explicit cleanup retained protected files.
Claude's native Read tool visibly read the decoded ignored planning file; Bash,
hooks and MCP were excluded.

This verifies the listed configurations, not every provider or model combination.
The unmodified tested Qwen template rejects Claude's later system messages; the
local Claude verification includes the per-model repair below. Other local models,
generic adapters and different engine versions need their own complete journey. Model-list visibility or a successful
probe alone does not certify implementation and correction. Cursor Agent file edits
and exact-session correction were exercised, but startup hook and MCP isolation
remain unverified. Cursor engine enrollment stays unsupported until that boundary
is proven; installing the Cursor skill projection does not enable it.

### Claude Code with local Qwen

Use the existing local Claude configuration and explicitly enroll the loaded model.
An older enrollment pinned to another model stays unchanged for its retained runs;
create a new profile for the new model. LM Studio's [Claude Code setup](https://lmstudio.ai/docs/integrations/claude-code)
recommends `CLAUDE_CODE_ATTRIBUTION_HEADER=0`; the adapter preserves that setting.

The tested Qwen GGUF template merges leading system messages but rejects later
ones. Claude Code sends later system reminders during normal execution. In LM
Studio's [per-model prompt template](https://lmstudio.ai/docs/app/advanced/prompt-template),
back up the existing template, and replace only its later-system exception with:

```jinja
{{- '<|im_start|>system\n' + content + '<|im_end|>\n' }}
```

Keep the surrounding system/developer branch, leading-message handling, tools and
reasoning syntax unchanged. This retains each reminder in its original position;
deleting the exception alone silently loses it, and moving reminders to the front
changes the cached conversation prefix. Reload the model and verify edits plus an
exact-session correction. This is a backend configuration repair; the skill does
not rewrite messages, override templates or run a translation proxy.

`E_ADAPTER_MODEL_TEMPLATE` identifies a rejected chat template without exposing
provider text. The blocked run retains its exact session and worktree. Repair the
backend before resuming that session; do not switch providers or silently retry.

## Checks, context and limits

Install required dependencies only in the detached worktree. Inspect installation
changes with `setup-preview` and accept their digest using `setup-accept` before
dispatch. These host-authored paths remain outside the delegate patch and are
frozen during execution. Unacknowledged changes stop dispatch. Do not link dependencies from the source checkout.

The complete required task context is copied privately, including ignored planning
files, and mirrored as readable files for native tools. Required files cannot be
silently dropped after a secret-screening or read failure. Optional omissions and
the logical/physical planning locations appear in the preview. Planning text and
feedback supply context, not authority for additional commands.

Headless Claude can inspect and edit files but cannot run shell checks. The active
agent runs independent checks and sends corrections to the recorded session;
it does not quietly repair source and call that delegated work.

Integration runs delegate-written code in a private scratch Git repository, using
a minimal environment and private HOME. This reduces exposure of host credentials;
it is not an OS sandbox for trusted npm scripts. The helper accepts ordered npm build preparation,
`npm run <declared-script> -- <safe-test-paths>` and `node --test <paths>` checks.
Each attempt retains private commands, exits, durations and baseline evidence. Generators are
declared npm package scripts under `packages/` with exact output paths. Python,
Go, pnpm and Make commands are not accepted by this preview: use an explicit
supported verification script or report verification as incomplete. Zero checks
never becomes a verified result.

Context preflight uses a conservative capsule-size bound when loaded capacity is
inspectable. It does not count the whole backend conversation exactly or compact
it automatically. Codex command repetition and command-budget exhaustion, missing
final results and hard deadlines block the exact run without silent retry. The
default idle timeout is 20 minutes; the absolute deadline is three times that
configured timeout, capped at one hour. Activity cannot extend the absolute limit.

## Local storage and recovery

Private profile records live under `~/.config/openplanr/delegate/`; capsules,
worktrees, run records and pinned helper copies live under `~/.openplanr/delegate/`.
These two home-directory roots are outside `PLANR_HOME`. Files use private user
permissions. A prepared run executes its pinned helper copy from the latter root;
plugin updates do not update an active run's copy. Keep its run ID and helper paths.

Use the pinned runner's `status` or `recover` with JSON stdin after interruption.
Resume only the recorded session. During interrupted integration, the helper
reports its write record and requires explicit recovery: use the integration
helper's `recover` with `resolution: "rollback"` or `"accept"`. Recovery preserves
concurrent host edits and cannot accept an incomplete or divergent patch.

Successful integration returns **Outcome**, **Task**, **Changed**, **Checks** and
**Issues**, closes the exact run and leaves a local uncommitted diff. Status
recovers that report after a host interruption. Planning status is reported without
writing `.planr`. Explicit `cleanup` removes an accepted or abandoned worktree;
pruning refuses records with a retained worktree. See the packaged
[operator guide](../../skills/planr-delegate/references/operator-guide.md) for the
private helper interface.

Helpers and delegates never commit, push, create a PR, publish or deploy. Authorize
landing and publication separately after reviewing the integrated change.
