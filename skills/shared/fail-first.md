# Fail-first

A check proves an acceptance criterion only if it fails without the change.

## Applies to

A check mapped to an acceptance ID, or a test written for this task. For
Investigate, the regression test for the fix.

## Fail-first

- Write or run the check before the implementation. It counts only when the
  runner reports at least one failed assertion or test.
- A load error does not count: a missing module, a syntax or compile error, "no
  tests found", or a collection error. Report it as "fails only on load".
- If the runner output is unclear, say so instead of guessing.
- A test written after the code is `not-run` for fail-first. Never revert the
  implementation to prove it.

A check that already passes before the change: report "passes before the change;
proves nothing" and ask one host-native question with the default "narrow the
check". An unattended run takes the default and reports it.

## Seeded fault

Off by default. Offer it only when an acceptance check is new code or fail-first
failed only on load; the question's default is skip.

1. Record `git status --porcelain` and confirm nothing staged (`git diff --cached --quiet`).
2. Copy the target file.
3. Make one small edit that breaks behaviour the criterion names.
4. Rebuild if the tests run built output.
5. Run the check. It must fail on an assertion.
6. Restore from the copy, not with `git checkout`, which also discards the
   uncommitted implementation.
7. Confirm `cmp` against the copy, an identical `--porcelain` output, and nothing staged.

A seed that survives goes in `checks` with a question whose default is "add a
test for it". Report all of this in the existing `checks` result text: no new
field, no new stop, no record file.
