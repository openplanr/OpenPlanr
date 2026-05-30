---
id: "T-001"
title: "Feature A (already merged before the crash)"
specId: "SPEC-G6"
slug: "feature-a-done"
schemaVersion: "1.0.0"
type: "Tech"
agent: "backend-agent"
status: "done"
---

# T-001 — Feature A (already merged before the crash)

This task completed and merged in the prior /ship run. Its target file
`src/feature-a.ts` already exists in the seeded tree. On re-run it MUST be
skipped (status stays `done`, no second dispatch, no re-merge).

## Files

### Modify

- `src/feature-a.ts`

### Preserve (do not touch)

- `src/index.ts`
