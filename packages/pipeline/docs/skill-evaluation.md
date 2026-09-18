# Skill Evaluation Laboratory

> A deterministic runner that measures the frozen professional-skill catalog
> against real host, CLI, and browser journeys and reports a certification
> verdict. The laboratory only measures. It never edits a graded skill, assigns
> a version, or performs a release effect.

```bash
npm run evaluate:skills                # human summary, exit 1 when blocked
npm run evaluate:skills -- --json      # strict machine envelope
npm run evaluate:skills -- --ci        # also emit the redacted CI artifacts
npm run test:evaluation                # unit, property, adversarial, journey suites
npm run conformance:skill-evaluation   # contract + laboratory conformance
```

## What a run grades

Inputs are read only when they satisfy the published evaluation contracts in
`lib/pipeline/evaluation-contract.mjs`. Nothing in the laboratory re-implements
validation, and nothing widens a contract to make a record fit.

| Input | Location | Bound by |
|---|---|---|
| Scenario corpora | `evaluation/scenarios/<skillId>/corpus.json` | Member digests recomputed from the scenario source bytes |
| Scenarios | `evaluation/scenarios/<skillId>/<host>/<journey>.json` | Self-digest over canonical bytes |
| Prompt fixtures | `evaluation/scenarios/<skillId>/<host>/prompts/<journey>.txt` | Fixture identity derived from the bytes on disk |
| Host profiles | `evaluation/host-profiles/<host>.json` | Byte-identical to the sealed registry row |
| Graders | `registry/evaluation-graders.json` | Sealed grader registry |
| Budget and frozen baseline | `evaluation/budgets/`, `evaluation/baselines/` | Baseline digest bound by both the budget and the gate policy |
| Gate policy | `evaluation/gate-policy.json` | Mandatory thresholds, stated as constants in the published schema |
| Loopback surface | `conformance/fixtures/skill-evaluation/loopback-surface.json` | Disposable; served from memory, never from the hosted site |

Every run result binds the scenario identity, the source bytes it graded, the
grader type and version, the host profile, the package inventory, and the skill
source digest. A change to any of them invalidates exactly the evidence whose
input digest changed — see `evaluationEvidenceReuse`. Reused evidence whose
input digest no longer matches is refused, and the final relevant suite always
reruns regardless of what was reusable.

## Corpus layout

One corpus per public skill in the frozen catalog. Each corpus carries, for
every host profile the catalog declares, six journeys:

| Journey | Prompt class | Expected trigger | What it proves |
|---|---|---|---|
| `positive` | positive | invoke | The declared trigger phrase reaches the skill |
| `negative` | negative | decline | A declared exclusion routes away; invoking here is a precision failure |
| `ambiguity` | ambiguous | clarify | Half a trigger phrase asks rather than guesses |
| `permission-denied` | permission-denied | refuse | A capability the host denied is refused, not worked around |
| `recovery` | positive | invoke | Stale state, conflicting identity, crash and restart, exact replay, and rollback |
| `packed-install` | positive | invoke | The installed archive bytes are exercised, not the working tree |

The journey kind is the source document's own name. A corpus member whose file
is not named after a declared journey is refused rather than guessed at.

Trigger routing is deterministic. It scores the prompt against the catalog's own
`triggerPolicy.include` and `triggerPolicy.exclude` phrases and refuses outright
when the prompt asks for a capability the scenario declares denied. Nothing in a
scenario states the answer the router is supposed to give, so a corpus that
drifts from the catalog fails instead of self-confirming.

## Journeys

- **Host** — the trigger decision itself, graded against the scenario's expected
  outcome and the host's permission model.
- **CLI** — the real command grammar in both human and strict JSON output,
  invoked in a disposable working root with a scrubbed environment. Recovery is
  asserted on the typed code, never on the exit status; identical argv is
  invoked once per output mode and shared across the run.
- **Browser** — a disposable loopback surface driven through a registered
  trusted browser runtime adapter, recording route, form, viewport,
  accessibility, console, and network evidence. The bundled adapter attests the
  console channel only where the served document provably carries no script; a
  document with script leaves that class unattested. With no trusted adapter, or
  any declared class unattested, the journey records a typed absence and stays
  blocking. It never infers a pass or fabricates a host, session, result, or
  digest.
- **Packed install** — the exact declared archive installed into a disposable
  root. A member that traverses out of the root, arrives as an absolute path, or
  lands on a pre-existing path (which may be a symlink to anywhere) is refused.
  The skill is then exercised from the installed bytes.
- **Recovery** — an injected clock and a disposable store. Exact replay under one
  identity is idempotent; changed input under the same identity is a typed
  conflict rather than a silent overwrite.

