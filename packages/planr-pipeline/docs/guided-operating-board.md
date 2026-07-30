# Guided Operating Board

`planr operate` owns the questions, validation, previews, actions, and safety
boundaries. Claude Code, Codex, Cursor, and a terminal only present those
artifacts and return answers by canonical question ID.

## First use in a coding runtime

Invoke the installed `planr-operate` workflow with no arguments. That single
invocation inspects the project, initializes only when needed, runs one complete
native cycle, prints the CEO/CTO/CPO/CMO/COO/Chair report, and stops at review.
No orchestration prompt or manual adapter commands are required. Explicit
subcommands such as `inspect`, `status`, or `report` perform only that command.

## First use in a terminal

```bash
planr operate inspect
planr operate init
planr operate run --preview
planr operate run
planr operate review
planr operate report
```

In an interactive terminal, the CLI asks the questions directly. In a coding
runtime, the installed `planr-operate` workflow first calls `inspect --json` and
skips initialization when it is already complete. When setup is required, it
presents the returned questionnaire through a verified native question surface,
then an attached CLI-owned interactive terminal, then structured chat one
question at a time. It never dumps the questionnaire as a form. The runtime
constructs the typed answer envelope from the questionnaire's self-describing
`submission` contract and sends it on bounded stdin. If no interaction path is
available, it returns the exact terminal handoff. Adapters never invent answers,
defaults, questions, commands, envelope metadata, or consent.

A bare workflow invocation or explicit request to run a cycle selects its exact
cycle-start action and authorizes the reversible local adapter lifecycle through
independent advisors, Chair consolidation, and a `reviewable`, `blocked`, or
`failed` result. The runtime does not ask the user to paste `adapter prepare`,
`record`, `finalize`, Chair, or report commands. Provider consent, finding
disposition, route application, planning artifacts, PLAN, SHIP, and external
effects remain separate named gates. `--preview` performs no writes and no
provider calls. `--dry-run` may use a provider after disclosure but commits no
operating state.

Claude Code uses `native-isolated` advisor dispatch. Codex uses
`native-bounded`: each native advisor receives only one immutable role pack and
may not inspect the workspace, environment, network, or other tools. Cursor
uses the structured-provider path. All adapters return
`operating-advisor-response@1.2.0`; OpenPlanr owns canonical metadata and
digests.

### Native adapter handoff

When a native cycle reaches an advisor boundary, the public `run` result returns
a validated `operating-adapter-handoff` in `prepare-required` state. It is the
complete machine contract for that boundary, not a hint that a runtime must
turn into commands. Its `phase`, `state`, `binding`, and `roles` bind every
current action to the exact cycle, evidence digest, runtime, lease,
idempotency key, and expiry. Lease and expiry are null until prepare succeeds.

The runtime must:

1. execute only the current `handoff.next[].argv` token arrays exactly as
   returned;
2. for a record action, resolve its role pack and compact response schema from
   the retained `adapter.prepare` result using the declared absolute pointers;
3. use the same returned lease and idempotency key—never add a role suffix or
   derive a replacement; and
4. use `handoff.recovery` only after a failed current action.

The state sequence is `prepare-required` → `record-required` →
`finalize-required` → `continue-required`. Each successful record returns a
fresh handoff containing only unfinished role actions. Recovery contains
read-only resume and machine-local cancel only while recording/finalizing.
Cancelled sessions expose no executable action.
Runtimes must not reconstruct lifecycle commands from prose, probe them with
`--help`, or guess the next phase. On an error, follow the exact returned
handoff or named recovery action. A new Chair handoff is prepared only after
independent advisor results have been finalized and committed.

Lifecycle effects remain deliberately bounded:

| Action | Effect |
|---|---|
| `prepare`, `record`, `cancel` | `machine-local-write` |
| `resume` | `read-only` |
| `finalize`, `continue` | `project-write` |

These machine-only actions never authorize finding acceptance, route
application, planning artifacts, PLAN, SHIP, provider consent, or an external
effect.

## Evidence recovery

A safely redacted evidence item remains useful. An item that cannot be made
safe is quarantined individually, while unrelated evidence and ready lenses
continue. Only when required evidence is blocked should the runtime run the
exact value-free diagnostic action:

```bash
planr operate evidence diagnose <candidate-id>
```

The report contains a safe relative path, detector category, line/column, and
fingerprint—never the value. A confirmed credential must be removed or rotated.
Only eligible soft-pattern findings can be classified as a false positive, and
that classification is bound to the evidence digest and operating head. Private
keys, high-confidence token formats, and other hard categories cannot be
overridden.

## Privacy and retention

Raw evidence, prompts, responses, credentials, sessions, and diagnostics remain
machine-local under `~/.planr/operate/<project-hash>`. Commit-safe state contains
sanitized events and immutable metadata. Session and evidence cleanup is exposed
through `planr operate cache status|purge`; `planr doctor` reports expired guided
sessions and adapter interaction capability.

## Automation

`--json` is one versioned object on stdout and is non-interactive. Scripts must
choose a returned action ID and echo its exact confirmation digest. A runtime
may add `--yes` only to the exact cycle-start action selected by an explicit
cycle request. Do not parse human labels or add a broad `--yes`. Missing
pipeline/runtime capability fails before provider use with a named recovery
command.

The dashboard is optional. `planr operate report` prints the concise brief and
separate CEO, CTO, CPO, CMO, COO, and Chair reports as Markdown, while
`planr operate report --json` returns structured results and exact governed
conversion commands for findings, routes, specs, tasks, and quick tasks.

## Troubleshooting

- `E_OPERATE_NOT_INITIALIZED`: run `planr operate init`.
- `E_GUIDED_INTERACTION_UNAVAILABLE`: attach a terminal or use a certified
  runtime with structured questions/chat.
- `E_GUIDED_SESSION_EXPIRED`: restart the current guided command.
- `E_GUIDED_SESSION_STALE`: inspect changed project/config state, then restart.
- `E_OPERATE_SECRET_DETECTED`: use `operate evidence diagnose`; do not inspect or
  weaken private state.
- `E_PIPELINE_NOT_INSTALLED`: run the exact full-install command in the result.

The deterministic journey fixtures and canary are:

```bash
node --test tests/ecosystem/guided-operate-acceptance.test.mjs
node scripts/guided-operate-canary.mjs --fixtures
```
