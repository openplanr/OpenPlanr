# API — Native Parallel Dispatch

> The dispatch contract and the advisory lock-list.

Status: descriptive (SPEC-014).

---

## Dispatch contract

In Claude Code's multi-task mode the orchestrator emits **one `Agent` tool-call per ready task** in a single assistant turn. A task is *ready* when every id in its `dependsOn:` list is already `done` (a task with no `dependsOn` is always ready).

- Dispatched `Agent` calls do **not** set `isolation` — sub-agents write directly to the shared main working tree.
- There is **no** concurrency flag. The host's native concurrency cap is the only throttle. (The SPEC-013 `--max-parallel` flag and `$SHIP_MAX_PARALLEL` binding were removed.)
- Agents return structured task results; the closure runtime alone writes status,
  receipts, compatibility evidence, and provenance.
- An R6 command-chain failure lands that task `blocked` and does not abort
  independent work.

---

## `dependsOn:`

The only ordering constraint. A task's frontmatter may carry:

```yaml
dependsOn: ["T-001"]
```

an array of `^T-\d{3}$` task IDs. It is optional and backward-compatible — task files without it stay valid. A dependent task is held back until its declared dependencies complete, then dispatched in a later turn. planr infers dependencies from nothing else.

---

## Advisory lock-list

The orchestrator pattern-matches task write-sets against a static list — `package.json`, lockfiles, `**/index.ts`, `**/index.js`, `prisma/schema.prisma`, `**/migrations/**` — purely to add a "consider ordering" note to the dispatch prompt when two tasks touch the same lock-listed path. It changes no control flow and never serializes anything; the host may act on it or ignore it.

---

## Runtime fallback

When native subagents are unavailable, execute ready tasks sequentially inside the
same user invocation. Only `--task T-NNN` narrows the graph to one task.

---

*Pairs with `architecture.md` and `conformance.md`.*
