I implemented `remindersFor(notes, today)`: it returns notes due today or in the next two days plus any
overdue ones, overdue first and marked `overdue: true`, each group sorted by due date, and it skips notes
that are done or have no due date.
