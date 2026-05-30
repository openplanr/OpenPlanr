---
id: "T-003"
title: "Cycle member C (src/c.ts + src/a.ts)"
specId: "SPEC-FD"
slug: "cycle-c"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
---

# T-003 — Cycle member C

Overlaps T-002 (B) on `src/c.ts` and T-001 (A) on `src/a.ts`. Closes the
A—B—C—A overlap cycle that trips Section 2's fail-fast fatal.

## Files

### Modify

- `src/c.ts`
- `src/a.ts`
