/**
 * Convert text to a URL/filename-safe slug.
 *
 * `maxLength` caps the slug (default 80) so filenames stay well under
 * the OS limit (255 chars) even after the ID prefix and `.md` extension.
 * The slug is trimmed at the last whole word boundary to avoid cut-off words.
 */
export function slugify(text: string, maxLength = 80): string {
  let slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength);
    // Trim at last whole-word boundary to avoid cut-off words
    const lastDash = slug.lastIndexOf('-');
    if (lastDash > 0) {
      slug = slug.slice(0, lastDash);
    }
  }

  return slug;
}
