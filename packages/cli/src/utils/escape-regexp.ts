/** Escape every regular-expression syntax character so `value` matches only itself. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
