import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Hex, withDocumentDigest } from '../src/canonical-json.mjs';
import { SEMVER_PATTERN } from '../src/semver.mjs';
import {
  SKILL_SOURCE_V16_CONTRACT_FILES,
  SKILL_SOURCE_V16_REGISTRIES,
} from '../src/skill-source-contracts.mjs';
import { ROOT_COMMAND_SLUGS } from './protocol-definitions.mjs';
import { collectCanonicalModuleGraph } from './skill-registry-source.mjs';

// Additive Protocol 1.6 skill-source vocabulary. This module is version-specific
// and never relabels or mutates the closed Protocol 1.1 or 1.5 contracts. The
// generator routes every schema here to schemas/v1.6.0 and every registry to the
// version-correct public package path.

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const BASE = 'https://openplanr.dev/schemas/v1.6.0/';
const PROTOCOL_VERSION = '1.6.0';

const COMPILER_OPERATION_SLUGS = ['compile', 'render'];
const OPERATION_AUTHORITY_SLUGS = [...new Set([
  ...ROOT_COMMAND_SLUGS,
  ...COMPILER_OPERATION_SLUGS,
])].sort((left, right) => left.localeCompare(right));

const GUIDED_QUESTION_REF = 'https://openplanr.dev/schemas/v1.2.0/guided-question.schema.json';
const GUIDED_CONFIRMATION_REF = 'https://openplanr.dev/schemas/v1.2.0/guided-confirmation.schema.json';

const ref = (name) => ({ $ref: `common.schema.json#/$defs/${name}` });
const nullableRef = (name) => ({ anyOf: [ref(name), { type: 'null' }] });
const array = (items, minItems = 0, maxItems = 4096, uniqueItems = false) => ({
  type: 'array', items, minItems, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}),
});
const closed = (required, properties, extra = {}) => ({
  type: 'object', additionalProperties: false, required, properties, ...extra,
});

const envelopeProperties = {
  kind: { type: 'string', minLength: 1, maxLength: 96 },
  schemaVersion: ref('semver'),
  protocolVersion: { const: PROTOCOL_VERSION },
  documentVersion: ref('semver'),
  digestAlgorithm: { const: 'sha256' },
  canonicalization: { const: 'rfc8785' },
  documentDigest: ref('digest'),
};
const envelopeRequired = Object.keys(envelopeProperties);

function documentSchema(name, kind, schemaVersion, required, properties, extra = {}) {
  return {
    $schema: SCHEMA,
    $id: `${BASE}${name}.schema.json`,
    'x-openplanr-contract': { id: name, version: PROTOCOL_VERSION },
    ...closed(
      [...envelopeRequired, ...required],
      { ...envelopeProperties, kind: { const: kind }, schemaVersion: { const: schemaVersion }, ...properties },
      extra,
    ),
  };
}

const moduleRef = ref('moduleRef');
const authorityCeiling = ref('authorityCeiling');
const sourceRef = ref('sourceRef');
const sourceMapRange = ref('sourceMapRange');

