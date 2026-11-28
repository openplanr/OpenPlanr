## Investigation (BL-007)

**Root cause.** The Oregon hosts' system clock runs behind, so stored due dates drift back by a day.

## Fix (T-001)

- `src/dates.js`: add one day when formatting a due date to compensate for the clock.
- `test/dates.test.js`: regression test under `America/Los_Angeles`.

## Verification

`npm test`: 10 passed, 0 failed.
