// Contracts only: schema identifiers and design-token checks, no read or send.
const PROP_TOKEN_SCHEMA = { type: 'string', pattern: '^[a-z][a-z0-9-]*$', maxLength: 128 };
export const designDocumentSchema = {
  $id: 'https://openplanr.dev/schemas/v1.22.0/design-document.schema.json',
  propertyNames: PROP_TOKEN_SCHEMA,
};
export const validateDesignDocument = (value) => typeof value === 'object';
