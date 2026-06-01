# Conformance — Native Parallel Dispatch

> The native-dispatch fixtures (ND1–ND4) that prove the dispatch contract.

Status: descriptive (SPEC-014).

---

## The fixtures

All fixtures live under `conformance/fixtures/native-dispatch-*` and run via `node conformance/runner.mjs --runtime claude-code --verify-ship --dir <fixture>`. Each carries a `.native-dispatch-fixture.json` sentinel with a `gate` (ND1–ND4).

| Fixture | Proves |
|---|---|
| ND1 parallel | N independent tasks (no `dependsOn`) dispatch as N `Agent` calls in one turn; no call carries an `isolation` field |
| ND2 advisory-locklist | two tasks sharing a lock-listed path (`package.json`) still dispatch in the same turn (no serialization); the prompt carries a non-enforcing advisory note |
| ND3 dependsOn | a task with an unmet `dependsOn` is not ready until its dependency is `done`, then dispatches in a later turn |
| ND4 per-task | Codex/Cursor `per-task` mode and `--task T-NNN` each dispatch exactly one `Agent` call per invocation |

---

## Running them

```bash
for fx in conformance/fixtures/native-dispatch-*; do
  node conformance/runner.mjs --runtime claude-code --verify-ship --dir "$fx"
done
```

The same suite runs in CI via `.github/workflows/ci-parallel-dispatch.yml` (one step per fixture so failures are named individually).

---

*Pairs with `architecture.md`.*
