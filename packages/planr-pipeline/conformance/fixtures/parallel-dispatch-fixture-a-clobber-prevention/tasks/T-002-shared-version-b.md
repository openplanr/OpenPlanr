---
id: "T-002"
title: "Set shared module to version-B"
specId: "SPEC-FA"
slug: "shared-version-b"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
---

# T-002 — Set shared module to version-B

Writes `src/shared.ts` with content "version-B". Runs in a LATER wave (wave 1)
because it conflicts with T-001 on src/shared.ts. Its merge lands LAST, so the
final main copy is version-B — no clobber, because T-001 fully merged before
T-002 was ever dispatched.

## Files

### Modify

- `src/shared.ts`
