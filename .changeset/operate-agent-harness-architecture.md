---
"openplanr": minor
---

The Operating Board harness pivot for `planr operate` (SPEC-004), the `openplanr` minor
bump 1.19.0 → 1.20.0 — the agent is the engine; the CLI harnesses, verifies, and records.
Every landed claim below is backed by a named proof; coordinated sibling work still
completing under this same version is described as landing with the release, never as a
phase this repository has already verified.

**The mandate replaces the collector as the unit of dispatch.** A per-role operating
mandate carries the lens question, declared read boundaries (workspace roots — including
the `.planr/` tree — a sensitivity ceiling, and forbidden paths), a required response
schema, and a citation requirement, and it carries no evidence bodies and no evidence
index — structurally forbidden rather than merely omitted. Proven by
`tests/unit/operate-adapter-mission-dispatch.test.ts` ("prepares a mandate (not a pack)
with declared boundaries and no evidence body ..."), whose fixture fails if any file body
ever leaks into the body-free, index-free mandate.

**Evidence is an output, not an input, and citation resolution is the universal gate.**
`adapter record` resolves every citation in a response fail-closed and mints the
evidence-of-record from what was actually cited. A fabricated path, a wrong line range, a
moved revision, or a citation above the role's sensitivity ceiling each becomes a governed
gap — on every dispatch path and every source — and a response resolving zero citations
records its role `not_evaluated` with a governed gap naming the empty grounding. Proven by
`tests/unit/operate-citation-resolution.test.ts` ("rejects a fabricated path, a wrong line
range, and a moved revision with distinct reasons and one gap each" and "commits a role
not_evaluated with a governed gap when its citations resolve zero evidence") and by the
above-ceiling refusal in `tests/unit/operate-mission-honeytoken-isolation.test.ts`
("refuses a read above the sensitivity ceiling inside a granted root").

**Hard-blocked secrets in cited content are rejected, not redacted-and-accepted.** A
citation whose snapshot contains a hard-blocked secret category is refused as an
unresolvable citation gap instead of being persisted in redacted form. Proven by
`tests/unit/operate-citation-resolution.test.ts` ("rejects a citation into
HARD-blocked-secret content as unresolvable, never redacted-and-accepted"), with a
soft-secret assignment still redacted-and-accepted so the distinction is exercised both
ways.

**A gitignored `.planr/` tree is fully citable — by architecture.** The dispatched agent
reads the filesystem directly rather than `git ls-files`, so a project that gitignores its
`.planr/` control surface can still ground the three lenses (CPO, CMO, COO) that the
fourth field audit found unsatisfiable when candidates came only from tracked files — the
defect that starved three of six lenses is gone by construction, not by repair. Proven by
`tests/unit/operate-mission-honeytoken-isolation.test.ts` ("reads a gitignored .planr/
tree — the mission tool walks the filesystem, not git ls-files (finding 2)").

**Guided init has no livelock, no dead-end advice, and a revise path.** An answer envelope
is accepted on its binding validity (session id, questionnaire digest, project head)
rather than on wall-clock ordering, a transiently stale session un-latches when the tree
is restored, a genuinely terminal rejection names the resumable session id and its exact
`--resume` command, a previously answered question can be re-answered before apply, and the
questionnaire advertises `--answers-file` as a stdin-parity transport alternate with
per-question renderability metadata. Proven by
`tests/unit/operate-question-session.test.ts` ("accepts an answer envelope whose
submittedAt predates the session (livelock regression)" and "un-latches a transiently
stale session when the tree is restored"),
`tests/integration/operate-question-resume.test.ts` (the resume command surfaced in the
next actions), and `tests/unit/operate-question-engine.test.ts` ("advertises
--answers-file as a stdin-parity transport alternate with its exact argv" and "carries
repeated-text renderability metadata sufficient to present without improvisation").

**Completing the pivot in the same coordinated release.** Sibling work landing under this
version retires the now-dead evidence collector — its walks and budgets, role packs,
mission packets, and the `pack|mission` dispatch-mode split — behind the mandate contract;
renders cycle integrity (citation rejections, boundary refusals, `not_evaluated` roles) as
a first-class section of the readable tree and a `doctor` check; makes the persisted
`cycles/<id>/report.md` a self-contained record with complete registers; corrects the
"commit-safe root" claim to an honest, redaction-based statement; and collapses runtime
classification to mandate-capable-or-unsupported with no silent structured fallback. On the
same schedule, the CLI's own structured-provider advisor path and its `--ai` planning
surfaces are deprecated (FR4) — functional this release, pointed at the harness flow, and
scheduled for removal, never broken and never silently removed. These items land with this
release rather than ahead of it; their per-task proofs live under
`.planr/specs/SPEC-004-operate-agent-harness-architecture/`.

**Pins the optional `planr-pipeline` runtime to the exact `0.36.1`** — the build that
publishes the additive operating-mandate schema (the same additive pattern as
`create-quick-task`/`create-epic`), the regenerated mandate-flow command/skill
instructions, the registry investigation mandates, and the reclassified adapter capability
rows this release dispatches against. Verified:
`optionalDependencies["planr-pipeline"] === "0.36.1"`, the three workflow `ref: v0.36.1`
pins, and both packed-install e2e assertions.
