---
"openplanr": patch
---

Make `setup` and `doctor` describe the install they actually produced.

**`doctor` names the skill file that exists.** Its three `operate-skill` messages hardcoded
the namespaced `planr-operate`, so a `--no-prefix` install — where the file on disk is
`operate` — got a diagnostic with the right status about a filename the user does not have.
All three now interpolate the installed name.

**The setup preview states the naming scheme.** The choice is persisted per project, so a
plain re-run could install bare verbs with nothing in the summary saying so. The preview
now reports `Command names: namespaced` or `bare (--no-prefix)`, resolved from the same
value the installer uses.

**The Cursor no-op is now pinned by a test.** `applyCommandPrefix` is threaded through the
Cursor branch but computes identity there, since no Cursor rule filename starts with
`planr-`. That "intentional symmetry, not dead code" claim rested entirely on a source
comment; a later broadening of the prefix match would have silently begun renaming Cursor
rules with nothing to catch it.
