function addDays(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const byDue = (a, b) => a.due.localeCompare(b.due);
const toReminder = (overdue) => (note) => ({ id: note.id, title: note.title, due: note.due, overdue });

/**
 * Notes their owner should be reminded about on `today` (YYYY-MM-DD).
 * Returns an array of `{ id, title, due, overdue }`.
 */
export function remindersFor(notes, today) {
  const horizon = addDays(today, 2);
  const open = notes.filter((note) => !note.done && note.due && note.due <= horizon);
  const overdue = open.filter((note) => note.due < today).sort(byDue);
  const upcoming = open.filter((note) => note.due >= today).sort(byDue);
  return [...overdue.map(toReminder(true)), ...upcoming.map(toReminder(false))];
}
