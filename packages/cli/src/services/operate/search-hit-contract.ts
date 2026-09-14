export type AccessSafeOperateSearchHitV1 = Readonly<{
  kind: string;
  subjectId: string;
  title: string;
  summary: string | null;
  state: string | null;
  deepLink: string | null;
}>;

/** Copy the closed fields from rows that already passed the owner display validator. */
export function projectAccessSafeOperateSearchHits(
  results: unknown,
): readonly AccessSafeOperateSearchHitV1[] {
  if (!Array.isArray(results)) return Object.freeze([]);
  const hits: AccessSafeOperateSearchHitV1[] = [];
  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) continue;
    const kind = Reflect.get(entry, 'kind');
    const subjectId = Reflect.get(entry, 'subjectId');
    const title = Reflect.get(entry, 'title');
    const summary = Reflect.get(entry, 'summary');
    const state = Reflect.get(entry, 'state');
    const deepLink = Reflect.get(entry, 'deepLink');
    if (typeof kind !== 'string' || typeof subjectId !== 'string' || typeof title !== 'string') {
      continue;
    }
    hits.push(
      Object.freeze({
        kind,
        subjectId,
        title,
        summary: typeof summary === 'string' ? summary : null,
        state: typeof state === 'string' ? state : null,
        deepLink:
          typeof deepLink === 'string' && deepLink.startsWith('#/operate/') ? deepLink : null,
      }),
    );
  }
  return Object.freeze(hits);
}
