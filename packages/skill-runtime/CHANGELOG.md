# @openplanr/skill-runtime

## 0.2.12
### Patch Changes

- 390d731: Add explicit second-agent implementation delegation with first-use engine discovery, destination enrollment and complete readable context. Support native Claude Code, Codex and Cursor with exact-session corrections and strict final results. Cursor requires explicit trusted-configuration enrollment; Claude retains shell and startup restrictions, and local template failures retain recovery state without exposing provider text.
  
  Separate preparation, execution, recovery and integration responsibilities. Run prepared, focused scratch checks and retain their evidence before applying a locked, journaled patch. Preserve concurrent edits, serialize stale-lock recovery, validate test paths and current metadata size, retain concrete error causes and provide worktree cleanup.
- Updated dependencies [390d731]
- Updated dependencies [f27d487]
- Updated dependencies [036f395]
  - @openplanr/protocol@0.9.0

## 0.2.11
### Patch Changes

- Updated dependencies [76ef9b3]
  - @openplanr/protocol@0.8.0

## 0.2.10
### Patch Changes

- Updated dependencies [496cd13]
  - @openplanr/protocol@0.7.3

## 0.2.9
### Patch Changes

- Updated dependencies [74fd3a5]
- Updated dependencies [b6a77c6]
  - @openplanr/protocol@0.7.2

## 0.2.8
### Patch Changes

- Updated dependencies [ec8b895]
  - @openplanr/protocol@0.7.1

## 0.2.7
### Patch Changes

- Updated dependencies [c7c15dc]
- Updated dependencies [c373710]
- Updated dependencies [c8ef5f5]
- Updated dependencies [2d3aa3f]
- Updated dependencies [504bce4]
- Updated dependencies [711e17f]
  - @openplanr/protocol@0.7.0

## 0.2.6
### Patch Changes

- Updated dependencies [4ce826e]
  - @openplanr/protocol@0.6.2

## 0.2.5
### Patch Changes

- Updated dependencies [3bcf955]
- Updated dependencies [3bcf955]
  - @openplanr/protocol@0.6.1

## 0.2.4
### Patch Changes

- Updated dependencies [4ae7379]
- Updated dependencies [d314fa2]
  - @openplanr/protocol@0.6.0

## 0.2.3
### Patch Changes

- Updated dependencies [6508d23]
  - @openplanr/protocol@0.5.0

## 0.2.2
### Patch Changes

- Updated dependencies [f93a973]
  - @openplanr/protocol@0.4.0

## 0.2.1
### Patch Changes

- Updated dependencies [7c0e86d]
  - @openplanr/protocol@0.3.0

## 0.2.0
### Minor Changes

- 622ce31: Shorten unified-plugin invocations to `planr:<verb>` across Codex and Claude
  Code while preserving canonical `planr-*` skill identities and Cursor rules.
  Migrate managed local installations from the former `openplanr` plugin
  namespace after the replacement package is installed.

### Patch Changes

- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
- Updated dependencies [622ce31]
  - @openplanr/protocol@0.2.0
