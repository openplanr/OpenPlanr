---
id: SPEC-001
status: accepted
---
# Due-date reminders

## Requirements

- FR-1: `remindersFor(notes, today)` returns notes due today, tomorrow or the day after.
- FR-2: Overdue notes are included with `overdue: true` and listed before upcoming notes.
- FR-3: Notes marked done and notes without a due date are left out.
- FR-4: Within each group, notes are ordered by due date, earliest first.

## Non-goals

- Email or push notifications.
