# Procedure: `RESTORE_DESIGN_ASSETS` (Step 0.10)

Referenced after the spec scaffold creates `.planr/specs/SPEC-NNN-${SLUG}/design/`.

## Steps

1. Read session `STASH_DIR` from `STAGE_DESIGN_ASSETS`. If unset, return.
2. Verify `.planr/specs/SPEC-NNN-${SLUG}/design/` exists. If not → `⚠ RESTORE_DESIGN_ASSETS called before spec scaffold. State error.`
3. **Copy** everything from `STASH_DIR` into that `design/` folder. Flatten nested folders (e.g. `Designs/inbox.png` → `design/inbox.png`).
4. Verify counts/sizes vs stash.
5. Delete `STASH_DIR` after verification passes.
6. Print: `✓ Restored N design asset(s) to .planr/specs/SPEC-NNN-${SLUG}/design/`

## Failure path (scaffolder failed before spec exists)

**Move** stash back to original locations in project root (not copy), delete stash dir — restores pre-pipeline state.
