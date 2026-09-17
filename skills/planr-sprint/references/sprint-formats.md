# Sprint formats

Three durable outputs and one chat return. The CLI writes the first three from
the two JSON inputs below; when it is unavailable, write the same files by hand.

## `sprint.json` (input to `planr sprint create --data`)

```json
{
  "title": "Cut 25 Sep 2026",
  "startDate": "2026-09-17",
  "releaseCut": "2026-09-25",
  "capacityDays": 6,
  "goals": ["Unblock stuck applications", "Ship the cut"]
}
```

`endDate` defaults to `releaseCut`, or to `startDate` plus the duration when no
cut is known. `status` may be `planned` or `active` (default). Omit `taskIds`
and `batches`; `planr sprint refinement` fills them from the refinement
document.

## Sprint artifact

`.planr/sprints/SPRINT-NNN-<slug>.md`: the existing frontmatter plus three
fields, and the In-progress bucket as checkboxes grouped by batch.

```markdown
---
id: "SPRINT-004"
name: "Cut 25 Sep 2026"
startDate: "2026-09-17"
endDate: "2026-09-25"
duration: "8d"
status: "active"
releaseCut: "2026-09-25"
capacityDays: 6
created: "2026-09-17"
updated: "2026-09-17"
taskIds: ["BL-345", "BL-348", "QT-194"]
refinedAt: "2026-09-17"
---

# SPRINT-004: Cut 25 Sep 2026

## Sprint Details

- **Duration:** 8d
- **Start:** 2026-09-17
- **End:** 2026-09-25
- **Status:** ACTIVE
- **Release cut:** 2026-09-25
- **Capacity:** 6 engineer-days

## Tasks

### VM read session · 0.5d

- [ ] **BL-345** CRM callback silent since 10 Sep · hours · [view](../backlog/BL-345-crm-callback-silent.md)

### PR 1 · MUVi Apply · 1d

- [ ] **BL-348** rag-api cannot reach the department API · day · [view](../backlog/BL-348-rag-api.md)
- [ ] **QT-194** Release cut 25 Sep · hours · [view](../quick/QT-194-release-cut-25-sep.md)

## Retrospective
_Complete this section when closing the sprint with `planr sprint close SPRINT-004`._
```

Each task line is `- [ ] **ID** title · effort · [view](relative path)`.
`planr status`, `planr sprint close` and the dashboard read these lines; tick a
box when the item ships. `releaseCut` is absent when no release profile exists;
`capacityDays` and `refinedAt` are absent until a refinement is recorded.

## Refinement note

`.planr/sprints/SPRINT-NNN/refinement.md`, rendered from the JSON so the next
run can diff against it:

- **Inputs**: capacity, release cut, git revision, previous sprint, Operate
  cycle, sources read, values defaulted.
- **Items**: one table row per open item: `ID · score · evidence date · stale?
  · blocked by · effort · bucket`.
- **Refuter verdicts**: every correction verbatim, with its lens.
- **In progress** by batch, then **Plan next**, **Blocked** and **Close or
  demote** in full, since only In progress goes into the sprint.
- **Leftovers** (after `planr sprint close`) and **Applied** (after
  `planr sprint apply`).

## Machine-readable copy

`.planr/sprints/SPRINT-NNN/refinement.json`: the document described in
[the refinement contract](refinement-contract.md), validated against the JSON
Schema packaged as `schemas/refinement.schema.json` (linked from the skill
entrypoint). The dashboard, `planr sprint diff` and `planr sprint apply` consume
it.

## Status write-back

Only on approval through the structured question. `planr sprint apply
SPRINT-NNN --yes --commit` writes each close, demote or blocked row's
`targetStatus`, `targetPriority` and `blockedBy` to the artifacts and commits the
sprint, the note, the JSON and the changed artifacts as one commit:

```
chore(planr): refine backlog for SPRINT-NNN
```

## Example chat return

```
Outcome:  proposed · 5.8 of 6 engineer-days used · SPRINT-004 (cut 25 Sep)
Sprint:   .planr/sprints/SPRINT-004-cut-25-sep-2026.md

In progress (execution order)
  VM read session · 0.5d
    BL-345  CRM callback silent since 10 Sep, 39 applications stuck at Received
    BL-348  rag-api cannot reach the department API (+ missing api key)
  PR 1 · MUVi Apply · 1d
    BL-282  self-healing where clause
    BL-229  write-side GUID check only (rest 9 Oct)
  PR 2 · Connect residuals · 0.75d
    BL-360, BL-364, BL-368, BL-056 (D3 only)
  Ops readiness · 1.5d   ·   QT-194 the cut · 0.5d

Plan next (9 Oct)   BL-224, BL-043, BL-283, BL-014, BL-349 code, …   (14 items)
Blocked             BL-167 partner: Dynamics id for Austrian Matura?
                    BL-272 team: which English tests carry a score?   (31 items)
Close or demote     BL-295 done by #569 · BL-327 done by #590 · BL-197 P1 dead 14 Sep …  (42 items)

Refuted   BL-342 evidence: no server actions in muvi-apply, dropped
          BL-229 impact: no applicant hit this month, split
          BL-295 evidence: delivered 8 Sep, moved to close
Issues    none
Next      approve write-back: planr sprint apply SPRINT-004 --yes --commit
```

## Hand-written fallback

Without the CLI, create the three files above yourself: allocate the next
`SPRINT-NNN`, write the frontmatter and the batched checkboxes exactly as shown,
write `refinement.json` to the schema and `refinement.md` from it, and apply the
status changes with the repository's own vocabulary in one commit with the same
message. Never store notes as `.planr/sprints/SPRINT-NNN-*.md` siblings; graph
readers treat every `.md` in `sprints/` as a sprint and skip only the
`SPRINT-NNN/` directory.
