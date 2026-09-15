const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const BASE = 'https://openplanr.dev/schemas/v1.7.0/';

const id = (prefix) => ({ type: 'string', pattern: `^${prefix}-\\d{3,}$` });
const strings = (items = { type: 'string', minLength: 1 }) => ({
  type: 'array',
  items,
  uniqueItems: true,
});
const closed = (required, properties, extra = {}) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
  ...extra,
});

const commonArtifact = {
  id: { type: 'string' },
  title: { type: 'string', minLength: 1 },
  slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
  schemaVersion: { const: '1.7.0' },
  status: { enum: ['pending', 'implementing', 'in-progress', 'done', 'blocked'] },
  created: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  updated: { type: 'string', format: 'date', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
};

const acceptanceCriterion = closed(['id', 'statement'], {
  id: id('AC'),
  statement: { type: 'string', minLength: 1 },
});

export const PLANNING_V17_CONTRACT_FILES = Object.freeze({
  'planning-id-sequence': 'planning-id-sequence.schema.json',
  'request-authority': 'request-authority.schema.json',
  spec: 'spec.schema.json',
  story: 'story.schema.json',
  task: 'task.schema.json',
});

export function buildPlanningSchemas() {
  const spec = {
    $schema: SCHEMA,
    $id: `${BASE}spec.schema.json`,
    'x-openplanr-contract': { id: 'spec', version: '1.7.0' },
    ...closed(
      [
        'id', 'title', 'slug', 'schemaVersion', 'status', 'priority', 'created',
        'updated', 'ui_files', 'tech_dependencies',
      ],
      {
        ...commonArtifact,
        id: { type: 'string', pattern: '^(?:SPEC|FEAT)-\\d{3,}$' },
        status: {
          enum: [
            'pending', 'shaping', 'shaped', 'decomposing', 'decomposed',
            'ready-for-pipeline', 'in-pipeline', 'done',
          ],
        },
        priority: { enum: ['P0', 'P1', 'P2', 'P3'] },
        milestone: { type: 'string' },
        po: { type: 'string' },
        ui_files: strings(),
        tech_dependencies: strings(),
        specificationContract: { const: 'professional-specification@1.0.0' },
        review_specialists: {
          type: 'array',
          maxItems: 5,
          uniqueItems: true,
          items: {
            enum: [
              'security-reviewer', 'performance-reviewer', 'migration-reviewer',
              'api-contract-reviewer', 'data-integrity-reviewer',
            ],
          },
        },
        kanbanosId: { type: 'string', minLength: 8, pattern: '^[A-Za-z0-9_-]{8,128}$' },
        contentHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
      },
    ),
  };

  const story = {
    $schema: SCHEMA,
    $id: `${BASE}story.schema.json`,
    'x-openplanr-contract': { id: 'story', version: '1.7.0' },
    ...closed(
      ['id', 'title', 'slug', 'schemaVersion', 'status', 'created', 'updated', 'acceptanceCriteria'],
      {
        ...commonArtifact,
        id: id('US'),
        specId: id('SPEC'),
        featureSlug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        acceptanceCriteria: { type: 'array', items: acceptanceCriterion },
      },
      {
        oneOf: [
          { required: ['specId'], not: { required: ['featureSlug'] } },
          { required: ['featureSlug'], not: { required: ['specId'] } },
        ],
      },
    ),
  };

  const preserveEntry = closed(['repositoryKey', 'path'], {
    repositoryKey: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    path: { type: 'string', minLength: 1 },
  });
  const task = {
    $schema: SCHEMA,
    $id: `${BASE}task.schema.json`,
    'x-openplanr-contract': { id: 'task', version: '1.7.0' },
    ...closed(
      [
        'id', 'title', 'storyId', 'slug', 'schemaVersion', 'type', 'agent',
        'status', 'created', 'updated', 'dependsOn', 'preserve', 'reviewRisks',
        'browserSurfaces', 'acceptanceRefs',
      ],
      {
        ...commonArtifact,
        id: id('T'),
        storyId: id('US'),
        specId: id('SPEC'),
        featureSlug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' },
        type: { enum: ['UI', 'Tech'] },
        agent: { enum: ['frontend-agent', 'backend-agent', 'db-agent'] },
        rationale: { type: 'string', minLength: 1 },
        dependsOn: strings(id('T')),
        preserve: strings(preserveEntry),
        reviewRisks: strings({ enum: ['security', 'performance', 'migration', 'api-contract', 'data-integrity'] }),
        browserSurfaces: strings({ enum: ['ui', 'authentication', 'session', 'navigation', 'network'] }),
        acceptanceRefs: { type: 'array', items: id('AC'), uniqueItems: true },
      },
      {
        allOf: [
          {
            oneOf: [
              { required: ['specId'], not: { required: ['featureSlug'] } },
              { required: ['featureSlug'], not: { required: ['specId'] } },
            ],
          },
          {
            oneOf: [
              { properties: { type: { const: 'UI' }, agent: { const: 'frontend-agent' } }, required: ['type', 'agent'] },
              { properties: { type: { const: 'Tech' }, agent: { enum: ['backend-agent', 'db-agent'] } }, required: ['type', 'agent'] },
            ],
          },
        ],
      },
    ),
  };

  const planningIdSequence = {
    $schema: SCHEMA,
    $id: `${BASE}planning-id-sequence.schema.json`,
    'x-openplanr-contract': { id: 'planning-id-sequence', version: '1.7.0' },
    ...closed(['kind', 'schemaVersion', 'protocolVersion', 'next'], {
      kind: { const: 'planning-id-sequence' },
      schemaVersion: { const: '1.0.0' },
      protocolVersion: { const: '1.7.0' },
      next: closed(['SPEC', 'US', 'T'], {
        SPEC: { type: 'integer', minimum: 1 },
        US: { type: 'integer', minimum: 1 },
        T: { type: 'integer', minimum: 1 },
      }),
    }),
  };

  const requestAuthority = {
    $schema: SCHEMA,
    $id: `${BASE}request-authority.schema.json`,
    'x-openplanr-contract': { id: 'request-authority', version: '1.7.0' },
    ...closed(
      ['kind', 'schemaVersion', 'protocolVersion', 'repositoryAccess', 'capabilities', 'tools', 'forbiddenEffects'],
      {
        kind: { const: 'request-authority' },
        schemaVersion: { const: '1.0.0' },
        protocolVersion: { const: '1.7.0' },
        repositoryAccess: { enum: ['request-scope', 'declared-paths', 'read-only', 'none'] },
        capabilities: strings({ enum: ['context-gathering', 'local-execution', 'planning-write', 'read', 'read-only-view', 'write'] }),
        tools: strings({ enum: ['read', 'edit', 'shell'] }),
        forbiddenEffects: strings(),
      },
    ),
  };

  return new Map([
    ['planning-id-sequence.schema.json', planningIdSequence],
    ['request-authority.schema.json', requestAuthority],
    ['spec.schema.json', spec],
    ['story.schema.json', story],
    ['task.schema.json', task],
  ]);
}
