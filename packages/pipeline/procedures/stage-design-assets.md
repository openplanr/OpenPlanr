# Procedure: `STAGE_DESIGN_ASSETS` (Step 0.9)

Referenced by `SCAFFOLD_NODE` (only). Moves pre-existing design assets out of the project root before a scaffolder that requires an empty directory.

**Recognized patterns** (only these):

- Folders: `Designs/`, `design/`, `designs/`, `mockups/`, `mocks/`, `assets/`, `wireframes/`
- Top-level files: `*.png`, `*.jpg`, `*.jpeg`, `*.svg`, `*.gif`, `*.webp`

## Steps

1. Compute `STASH_DIR = /tmp/planr-pipeline-stash/<SLUG>-<unix-timestamp>/`. Bind `STASH_DIR` for `RESTORE_DESIGN_ASSETS`.
2. Scan the project root (top level only). Build `KNOWN_ASSETS` vs `UNKNOWN_FILES` (non-hidden).
3. If `UNKNOWN_FILES` is non-empty, **abort** with the scaffold-blocker message from `strategy-scaffold-node.md`.
4. If `KNOWN_ASSETS` is empty, log `→ No pre-existing assets to stage.` and return.
5. Else print moves: `⚠ Pre-existing design assets detected...` listing each → `STASH_DIR`.
6. `mkdir -p "$STASH_DIR"` and `mv` each KNOWN_ASSET into it (preserve names).
7. Verify project root is empty (or hidden only); else abort: `⚠ STAGE_DESIGN_ASSETS could not clear the project root`.

**Failure:** if `mv` fails, abort. Do NOT continue scaffolding.
