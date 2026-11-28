const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDueDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new TypeError(`Due date must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  return new Date(value);
}

function pad(number) {
  return String(number).padStart(2, '0');
}

export function formatDueDate(value) {
  const date = parseDueDate(value);
  if (date === null) return '';
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
