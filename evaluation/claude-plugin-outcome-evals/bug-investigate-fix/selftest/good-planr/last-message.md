## Investigation (BL-007)

**Root cause.** `parseDueDate` in `src/dates.js` calls `new Date('2026-03-10')`. JavaScript reads a
date-only string as midnight UTC, and `formatDueDate` then formats it with local-time getters. On the
Oregon hosts (`TZ=America/Los_Angeles`) midnight UTC is still 9 March locally, so every due date is
shown one day early. UTC and EU servers are at or east of UTC, which is why they look fine.

## Fix (T-001)

- `src/dates.js`: build the date from its year, month and day in local time, so parsing and formatting
  use the same calendar.
- `test/dates.test.js`: regression test that formats `2026-03-10` under `America/Los_Angeles`.

## Verification

`npm test`: 10 passed, 0 failed.
