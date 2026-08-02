/**
 * Convert text to a URL/filename-safe slug.
 *
 * `maxLength` caps the slug (default 80) so filenames stay well under
 * the OS limit (255 chars) even after the ID prefix and `.md` extension.
 * The slug is trimmed at the last whole word boundary to avoid cut-off words.
 */
export declare function slugify(text: string, maxLength?: number): string;
//# sourceMappingURL=slugify.d.ts.map