// Contracts only: a JSON-pointer resolver and schema identifiers, no read or send.
export const resolvePointer = (root, reference) =>
  reference.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, part) => value?.[part], root);
export const reviewSchema = { $id: 'https://openplanr.dev/schemas/v1.1.0/artifact-review.schema.json' };
