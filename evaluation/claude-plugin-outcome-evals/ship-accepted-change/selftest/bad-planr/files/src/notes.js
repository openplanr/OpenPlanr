import { parseDueDate } from './dates.js';

export function createNote(title, body, options = {}) {
  if (typeof title !== 'string' || title.trim() === '') {
    throw new TypeError('A note needs a title');
  }
  parseDueDate(options.due);
  return {
    title: title.trim(),
    body: typeof body === 'string' ? body : null,
    due: options.due ?? null,
    done: false,
    tags: options.tags ?? [],
  };
}
