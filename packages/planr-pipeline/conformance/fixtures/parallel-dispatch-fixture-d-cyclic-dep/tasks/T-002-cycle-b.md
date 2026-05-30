---
id: "T-002"
title: "Cycle member B (src/b.ts + src/c.ts)"
specId: "SPEC-FD"
slug: "cycle-b"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "pending"
---

# T-002 — Cycle member B

Overlaps T-001 (A) on `src/b.ts` and T-003 (C) on `src/c.ts`. Part of the
A—B—C—A overlap cycle that trips Section 2's fail-fast fatal.

## Files

### Modify

- `src/b.ts`
- `src/c.ts`
