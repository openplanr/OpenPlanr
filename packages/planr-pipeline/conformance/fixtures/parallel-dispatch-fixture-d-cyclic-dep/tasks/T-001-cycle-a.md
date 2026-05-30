---
id: "T-001"
title: "Cycle member A (src/a.ts + src/b.ts)"
specId: "SPEC-FD"
slug: "cycle-a"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
---

# T-001 — Cycle member A

Overlaps T-002 (B) on `src/b.ts` and T-003 (C) on `src/a.ts`. With T-002 and
T-003 forming the rest of the triangle, the mutual-overlap graph A—B—C—A is
cyclic, so the dispatcher must fail fast (Section 2) and dispatch nothing.

## Files

### Modify

- `src/a.ts`
- `src/b.ts`
