import { SEMVER_PATTERN } from '../src/semver.mjs';

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const BASE = 'https://openplanr.dev/schemas/v1.8.0/';

const closed = (required, properties, extra = {}) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
  ...extra,
});

const relativePath = {
  type: 'string',
  minLength: 1,
  maxLength: 1024,
  pattern: '^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//).+$',
};

/** Protocol 1.8 describes the files that make one installed skill complete. */
export function buildSkillPackageSchemasV18() {
  const common = {
    $schema: SCHEMA,
    $id: `${BASE}common.schema.json`,
    'x-openplanr-contract': { id: 'skill-package-common', version: '1.8.0' },
    $defs: {
      semver: { type: 'string', pattern: SEMVER_PATTERN },
      skillId: {
        type: 'string',
        pattern: '^planr-[a-z0-9]+(?:-[a-z0-9]+)*$',
        maxLength: 128,
      },
      relativePath,
      host: { enum: ['claude-code', 'codex', 'chatgpt', 'cursor'] },
      resourceKind: {
        enum: ['reference', 'script', 'asset', 'schema', 'template', 'agent-metadata'],
      },
      resource: closed(
        ['path', 'kind', 'hosts', 'executable'],
        {
          path: { $ref: '#/$defs/relativePath' },
          kind: { $ref: '#/$defs/resourceKind' },
          hosts: {
            type: 'array',
            items: { $ref: '#/$defs/host' },
            minItems: 1,
            maxItems: 4,
            uniqueItems: true,
          },
          executable: { type: 'boolean' },
          description: { type: 'string', minLength: 1, maxLength: 512 },
        },
        {
          if: { properties: { kind: { const: 'script' } }, required: ['kind'] },
          then: {},
          else: { properties: { executable: { const: false } } },
        },
      ),
    },
  };

  const skillPackage = {
    $schema: SCHEMA,
    $id: `${BASE}skill-package.schema.json`,
    'x-openplanr-contract': { id: 'skill-package', version: '1.8.0' },
    ...closed(
      [
        'kind',
        'schemaVersion',
        'protocolVersion',
        'skillId',
        'skillVersion',
        'entrypoint',
        'hosts',
        'execution',
        'resources',
      ],
      {
        kind: { const: 'openplanr-skill-package' },
        schemaVersion: { const: '1.0.0' },
        protocolVersion: { const: '1.8.0' },
        skillId: { $ref: 'common.schema.json#/$defs/skillId' },
        skillVersion: { $ref: 'common.schema.json#/$defs/semver' },
        entrypoint: { const: 'SKILL.md' },
        hosts: {
          type: 'array',
          items: { $ref: 'common.schema.json#/$defs/host' },
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
        },
        execution: { enum: ['host-agent', 'deterministic-utility'] },
        resources: {
          type: 'array',
          items: { $ref: 'common.schema.json#/$defs/resource' },
          maxItems: 256,
        },
      },
    ),
  };

  const utilityCommandCatalog = {
    $schema: SCHEMA,
    $id: `${BASE}utility-command-catalog.schema.json`,
    'x-openplanr-contract': { id: 'utility-command-catalog', version: '1.8.0' },
    ...closed(
      ['kind', 'schemaVersion', 'protocolVersion', 'semanticBoundary', 'utilityBoundary', 'active', 'retired'],
      {
        kind: { const: 'openplanr-utility-command-catalog' },
        schemaVersion: { const: '1.0.0' },
        protocolVersion: { const: '1.8.0' },
        semanticBoundary: { const: 'host-agent' },
        utilityBoundary: { const: 'deterministic-cli' },
        active: {
          type: 'array',
          items: closed(['path', 'classification'], {
            path: { type: 'string', pattern: '^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*$' },
            classification: { const: 'deterministic-preserved' },
          }),
          minItems: 1,
        },
        retired: {
          type: 'array',
          items: closed(['path', 'classification'], {
            path: { type: 'string', pattern: '^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*$' },
            classification: {
              enum: ['semantic-moved-to-skill', 'obsolete-governance-retired', 'obsolete-facade-retired'],
            },
          }),
          minItems: 1,
        },
      },
    ),
  };

  return new Map([
    ['common.schema.json', common],
    ['skill-package.schema.json', skillPackage],
    ['utility-command-catalog.schema.json', utilityCommandCatalog],
  ]);
}
