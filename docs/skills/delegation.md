# Explicit implementation delegation (preview)

`planr-delegate` lets a second coding agent implement one coherent repository
scope while your active agent prepares context, handles questions, runs checks,
reviews the observed diff and integrates accepted changes. It is opt-in: ordinary
Ship, Spec, Plan, Review and Operate keep their existing host-native behavior.

In a terminal-equipped Claude Code session, request:

```text
/planr:delegate Implement <one task> using <enrolled profile>. Show the selected
files, effective destination, model and integration scope before dispatch. Have
the delegate implement and correct the change, then independently check and
review it. Integrate accepted changes as an uncommitted local diff.
```

In Codex, use the installed `planr-delegate` skill for the same explicit request.
The skill works from its installed resources without an OpenPlanr source checkout
or CLI. It guides first-use profile setup when necessary; a profile is an enrollment,
not a globally installed shell command. Engine aliases and provider configuration
remain the user's own settings.

## Compatibility and limits

The preview supports local Claude Code and Codex hosts with a terminal, Git and
Node 20 or later. Trusted enrolled backends may use Claude, Codex or the versioned
generic adapter protocol. ChatGPT or Cursor projections do not establish local
execution support; a host unable to run the helper reports
`E_DELEGATE_HOST_UNSUPPORTED` before collecting task content.

The profile preview shows the actual endpoint and selected model. A local-sounding
name does not prove local inference. Local loaded-state APIs can confirm a model
is loaded; providers without such an API remain unverified. Each provider/model
combination needs an observed implementation and exact-session correction journey.
A disposable Qwen3.8 Flash Next run through Codex completed implementation,
exact-session correction and verified integration. Its first handoff reached the
absolute deadline before returning a final result; the retained session completed
after an explicit correction. This is evidence for that tested configuration,
not a guarantee for other tasks or model settings.

Context preflight uses a conservative capsule-size bound when loaded capacity is
inspectable. It does not count the complete backend conversation exactly or
automatically compact it. Repeated Codex commands, command budget exhaustion,
missing final results and a hard deadline block the exact run. These controls
limit wasted work; they do not guarantee local-model quality. The default idle
timeout is 20 minutes. The absolute deadline is three times the configured idle
timeout, capped at one hour, and progress cannot extend it.

The worktree isolates the starting edit state and the recorded scope limits what
can be integrated. It is not a filesystem sandbox. Use trusted executables and
profiles. Credentials stay in the backend's existing environment/configuration;
never paste them into a profile, prompt, capsule or ordinary command output.
Required context cannot be silently dropped after a secret-guard failure.

Headless Claude delegates can inspect and edit files but cannot run shell checks.
Your active agent runs those checks and sends failures back to the exact session.
It does not quietly repair the delegate's source and label it delegated work.

## Recovery and finish

Runs retain their private capsule, versioned helper and worktree under
`~/.openplanr/delegate/`. Keep the returned run ID and pinned helper paths. Use
that runner's `status` or `recover` action with JSON standard input; resume only
the recorded backend session. The packaged
[operator guide](../../skills/planr-delegate/references/operator-guide.md)
describes these private helper actions and safe first-use enrollment.

Successful integration closes the exact run and returns **Outcome**, **Task**,
**Changed**, **Checks** and **Issues** from observed paths and independent checks.
Status recovers that report if the host stops before displaying it. Zero checks
are explicitly unverified. Planning status is reported without writing backlog
files, including through a linked `.planr` directory. Worktree cleanup is a
separate explicit action.

The helper does not commit, push, create a PR, publish or deploy. Authorize those
steps separately after reviewing the integrated local diff.

The [preview verification report](delegation-verification.md) records the tested
package, recovery journey and limitations.
