import { readFileSync } from 'node:fs';

/** Add shared source references without altering the published inline envelope schema. */
export function buildSharedArtifactEnvelopeSchema() {
  const schema = JSON.parse(
    readFileSync(
      new URL('../schemas/v1.1.0/artifact-envelope.schema.json', import.meta.url),
      'utf8',
    ),
  );
  schema.$id = 'https://openplanr.dev/schemas/v1.16.0/artifact-envelope.schema.json';
  schema.title = 'OpenPlanr shared-source artifact envelope';
  schema['x-openplanr-contract'] = { id: 'artifact-envelope', version: '1.16.0' };
  schema.required.push('sources');
  schema.properties.schemaVersion.const = '1.1.0';
  schema.properties.artifacts.maxItems = 4096;
  const item = schema.properties.artifacts.items;
  const html = item.properties.html;
  delete item.properties.html;
  item.required = item.required.filter((name) => name !== 'html').concat('sourceId');
  item.properties.sourceId = structuredClone(item.properties.id);
  schema.properties.sources = {
    type: 'array',
    minItems: 1,
    maxItems: 256,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'kind', 'sha256', 'html'],
      properties: {
        id: structuredClone(item.properties.id),
        kind: { const: 'html' },
        sha256: structuredClone(item.properties.sha256),
        html,
      },
    },
  };
  return schema;
}
