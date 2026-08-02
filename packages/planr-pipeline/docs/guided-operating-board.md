# Agent-native Operating Board

`planr operate` uses the same division of responsibility as PLAN and SHIP:
the installed skill/plugin orchestrates the selected coding runtime, runtime
agents inspect and reason about the project, and OpenPlanr validates and records
their cited output.

## Primary workflow

Invoke the runtime workflow once:

```text
$planr-operate                  # Codex
/planr-pipeline:operate         # Claude Code
```

The workflow detects whether initialization is needed, researches the project,
runs CEO, CTO, CPO, CMO, COO, and Chair, writes Markdown and JSON reports,
materializes qualified proposal drafts, and stops at the review gate. Users do
not write an orchestration prompt and do not run harness lifecycle commands.

Cursor follows the generated `openplanr-operate` project rule. If native
subagents are unavailable, the same selected runtime runs the roles
sequentially. A cycle never changes vendors silently.

## Research before questions

The bootstrap role inspects repository files, Git history, Planr artifacts,
product and pricing surfaces, architecture, delivery state, and incomplete
loops before asking the owner anything. Context claims are labeled:

```text
observed | inferred | hypothesis | owner-confirmed | unknown
```

Business model, likely ICP, product stage, goals, and proposed metrics may be
inferred with citations and confidence. They remain hypotheses until the owner
confirms them. Only true authority decisions—such as the final decision owner
and acceptance of a consequential business assumption—require a question.
Unknown context reduces confidence or opens a gap; it does not block research.

Local research is automatic. Connected or web research requires a per-cycle
preview and explicit consent.

## Runtime binding and permissions

Runtime selection uses the ecosystem precedence: explicit runtime, active
marker, project default, the only compatible installed runtime, then an
interactive choice. The resulting cycle is sticky:

```json
{
  "runtime": "codex",
  "runtimeBinding": "required",
  "crossRuntimeFallback": false,
  "executionMode": "native-agent",
  "assurance": "runtime-governed",
  "toolIsolation": "advisory"
}
```

Advisory isolation does not make Codex unsupported. Planr grants no new tool
permissions: the runtime sandbox and user-approved session access govern reads.
OpenPlanr validates schema, citations, runtime binding, and authority before it
persists governed output. A mismatched continuation fails with
`E_OPERATE_RUNTIME_MISMATCH`.

## Advisor and report contract

Each role returns flexible Markdown plus typed sidecars:

```json
{
  "analysisMarkdown": "...",
  "claims": [],
  "actions": [],
  "gaps": [],
  "conflicts": []
}
```

Agents inspect the workspace directly; no repository body or evidence pack is
serialized through stdin. The 256 KiB bound applies only to one role's returned
report. Material claims and actions require citations. Invalid citations reject
the affected item instead of discarding unrelated narrative.

Every reviewable cycle writes:

```text
.planr/operate/cycles/CYCLE-NNN/report.md
.planr/operate/cycles/CYCLE-NNN/report.json
.planr/operate/cycles/CYCLE-NNN/actions.md
.planr/operate/cycles/CYCLE-NNN/board/{ceo,cto,cpo,cmo,coo,chair}.md
```

The visual dashboard is optional.

## Proposal drafts and governance

Qualified, cited recommendations can materialize reversible proposed Quick
Tasks, Specs, Epics, decisions, or agent artifacts. Proposal notices and a
causality sidecar tie every draft to its cycle and findings. Draft creation does
not accept a finding, apply a route, invoke PLAN, or invoke SHIP.

```bash
planr operate drafts list
planr operate drafts show DRAFT-001
planr operate drafts approve DRAFT-001
planr operate drafts discard DRAFT-001
```

An unapproved draft is blocked from PLAN and SHIP with
`E_OPERATE_DRAFT_UNAPPROVED` and the exact approval command. Discard removes an
unchanged draft byte-for-byte; an edited artifact is preserved and marked.

## Machine lifecycle

Skills execute the returned `planr operate harness
prepare|record|finalize|resume|cancel` actions internally, preserving all
cycle, runtime, digest, lease, and idempotency bindings. The older `adapter`
namespace remains a compatibility alias for two minor releases and must not
appear in new user guidance.

## Terminal and automation

The CLI remains useful as a deterministic kernel and for inspection:

```bash
planr operate inspect
planr operate context show
planr operate status
planr operate report --format markdown
planr operate drafts list
```

`--json` emits one versioned result on stdout and never prompts. `--preview`
performs no writes or provider calls. Operate never deploys, publishes, spends,
contacts customers, changes credentials, performs destructive work, or invokes
SHIP.