## Gates

Thresholds are read from the gate policy, which states them as constants the
published schema pins. Code never restates a number.

| Gate | Comparator | Waivable |
|---|---|---|
| `trigger-precision`, `trigger-recall` | at or above the stated rate | yes |
| `journey-completion` | at or above the stated rate | yes |
| `schema-validity` | exactly total | **no** |
| `asset-parity`, `export-parity` | exactly total | yes |
| `package-parity` | exactly total | **no** |
| `finding-severity-p0`, `finding-severity-p1` | at or below the stated count | **no** |
| `latency-regression`, `cost-regression` | at or below the stated allowance, against the frozen baseline | yes |

Rates are integer basis points, truncated toward zero, so a `>=` gate never
rounds a miss up into a pass. Regressions round the other way for the same
reason. Parity comparison is exact bytes and digests, never a version string.

Finding severity is assigned by kind. A contract refusal, foreign identity,
redaction breach, or fabricated result is P0. An authorization escape, a
schema-invalid accepted output, a parity mismatch, or an absence only a human or
a missing host can clear is P1. A trigger mismatch or incomplete journey is P2.
An absence a rerun can clear, and a budget ceiling exceedance, are P3.

A certification verdict is `PASS` only when every mandatory gate is met or
validly waived.

### The latency baseline is an envelope

Cost is estimated deterministically from measured bytes, so its baseline is
tight and a content change moves it. Wall-clock latency varies between machines,
so its baseline is a frozen envelope well above the measured value: it catches a
real slowdown without failing on ordinary host variance. Both are bound by one
baseline digest, and changing either forces the budget and the gate policy to be
resealed.

## Waivers

A waiver applies only when it is owner-signed by a declared accountable owner,
in force at the moment it is applied, issued under the exact gate policy the run
evaluated, and naming one exact metric and one exact scenario or skill version.

A waiver aimed at schema validity, package parity, or a P0/P1 finding is refused
outright — those gates have no waiver path. An expired, foreign, or otherwise
inadmissible waiver leaves the blocking result standing rather than downgrading
it. Every applied waiver is visible in the receipt with its owner, scope, reason
code, and expiry, and appears in the run summary.

Pass owners and waivers explicitly:

```bash
npm run evaluate:skills -- --owner <identity> --waiver-file <path>
```

## What a certified result means

A certified skill-host result asserts **skill compatibility for that host
profile only**. It says the skill routes, completes its journeys, produces
contract-valid output, and matches declared parity on that host. It says nothing
about PLAN, SHIP, or Operate runtime compatibility unless that runtime was
separately certified in the same run. Each receipt lists exactly the host
profiles its run graded.

A receipt records readiness. It carries no release, publish, deploy, promotion,
or activation authority, and the contract refuses any field a reader could
mistake for one.

## Reporting

Raw prompts, traces, screenshots, and grader output are written only to the
local run directory (`evaluation/.runs/<runId>` by default, and never tracked).
The CI report path emits exactly two artifacts — the redacted aggregate JSON and
JUnit XML. The aggregate report is built from counters, rates, and digests, so
there is nothing to strip; the publish gate then refuses anything unrecognized
that slipped in anyway, including free text, absolute paths, credentials, and
stack frames.

## Effect boundary

One full run performs no telemetry, remote upload, implicit live-model call,
credential use, Git operation, publish, deploy, tag, push, marketplace promotion,
or room activation. Its network traffic is confined to the loopback surface it
starts and stops itself. Graders are deterministic by default; a live-model
judgement is a distinct, separately consented grader kind, is never required to
validate a pure contract, and is absent from the default local and CI run.

Canonical skill sources, generated host assets, the professional-skill catalog
and its frozen membership and bundle digests, the frozen command grammar, and
the specialist roster are read through their existing loaders and never
rewritten.

## Supersession boundary

This laboratory supersedes the frozen catalog record's ad-hoc skill/host/canary checking **for
measurement and certification only**: what a skill-host pair must demonstrate,
how it is measured, and what verdict that produces now come from here.

The frozen catalog record remains authoritative and unchanged for everything else — the frozen
catalog membership, the canonical skill sources and generated host assets, the
command grammar, and the specialist roster. The laboratory consumes those
through their existing public interfaces and never forks, edits, or reinterprets
their records. See `ownership-map.md` for the boundary as an ownership statement.

## See Also

- `compatibility-matrix.md` — what a certified skill-host result covers
- `ownership-map.md` — who owns the catalog, the assets, and the verdict
- `../conformance/README.md` — conformance workflow