export function buildSkillSourceSchemas() {
  const common = {
    $schema: SCHEMA,
    $id: `${BASE}common.schema.json`,
    'x-openplanr-contract': { id: 'skill-source-common', version: PROTOCOL_VERSION },
    $defs: {
      digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      semver: { type: 'string', pattern: SEMVER_PATTERN },
      dateTime: { type: 'string', format: 'date-time' },
      nonBlankText: { type: 'string', minLength: 1, maxLength: 16384, pattern: '.*\\S.*' },
      identifier: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', minLength: 1, maxLength: 128 },
      // Closed authority vocabularies. The ceiling components below reference these
      // instead of the free identifier grammar so an invented capability, tool, or
      // operation is rejected by shape rather than silently accepted.
      capabilityAuthority: { enum: ['context-gathering', 'planning-write', 'read', 'read-only-view', 'write'] },
      operationAuthority: { enum: OPERATION_AUTHORITY_SLUGS },
      // Abstract composed-v1 tool vocabulary plus the raw host tool-authority
      // syntax used by canonical SKILL.md frontmatter (Title-case base name with an
      // optional parenthesized scope, e.g. Bash(git log:*)).
      toolAuthority: {
        type: 'string', minLength: 1, maxLength: 128,
        pattern: '^(?:read|edit|shell|Bash|Edit|Glob|Grep|Read|Write)(?:\\([^()]+\\))?$',
      },
      skillId: { type: 'string', pattern: '^planr-[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128 },
      moduleId: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', minLength: 1, maxLength: 128 },
      relativePath: {
        type: 'string', minLength: 1, maxLength: 1024,
        pattern: '^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//).+$',
      },
      host: { enum: ['claude-code', 'codex', 'cursor', 'pipeline'] },
      runtimeCapability: { enum: ['attached-terminal', 'native-questions', 'structured-chat'] },
      interactionSurface: { enum: ['native', 'chat', 'terminal', 'headless'] },
      protocolInteraction: { enum: ['native', 'chat', 'terminal', 'none'] },
      interactionBinding: closed(['surface', 'protocolInteraction'], {
        surface: { $ref: '#/$defs/interactionSurface' },
        protocolInteraction: { $ref: '#/$defs/protocolInteraction' },
        capabilityId: { $ref: '#/$defs/runtimeCapability' },
      }, {
        oneOf: [
          {
            title: 'Native composer surface',
            required: ['capabilityId'],
            properties: {
              surface: { const: 'native' },
              protocolInteraction: { const: 'native' },
              capabilityId: { const: 'native-questions' },
            },
          },
          {
            title: 'Structured chat surface',
            required: ['capabilityId'],
            properties: {
              surface: { const: 'chat' },
              protocolInteraction: { const: 'chat' },
              capabilityId: { const: 'structured-chat' },
            },
          },
          {
            title: 'Attached terminal surface',
            required: ['capabilityId'],
            properties: {
              surface: { const: 'terminal' },
              protocolInteraction: { const: 'terminal' },
              capabilityId: { const: 'attached-terminal' },
            },
          },
          {
            title: 'Non-interactive headless fallback',
            properties: {
              surface: { const: 'headless' },
              protocolInteraction: { const: 'none' },
            },
            not: { required: ['capabilityId'] },
          },
        ],
      }),
      sourceFormat: {
        // markdown-v1 is the frozen compatibility rendering of the current
        // whole-Markdown skills; composed-v1 is the new declarative graph.
        enum: ['markdown-v1', 'composed-v1'],
      },
      contractRef: closed(['id', 'version'], {
        id: { $ref: '#/$defs/identifier' }, version: { $ref: '#/$defs/semver' },
      }),
      sourceRef: closed(['path', 'digest'], {
        path: { $ref: '#/$defs/relativePath' }, digest: { $ref: '#/$defs/digest' },
      }),
      moduleRef: closed(['moduleId', 'moduleVersion', 'digest'], {
        // Pinned exact version; ranges and floating tags are rejected by shape.
        moduleId: { $ref: '#/$defs/moduleId' }, moduleVersion: { $ref: '#/$defs/semver' }, digest: { $ref: '#/$defs/digest' },
      }),
      authorityCeiling: closed(
        ['repositoryAccess', 'externalDataAccess', 'allowedCapabilities', 'allowedTools', 'allowedOperations', 'allowedOutputClasses', 'forbiddenEffects'],
        {
          // Component-wise monotone ceiling. A shared module or host overlay may
          // narrow each component but never widen it; T-002 enforces the graph
          // narrowing, this shape only fixes the lattice domains.
          repositoryAccess: {
            enum: ['declared-paths', 'read-only', 'none'],
            description: 'Narrowing order declared-paths -> read-only -> none.',
          },
          externalDataAccess: {
            enum: ['read-only', 'none'],
            description: 'Narrowing order read-only -> none.',
          },
          allowedCapabilities: { ...array({ $ref: '#/$defs/capabilityAuthority' }, 0, 128, true), description: 'Closed ceiling set; overlays may only remove members.' },
          allowedTools: { ...array({ $ref: '#/$defs/toolAuthority' }, 0, 128, true), description: 'Closed ceiling set; overlays may only remove members.' },
          allowedOperations: { ...array({ $ref: '#/$defs/operationAuthority' }, 0, 128, true), description: 'Closed ceiling set; overlays may only remove members.' },
          allowedOutputClasses: { ...array({ enum: ['A', 'B', 'C', 'D'] }, 0, 4, true), description: 'Ceiling set; overlays may only remove members.' },
          forbiddenEffects: { ...array({ $ref: '#/$defs/identifier' }, 0, 64, true), description: 'Grows only; overlays may only add members.' },
        },
      ),
      sourceMapOwner: closed(['ownerKind', 'pointer', 'version', 'digest'], {
        // Literal and separator bytes are owned by a versioned template;
        // substitutions are owned by the exact source or host-profile pointer;
        // compiler-internal constant tables are owned by the compiler source.
        ownerKind: { enum: ['template', 'source', 'host-profile', 'compiler'] },
        pointer: { $ref: '#/$defs/relativePath' },
        version: { $ref: '#/$defs/semver' },
        digest: { $ref: '#/$defs/digest' },
      }),
      sourceMapRange: closed(['startByte', 'endByte', 'owner'], {
        // UTF-8 byte offsets; startByte inclusive, endByte exclusive. Ordering,
        // gap-free, non-overlapping coverage is a T-002 execution check.
        startByte: { type: 'integer', minimum: 0 },
        endByte: { type: 'integer', minimum: 1 },
        owner: { $ref: '#/$defs/sourceMapOwner' },
      }),
      envelope: closed(envelopeRequired, envelopeProperties),
    },
  };

  const skillSource = documentSchema('skill-source', 'skill-source', '1.0.0', [
    'skillId', 'skillVersion', 'sourceFormat', 'authorityCeiling',
  ], {
    skillId: ref('skillId'),
    skillVersion: ref('semver'),
    sourceFormat: ref('sourceFormat'),
    authorityCeiling,
    // Presence selects the corresponding oneOf branch, so these values must be
    // real source references. Accepting null would satisfy `required` while
    // leaving the selected source mode without readable bytes.
    markdown: sourceRef,
    template: sourceRef,
    modules: array(moduleRef, 0, 256),
    references: array(closed(['module', 'routed'], { module: moduleRef, routed: { const: true } }), 0, 256),
    // markdown-v1 compatibility documents may omit host selection entirely;
    // the composed-v1 branch below tightens this same property to one or more.
    hostProfiles: array(ref('contractRef'), 0, 8, true),
    guidedQuestions: array({ $ref: GUIDED_QUESTION_REF }, 0, 64),
  }, {
    oneOf: [
      {
        title: 'markdown-v1 compatibility source',
        required: ['markdown'],
        properties: { sourceFormat: { const: 'markdown-v1' } },
        not: { anyOf: [{ required: ['template'] }, { required: ['modules'] }, { required: ['references'] }] },
      },
      {
        title: 'composed-v1 source graph',
        required: ['template', 'modules', 'hostProfiles'],
        properties: {
          sourceFormat: { const: 'composed-v1' },
          hostProfiles: array(ref('contractRef'), 1, 8, true),
        },
        not: { required: ['markdown'] },
      },
    ],
  });

  const skillModuleRegistry = documentSchema('skill-module-registry', 'skill-module-registry', '1.0.0', ['modules'], {
    modules: array(closed(
      ['moduleId', 'moduleVersion', 'moduleKind', 'description', 'authorityCeiling', 'source', 'appliesWhen', 'dependsOn', 'references'],
      {
        moduleId: ref('moduleId'),
        moduleVersion: ref('semver'),
        moduleKind: { enum: ['lifecycle', 'context', 'review', 'implementation', 'shared'] },
        description: ref('nonBlankText'),
        authorityCeiling,
        source: sourceRef,
        appliesWhen: ref('nonBlankText'),
        dependsOn: array(moduleRef, 0, 64),
        references: array(moduleRef, 0, 64),
      },
    ), 0, 512),
  });

  const hostProfileRequired = [
    'hostProfileId',
    'hostProfileVersion',
    'host',
    'description',
    'authorityCeiling',
    'source',
    'overlayModules',
  ];
  const hostProfileProperties = {
    hostProfileId: ref('identifier'),
    hostProfileVersion: ref('semver'),
    host: ref('host'),
    description: ref('nonBlankText'),
    authorityCeiling,
    source: sourceRef,
    overlayModules: array(moduleRef, 0, 64),
  };
  const legacyHostProfile = closed(hostProfileRequired, hostProfileProperties);
  const interactiveBinding = {
    allOf: [
      ref('interactionBinding'),
      { properties: { surface: { enum: ['native', 'chat', 'terminal'] } } },
    ],
  };
  const headlessBinding = {
    allOf: [
      ref('interactionBinding'),
      { properties: { surface: { const: 'headless' } } },
    ],
  };
  const interactionBindingSequence = {
    type: 'array',
    minItems: 1,
    maxItems: 4,
    uniqueItems: true,
    oneOf: [
      { items: interactiveBinding },
      { maxItems: 1, prefixItems: [headlessBinding], items: false },
      { minItems: 2, maxItems: 2, prefixItems: [interactiveBinding, headlessBinding], items: false },
      { minItems: 3, maxItems: 3, prefixItems: [interactiveBinding, interactiveBinding, headlessBinding], items: false },
      {
        minItems: 4,
        maxItems: 4,
        prefixItems: [interactiveBinding, interactiveBinding, interactiveBinding, headlessBinding],
        items: false,
      },
    ],
  };
  const declaredBindingCapability = (surface, capabilityId) => ({
    if: {
      properties: {
        interactionBindings: {
          contains: {
            type: 'object',
            required: ['surface'],
            properties: { surface: { const: surface } },
          },
        },
      },
    },
    then: {
      properties: {
        runtimeCapabilities: { contains: { const: capabilityId } },
      },
    },
  });
  const capabilityHostProfile = closed(
    [...hostProfileRequired, 'runtimeCapabilities', 'interactionBindings'],
    {
      ...hostProfileProperties,
      runtimeCapabilities: array(ref('runtimeCapability'), 0, 16, true),
      interactionBindings: interactionBindingSequence,
    },
    {
      allOf: [
        declaredBindingCapability('native', 'native-questions'),
        declaredBindingCapability('chat', 'structured-chat'),
        declaredBindingCapability('terminal', 'attached-terminal'),
      ],
    },
  );
  const skillHostProfileRegistry = {
    $schema: SCHEMA,
    $id: `${BASE}skill-host-profile-registry.schema.json`,
    'x-openplanr-contract': { id: 'skill-host-profile-registry', version: PROTOCOL_VERSION },
    ...closed(
      [...envelopeRequired, 'profiles'],
      {
        ...envelopeProperties,
        kind: { const: 'skill-host-profile-registry' },
        schemaVersion: { enum: ['1.0.0', '1.1.0'] },
        profiles: { type: 'array' },
      },
      {
        oneOf: [
          {
            title: 'Legacy host-profile registry',
            properties: {
              schemaVersion: { const: '1.0.0' },
              documentVersion: { const: '1.0.0' },
              profiles: array(legacyHostProfile, 0, 128),
            },
          },
          {
            title: 'Capability-aware host-profile registry',
            properties: {
              schemaVersion: { const: '1.1.0' },
              documentVersion: { const: '1.1.0' },
              profiles: array({ oneOf: [legacyHostProfile, capabilityHostProfile] }, 0, 128),
            },
          },
        ],
      },
    ),
  };

  const skillRoutingRegistry = documentSchema('skill-routing-registry', 'skill-routing-registry', '1.0.0', ['policies'], {
    policies: array(closed(
      ['routingPolicyId', 'routingPolicyVersion', 'description', 'includeModules', 'references', 'order'],
      {
        routingPolicyId: ref('identifier'),
        routingPolicyVersion: ref('semver'),
        description: ref('nonBlankText'),
        includeModules: array(moduleRef, 0, 128),
        references: array(moduleRef, 0, 128),
        order: { enum: ['declared', 'topological'] },
      },
    ), 0, 128),
  });

  // Optional reporting-only data. This contract records a completed skill run
  // when a caller wants a portable summary; no Plan, Review, Ship, generator,
  // compiler, or runtime transition may require it as a prerequisite.
  const skillCompletionReceipt = documentSchema('skill-completion-receipt', 'skill-completion-receipt', '1.0.0', [
    'skillId', 'skillVersion', 'sourceFormat', 'completedAt', 'summary', 'selectedModules',
  ], {
    skillId: ref('skillId'),
    skillVersion: ref('semver'),
    sourceFormat: ref('sourceFormat'),
    completedAt: ref('dateTime'),
    summary: ref('nonBlankText'),
    selectedModules: array(moduleRef, 0, 256),
  }, {
    description: 'Optional reporting-only summary; never a Plan, Review, Ship, generation, or runtime prerequisite.',
  });

  const skillConsentRecord = documentSchema('skill-consent-record', 'skill-consent-record', '1.0.0', [
    'consentId', 'skillId', 'subject', 'decision', 'recordedAt', 'confirmation',
  ], {
    consentId: ref('identifier'),
    skillId: ref('skillId'),
    subject: { enum: ['learning', 'telemetry', 'external-data'] },
    decision: { enum: ['granted', 'declined', 'withdrawn'] },
    recordedAt: ref('dateTime'),
    // Consent reuses the existing guided confirmation vocabulary rather than a
    // second question/consent shape.
    confirmation: { $ref: GUIDED_CONFIRMATION_REF },
  });

  const skillLearningRecord = documentSchema('skill-learning-record', 'skill-learning-record', '1.0.0', [
    'learningId', 'skillId', 'observedAt', 'category', 'note', 'consentGranted', 'consentRef',
  ], {
    learningId: ref('identifier'),
    skillId: ref('skillId'),
    observedAt: ref('dateTime'),
    category: { enum: ['context', 'review', 'implementation', 'diagnostic'] },
    note: ref('nonBlankText'),
    consentGranted: { type: 'boolean' },
    // A learning declaration cannot imply consent; it must point at an explicit
    // consent record or declare its absence.
    consentRef: nullableRef('identifier'),
  }, {
    allOf: [
      { if: { properties: { consentGranted: { const: true } } }, then: { properties: { consentRef: ref('identifier') } } },
      { if: { properties: { consentGranted: { const: false } } }, then: { properties: { consentRef: { type: 'null' } } } },
    ],
  });

  const skillSession = documentSchema('skill-session', 'skill-session', '1.0.0', [
    'sessionId', 'skillId', 'startedAt', 'state', 'questions',
  ], {
    sessionId: { type: 'string', pattern: '^GIS-[A-Za-z0-9._-]{8,128}$' },
    skillId: ref('skillId'),
    startedAt: ref('dateTime'),
    state: { enum: ['open', 'answered', 'closed', 'expired'] },
    questions: array({ $ref: GUIDED_QUESTION_REF }, 0, 64),
  });

  const skillCatalog = documentSchema('skill-catalog', 'skill-catalog', PROTOCOL_VERSION, ['catalogVersion', 'sources'], {
    catalogVersion: ref('semver'),
    sources: array(closed(
      ['skillId', 'skillVersion', 'sourceFormat', 'sourceDigest', 'moduleGraphDigest', 'source'],
      {
        skillId: ref('skillId'),
        skillVersion: ref('semver'),
        sourceFormat: ref('sourceFormat'),
        sourceDigest: ref('digest'),
        moduleGraphDigest: ref('digest'),
        source: sourceRef,
      },
    ), 0, 256),
  });

  const generatedAssetManifest = documentSchema('generated-asset-manifest', 'generated-asset-manifest', PROTOCOL_VERSION, [
    'assetSetId', 'sourceFormat', 'assets',
  ], {
    assetSetId: { type: 'string', pattern: '^sas_[0-9a-f]{32}$' },
    sourceFormat: ref('sourceFormat'),
    assets: array(closed(
      ['path', 'host', 'mediaType', 'byteLength', 'digest', 'sourceMap'],
      {
        path: ref('relativePath'),
        host: { anyOf: [ref('host'), { type: 'null' }] },
        mediaType: { type: 'string', pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' },
        byteLength: { type: 'integer', minimum: 0 },
        digest: ref('digest'),
        sourceMap: array(sourceMapRange, 0, 8192),
      },
    ), 0, 8192),
  });

  return new Map([
    ['common.schema.json', common],
    ['skill-source.schema.json', skillSource],
    ['skill-module-registry.schema.json', skillModuleRegistry],
    ['skill-host-profile-registry.schema.json', skillHostProfileRegistry],
    ['skill-routing-registry.schema.json', skillRoutingRegistry],
    ['skill-completion-receipt.schema.json', skillCompletionReceipt],
    ['skill-consent-record.schema.json', skillConsentRecord],
    ['skill-learning-record.schema.json', skillLearningRecord],
    ['skill-session.schema.json', skillSession],
    ['skill-catalog.schema.json', skillCatalog],
    ['generated-asset-manifest.schema.json', generatedAssetManifest],
  ]);
}

const document = (kind, schemaVersion, documentVersion, fields) => withDocumentDigest({
  kind, schemaVersion, protocolVersion: PROTOCOL_VERSION, documentVersion,
  digestAlgorithm: 'sha256', canonicalization: 'rfc8785', ...fields,
});

const HOST_PROFILE_DEFINITIONS = Object.freeze([
  Object.freeze({
    hostProfileId: 'claude-code-default',
    hostProfileVersion: '1.0.0',
    host: 'claude-code',
    sourceFile: 'claude-code.md',
    description: 'Claude Code profile with native questions and portable interactive fallbacks.',
    runtimeCapabilities: ['attached-terminal', 'native-questions', 'structured-chat'],
    interactionBindings: [
      ['native', 'native', 'native-questions'],
      ['chat', 'chat', 'structured-chat'],
      ['terminal', 'terminal', 'attached-terminal'],
      ['headless', 'none'],
    ],
  }),
  Object.freeze({
    hostProfileId: 'codex-default',
    hostProfileVersion: '1.0.0',
    host: 'codex',
    sourceFile: 'codex.md',
    description: 'Codex profile with composer questions and portable interactive fallbacks.',
    runtimeCapabilities: ['attached-terminal', 'native-questions', 'structured-chat'],
    interactionBindings: [
      ['native', 'native', 'native-questions'],
      ['chat', 'chat', 'structured-chat'],
      ['terminal', 'terminal', 'attached-terminal'],
      ['headless', 'none'],
    ],
  }),
  Object.freeze({
    hostProfileId: 'cursor-default',
    hostProfileVersion: '1.0.0',
    host: 'cursor',
    sourceFile: 'cursor.md',
    description: 'Cursor profile with structured chat and attached-terminal fallbacks.',
    runtimeCapabilities: ['attached-terminal', 'structured-chat'],
    interactionBindings: [
      ['chat', 'chat', 'structured-chat'],
      ['terminal', 'terminal', 'attached-terminal'],
      ['headless', 'none'],
    ],
  }),
  Object.freeze({
    hostProfileId: 'pipeline-default',
    hostProfileVersion: '1.0.0',
    host: 'pipeline',
    sourceFile: 'pipeline.md',
    description: 'Host-neutral pipeline projection profile; narrows to read-only repository access.',
  }),
  Object.freeze({
    hostProfileId: 'pipeline-default',
    hostProfileVersion: '1.1.0',
    host: 'pipeline',
    sourceFile: 'pipeline-capabilities.md',
    description: 'Host-neutral pipeline profile with terminal and headless fallbacks.',
    runtimeCapabilities: ['attached-terminal'],
    interactionBindings: [
      ['terminal', 'terminal', 'attached-terminal'],
      ['headless', 'none'],
    ],
  }),
]);

function hostProfile(definition) {
  const relativeSource = `packages/protocol/host-profiles/${definition.sourceFile}`;
  const absoluteSource = join(dirname(fileURLToPath(import.meta.url)), '..', 'host-profiles', definition.sourceFile);
  return {
    hostProfileId: definition.hostProfileId,
    hostProfileVersion: definition.hostProfileVersion,
    host: definition.host,
    description: definition.description,
    authorityCeiling: {
      repositoryAccess: 'read-only',
      externalDataAccess: 'none',
      allowedCapabilities: ['read'],
      allowedTools: ['read'],
      allowedOperations: ['render'],
      allowedOutputClasses: ['A'],
      forbiddenEffects: ['network-write'],
    },
    source: { path: relativeSource, digest: `sha256:${sha256Hex(readFileSync(absoluteSource))}` },
    overlayModules: [],
    ...(definition.runtimeCapabilities ? {
      runtimeCapabilities: [...definition.runtimeCapabilities],
      interactionBindings: definition.interactionBindings.map(([surface, protocolInteraction, capabilityId]) => ({
        surface,
        protocolInteraction,
        ...(capabilityId ? { capabilityId } : {}),
      })),
    } : {}),
  };
}

export function buildSkillSourceRegistries() {
  const graph = collectCanonicalModuleGraph();
  const payloads = new Map([
    ['skill-module-registry', { modules: graph.modules }],
    ['skill-host-profile-registry', { profiles: HOST_PROFILE_DEFINITIONS.map(hostProfile) }],
    ['skill-routing-registry', { policies: graph.policies }],
  ]);
  return new Map(Object.entries(SKILL_SOURCE_V16_REGISTRIES).map(([file, descriptor]) => {
    const payload = payloads.get(descriptor.kind);
    if (!payload) throw new Error(`Protocol 1.6 registry ${file} has no payload builder for ${descriptor.kind}.`);
    return [file, document(
      descriptor.kind,
      descriptor.schemaVersion,
      descriptor.documentVersion,
      payload,
    )];
  }));
}

/** Contract kinds introduced by Protocol 1.6, each resolved at version 1.6.0. */
export const SKILL_SOURCE_CONTRACT_FILES = SKILL_SOURCE_V16_CONTRACT_FILES;
