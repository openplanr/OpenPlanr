# Guided Operating Board

`planr operate` owns the questions, validation, previews, actions, and safety
boundaries. Claude Code, Codex, Cursor, and a terminal only present those
artifacts and return answers by canonical question ID.

## First use

```bash
planr operate inspect
planr operate init
planr operate run --preview
planr operate run --offline
planr operate review
```

In an interactive terminal, the CLI asks the questions directly. In a coding
runtime, the installed `planr-operate` workflow requests `--json`, presents the
returned questionnaire through a verified native question surface or structured
chat, and sends the typed answer envelope on bounded stdin. If neither is
available, it returns the exact terminal handoff. Adapters never invent answers,
defaults, questions, commands, or consent.

Every mutating or provider-using step stops on a preview. Selecting one returned
action confirms only its exact digest; answering a field does not authorize the
next step. `--preview` performs no writes and no provider calls. `--dry-run` may
use a provider after disclosure but commits no operating state.

## Evidence recovery

A possible secret stops collection before advisor dispatch. Run the exact
value-free diagnostic action:

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
choose a returned action ID and echo its exact confirmation digest. Do not parse
human labels or add a broad `--yes`. Missing pipeline/runtime capability fails
before provider use with a named recovery command.

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
