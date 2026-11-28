import { parseDueDate } from './dates.js';

function normalizeTags(tags) {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) {
    throw new TypeError('tags must be an array of strings');
  }
  const cleaned = tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== '');
  return [...new Set(cleaned)].sort();
}

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
    tags: normalizeTags(options.tags),
  };
}
