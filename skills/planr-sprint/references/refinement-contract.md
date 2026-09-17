# Refinement contract

The refinement document is the durable record of one run: what was read, how
each item was judged, what was selected and what the refuters changed. The CLI
validates it (`planr sprint refinement <id> --data`), stores it as
`.planr/sprints/SPRINT-NNN/refinement.json`, renders `refinement.md` from it
and fills the sprint body from its batches. `planr sprint diff`, `planr sprint
close` and `planr sprint apply` read it back.

## Item record

One entry per open item, whether or not it is selected.

| Field | Meaning |
| --- | --- |
| `id` | Artifact id (`BL-012`, `QT-034`, `TASK-007`). Only artifacts; file non-artifact work as a quick task first. |
| `title` | The item's title as written. |
| `claim` | What the item says is wrong or wanted, in one sentence. |
| `evidenceDate` | The latest dated evidence for the claim (`YYYY-MM-DD`), or `null` when none exists. |
| `codePath` / `codePathExists` | The code path the item names and whether it still exists on the default branch as described. `null` when the item names none. |
| `stale` | `true` when the evidence is older than the cadence allows or the code has moved on. |
| `blockedBy` | The named blockers: `partner: …`, `team decision: …`, `BL-045`. Empty when nothing blocks it. |
| `unblockQuestion` | The one question whose answer unblocks the item. |
| `effort` | `hours`, `day`, `days` or `week+`. |
| `score` | Production impact this month × tractability now. Any consistent scale; only the order matters. |
| `bucket` | `inProgress`, `planNext`, `blocked` or `closeOrDemote`. |
| `reason` | One clause: why the item sits in that bucket. |
| `evidence` | For close-or-demote rows: `file:line`, PR number or date. |
| `targetStatus` / `targetPriority` | What `planr sprint apply` writes, in the repository's own vocabulary (`planr update --help`). Priority applies to backlog items only. |

## Scoring

Score = production impact this month × tractability now.

- Impact counts users hit, money or compliance at stake, and whether the
  release cut depends on it. An item nobody is hit by this month scores low
  regardless of its label.
- Tractability counts whether the fix is known, whether the code path exists,
  whether a migration or a partner is needed, and whether the item is already
  half done.
- Evidence date beats priority label. A P0 from months ago with no fresh
  evidence is a candidate for close-or-demote, not for in progress.

## Buckets

| Bucket | Rule |
| --- | --- |
| `inProgress` | Fits the stated capacity to the cut. Ordered for execution and grouped into `batches` (PR batches by product, or sessions). Includes the release cut itself as work. |
| `planNext` | Real and tractable, but after the cut. |
| `blocked` | Blocked on a partner, a team decision or another item. Never in progress. Carries `blockedBy` and `unblockQuestion`. |
| `closeOrDemote` | Dead, duplicated, overtaken or already delivered. Carries `evidence` and the `targetStatus` or `targetPriority` the write-back applies. |

Every item is in exactly one bucket; `buckets.<name>` lists the ids and each
item's `bucket` field agrees. `batches[].itemIds` partition `buckets.inProgress`
exactly.

## Refuter lenses

Run all three over every in-progress pick before the buckets are shown.

| Lens | Question | Typical corrections |
| --- | --- | --- |
| `evidence` | Is it still real on the default branch? Is the premise true? Was it already fixed? | Dropped picks, moves to close-or-demote |
| `capacity` | Does the list fit the days? Are migrations, partner dependencies, PR batching and CI cost per PR accounted for? | Splits, reorders, moves to plan-next |
| `impact` | Who is hit this month if it is not done? Which higher-impact item was omitted for it? | Swaps, moves to plan-next |

A pick that fails a lens moves or drops, and the correction is recorded in
`refuted[]` as `{ itemId, lens, change, from, to }`. Nothing is deleted from
`items[]`; the item keeps its new bucket and reason.

## `refinement.json`

```json
{
  "schemaVersion": 1,
  "sprintId": "SPRINT-004",
  "refinedAt": "2026-09-17",
  "inputs": {
    "capacityDays": 6,
    "releaseCut": "2026-09-25",
    "gitRevision": "a1b2c3d",
    "previousSprintId": "SPRINT-003",
    "operateCycleId": "OP-2026-09-A",
    "sources": ["backlog", "quick", "git", "release-profile"],
    "defaulted": ["capacity"],
    "notes": "Connector not configured; statuses stay local."
  },
  "items": [
    {
      "id": "BL-345",
      "title": "CRM callback silent since 10 Sep",
      "claim": "Callbacks from the CRM stopped landing on 10 Sep",
      "evidenceDate": "2026-09-16",
      "codePath": "apps/apply/src/crm/callback.ts",
      "codePathExists": true,
      "stale": false,
      "blockedBy": [],
      "effort": "hours",
      "score": 9.5,
      "bucket": "inProgress",
      "reason": "39 applications stuck at Received"
    },
    {
      "id": "BL-295",
      "title": "Importer drops trailing rows",
      "evidenceDate": "2026-05-02",
      "stale": true,
      "blockedBy": [],
      "effort": "days",
      "score": 0.5,
      "bucket": "closeOrDemote",
      "reason": "delivered by #569",
      "evidence": "PR #569 merged 2026-09-08",
      "targetStatus": "closed"
    },
    {
      "id": "BL-167",
      "title": "Dynamics id for the Austrian Matura",
      "evidenceDate": "2026-08-30",
      "stale": false,
      "blockedBy": ["partner: Dynamics team"],
      "unblockQuestion": "Which Dynamics id represents the Austrian Matura?",
      "effort": "day",
      "score": 4,
      "bucket": "blocked",
      "reason": "needs the partner mapping"
    }
  ],
  "buckets": {
    "inProgress": ["BL-345"],
    "planNext": [],
    "blocked": ["BL-167"],
    "closeOrDemote": ["BL-295"]
  },
  "batches": [
    { "title": "VM read session", "effortDays": 0.5, "itemIds": ["BL-345"] }
  ],
  "refuted": [
    {
      "itemId": "BL-295",
      "lens": "evidence",
      "change": "delivered 8 Sep, moved to close",
      "from": "inProgress",
      "to": "closeOrDemote"
    }
  ]
}
```

`inputs.sources` names what was read; `inputs.defaulted` names every value
taken from a default instead of the repository or the user. The CLI adds
`leftovers[]` on `planr sprint close` and `applied` on `planr sprint apply`;
never write those yourself. Unknown fields are rejected, so keep notes in
`inputs.notes` or in the item's `reason`.
