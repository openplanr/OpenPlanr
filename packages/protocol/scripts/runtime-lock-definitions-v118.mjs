import { readFileSync } from 'node:fs';

/** Extend the frozen adapter lock with recorded native discovery choices. */
export function buildRuntimeLockSchemasV118() {
  const schema = JSON.parse(
    readFileSync(new URL('../schemas/v1.1.0/runtime-lock.schema.json', import.meta.url), 'utf8'),
  );
  schema.$id = 'https://openplanr.dev/schemas/v1.18.0/runtime-lock.schema.json';
  schema['x-openplanr-contract'] = { id: 'runtime-lock', version: '1.18.0' };
  schema.properties.skillModes = {
    type: 'object',
    additionalProperties: false,
    properties: {
      'claude-code': { const: 'unified-plugin' },
      codex: { type: 'string', enum: ['direct', 'unified-plugin', 'project-rule'] },
      cursor: { const: 'project-rule' },
    },
  };
  return new Map([['runtime-lock.schema.json', schema]]);
}
