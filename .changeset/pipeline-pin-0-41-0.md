---
'openplanr': patch
---

Fix `planr setup` failing against the published plugin tuple.

The CLI pins its pipeline sibling exactly in `optionalDependencies`, and at
runtime resolves the installed copy's version to decide which Claude plugin
version to expect — compared by strict equality. The 1.25.0 release shipped that
pin at `0.40.0` while publishing alongside pipeline `0.41.0`, so every `planr
setup` on a correctly-installed machine failed `E_CLAUDE_PLUGIN_UPDATE_FAILED`
and rolled back, reporting the user's newer plugin as drift. The skills plugin
target was stale for the same reason (`1.26.0`, published `1.26.1`), silently
omitting it from prescriptions.

Both pins now track the released tuple, and a new parity guard compares the
declared pin against the pipeline revision the environment resolves — the same
guard the skills bundle already had, which is why the release canary caught its
stale pin and nothing caught this one. No existing test could: the suites set
`OPENPLANR_PIPELINE_ROOT` to a source checkout, which bypasses the node_modules
resolution the pin governs.
