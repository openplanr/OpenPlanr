/**
 * Notes their owner should be reminded about on `today` (YYYY-MM-DD).
 * Returns an array of `{ id, title, due, overdue }`.
 */
export function remindersFor(notes, today) {
  const start = Date.parse(today);
  const week = start + 7 * 24 * 60 * 60 * 1000;
  return notes
    .filter((note) => note.due && Date.parse(note.due) >= start && Date.parse(note.due) <= week)
    .map((note) => ({ id: note.id, title: note.title, due: note.due, overdue: false }));
}
