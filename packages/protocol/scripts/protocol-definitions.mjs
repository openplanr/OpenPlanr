import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Hex, withDocumentDigest } from '../src/canonical-json.mjs';
import { readCanonicalSkillRegistry, sourceDigest } from './skill-registry-source.mjs';

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const BASE = 'https://openplanr.dev/schemas/v1.5.0/';
const ref = (name) => ({ $ref: `common.schema.json#/$defs/${name}` });
const nullableRef = (name) => ({ anyOf: [ref(name), { type: 'null' }] });
const nullableString = (schema = {}) => ({ anyOf: [{ type: 'string', ...schema }, { type: 'null' }] });
const array = (items, minItems = 0, maxItems = 4096, uniqueItems = false) => ({
  type: 'array', items, minItems, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}),
});
const closed = (required, properties, extra = {}) => ({
  type: 'object', additionalProperties: false, required, properties, ...extra,
});

const envelopeProperties = {
  kind: { type: 'string', minLength: 1, maxLength: 96 },
  schemaVersion: ref('semver'),
  protocolVersion: { const: '1.5.0' },
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
    'x-openplanr-contract': { id: name, version: '1.5.0' },
    ...closed(
      [...envelopeRequired, ...required],
      {
        ...envelopeProperties,
        kind: { const: kind },
        schemaVersion: { const: schemaVersion },
        ...properties,
      },
      extra,
    ),
  };
}

const contractRef = ref('contractRef');
const sourceRef = ref('sourceRef');
const repositoryPath = ref('repositoryPath');

export function buildSchemas() {
  const common = {
    $schema: SCHEMA,
    $id: `${BASE}common.schema.json`,
    'x-openplanr-contract': { id: 'protocol-common', version: '1.5.0' },
    $defs: {
      digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      semver: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$' },
      date: { type: 'string', format: 'date' },
      dateTime: { type: 'string', format: 'date-time' },
      nonBlankText: { type: 'string', minLength: 1, maxLength: 16384, pattern: '.*\\S.*' },
      identifier: { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', minLength: 1, maxLength: 128 },
      skillId: { type: 'string', pattern: '^planr-[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128 },
      roleId: { type: 'string', pattern: '^planr-[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 128 },
      ruleId: { type: 'string', pattern: '^R(?:[1-9]|[1-9][0-9]+)$' },
      taskId: { type: 'string', pattern: '^T-[0-9]{3}$' },
      storyId: { type: 'string', pattern: '^US-[0-9]{3}$' },
      specId: { type: 'string', pattern: '^SPEC-[0-9]{3}$' },
      relativePath: {
        type: 'string', minLength: 1, maxLength: 1024,
        pattern: '^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//).+$',
      },
      repositoryKey: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,63}$' },
      repositoryPath: closed(['repositoryKey', 'path'], {
        repositoryKey: { $ref: '#/$defs/repositoryKey' }, path: { $ref: '#/$defs/relativePath' },
      }),
      contractRef: closed(['id', 'version'], {
        id: { $ref: '#/$defs/identifier' }, version: { $ref: '#/$defs/semver' },
      }),
      sourceRef: closed(['path', 'digest'], {
        path: { $ref: '#/$defs/relativePath' }, digest: { $ref: '#/$defs/digest' },
      }),
      producer: closed(['id', 'version', 'sourceDigest'], {
        id: { $ref: '#/$defs/identifier' }, version: { $ref: '#/$defs/semver' }, sourceDigest: { $ref: '#/$defs/digest' },
      }),
      roleBinding: closed(['roleId', 'roleVersion', 'registryDigest'], {
        roleId: { $ref: '#/$defs/roleId' }, roleVersion: { $ref: '#/$defs/semver' }, registryDigest: { $ref: '#/$defs/digest' },
      }),
      diagnostic: closed(['code', 'severity', 'message', 'recovery', 'path', 'evidenceDigest'], {
        code: { type: 'string', pattern: '^E_[A-Z0-9_]+$' },
        severity: { enum: ['info', 'warning', 'error'] },
        message: { $ref: '#/$defs/nonBlankText' },
        recovery: nullableString({ minLength: 1, maxLength: 4096 }),
        path: nullableString({ $ref: '#/$defs/relativePath' }),
        evidenceDigest: { anyOf: [{ $ref: '#/$defs/digest' }, { type: 'null' }] },
      }),
      envelope: closed(envelopeRequired, envelopeProperties),
    },
  };

  const legacyAlias = closed(['id', 'status', 'since', 'removalVersion'], {
    id: ref('identifier'), status: { const: 'compatibility' }, since: ref('semver'), removalVersion: nullableRef('semver'),
  });
  const writeBoundary = closed(
    ['repositoryAccess', 'externalDataAccess', 'allowedOutputClasses', 'forbiddenEffects'],
    {
      repositoryAccess: { enum: ['none', 'read-only', 'declared-paths'] },
      externalDataAccess: { enum: ['none', 'read-only'] },
      allowedOutputClasses: array({ enum: ['A', 'B', 'C', 'D'] }, 1, 4, true),
      forbiddenEffects: array(ref('identifier'), 1, 32, true),
    },
  );
  const adapterMapping = closed(['host', 'nativeId', 'generatedPath'], {
    host: { enum: ['claude-code', 'codex', 'cursor'] }, nativeId: ref('identifier'), generatedPath: ref('relativePath'),
  });
  const role = closed(
    ['roleId', 'roleVersion', 'displayName', 'description', 'legacyAliases', 'phase', 'activation', 'capabilityTier',
      'authorityClass', 'writeBoundary', 'source', 'taskKinds', 'outputContracts', 'ruleIds', 'adapterMappings', 'qaCoverage'],
    {
      roleId: ref('roleId'), roleVersion: ref('semver'), displayName: ref('nonBlankText'), description: ref('nonBlankText'),
      legacyAliases: array(legacyAlias, 0, 16),
      phase: { enum: ['po-preflight', 'po', 'dev', 'qa', 'post-build'] },
      activation: { enum: ['always', 'conditional', 'manual'] },
      capabilityTier: { enum: ['analysis-high', 'implementation-high', 'read-only-qa'] },
      authorityClass: ref('identifier'), writeBoundary, source: sourceRef,
      taskKinds: array(ref('identifier'), 0, 32, true), outputContracts: array(contractRef, 1, 32),
      ruleIds: array(ref('ruleId'), 1, 10, true), adapterMappings: array(adapterMapping, 1, 8),
      qaCoverage: array(ref('relativePath'), 1, 64, true),
    },
  );
  const roleRegistry = documentSchema('role-registry', 'role-registry', '1.1.0', ['roles'], {
    roles: array(role, 1, 128),
  });

  const binding = closed(
    ['taskKind', 'roleId', 'assignmentLevel', 'countsTowardR2', 'implementationAuthority', 'description',
      'inputContracts', 'outputContracts', 'requiredRuleIds'],
    {
      taskKind: ref('identifier'), roleId: ref('roleId'), assignmentLevel: { enum: ['story', 'preflight', 'feature', 'quality'] },
      countsTowardR2: { type: 'boolean' }, implementationAuthority: { type: 'boolean' }, description: ref('nonBlankText'),
      inputContracts: array(contractRef, 0, 32), outputContracts: array(contractRef, 1, 32),
      requiredRuleIds: array(ref('ruleId'), 1, 10, true),
    },
  );
  const legacyMapping = closed(['legacyType', 'legacyAgent', 'taskKind', 'evidence', 'precedence'], {
    legacyType: { enum: ['UI', 'Tech'] }, legacyAgent: nullableString({ pattern: '^[a-z][a-z0-9-]+-agent$' }),
    taskKind: ref('identifier'), evidence: { enum: ['explicit-type-and-agent', 'explicit-type-default'] },
    precedence: { type: 'integer', minimum: 1, maximum: 16 },
  });
  const taskKindRegistry = documentSchema(
    'task-kind-registry', 'task-kind-registry', '1.0.0',
    ['roleRegistryDigest', 'bindings', 'legacyMappings'],
    { roleRegistryDigest: ref('digest'), bindings: array(binding, 1, 64), legacyMappings: array(legacyMapping, 1, 32) },
  );

  const taskManifest = documentSchema('task-manifest', 'task-manifest', '1.0.0', [
    'taskManifestId', 'task', 'parent', 'routing', 'dependencies', 'scope', 'inputs', 'expectedOutputs',
    'acceptanceRefs', 'ruleIds', 'reviewBinding', 'producer', 'issuedAt',
  ], {
    taskManifestId: { type: 'string', pattern: '^tmf_[0-9a-f]{32}$' },
    task: closed(['taskId', 'path', 'schemaRef', 'contentDigest'], {
      taskId: ref('taskId'), path: ref('relativePath'), schemaRef: contractRef, contentDigest: ref('digest'),
    }),
    parent: closed(['projectMode', 'storyId', 'specId', 'featureSlug'], {
      projectMode: { enum: ['spec-driven', 'default'] }, storyId: ref('storyId'), specId: nullableRef('specId'),
      featureSlug: nullableString({ pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
    }, {
      oneOf: [
        { properties: { projectMode: { const: 'spec-driven' }, specId: ref('specId'), featureSlug: { type: 'null' } } },
        { properties: { projectMode: { const: 'default' }, specId: { type: 'null' }, featureSlug: { type: 'string', minLength: 1 } } },
      ],
    }),
    routing: closed(['taskKind', 'roleId', 'roleVersion', 'taskKindRegistryDigest', 'roleRegistryDigest'], {
      taskKind: ref('identifier'), roleId: ref('roleId'), roleVersion: ref('semver'),
      taskKindRegistryDigest: ref('digest'), roleRegistryDigest: ref('digest'),
    }),
    dependencies: array(closed(['taskId', 'taskManifestDigest'], { taskId: ref('taskId'), taskManifestDigest: ref('digest') }), 0, 256),
    scope: closed(['create', 'modify', 'preserve'], {
      create: array(repositoryPath, 0, 1024), modify: array(repositoryPath, 0, 1024), preserve: array(repositoryPath, 0, 1024),
    }),
    inputs: array(closed(['artifactId', 'contractRef', 'path', 'digest', 'required'], {
      artifactId: ref('identifier'), contractRef, path: ref('relativePath'), digest: ref('digest'), required: { type: 'boolean' },
    }), 0, 256),
    expectedOutputs: array(closed(['outputId', 'contractRef', 'paths', 'pathArguments'], {
      outputId: ref('identifier'), contractRef, paths: array(repositoryPath, 0, 128),
      pathArguments: { type: 'object', additionalProperties: { type: 'string', minLength: 1, maxLength: 256 } },
    }), 1, 256),
    acceptanceRefs: array(closed(['kind', 'reference', 'statement'], {
      kind: { enum: ['gherkin-scenario', 'verification-statement'] }, reference: ref('relativePath'), statement: ref('nonBlankText'),
    }), 1, 256),
    ruleIds: array(ref('ruleId'), 1, 10, true),
    reviewBinding: closed(['planDigest', 'planningReviewReceiptDigest', 'ownerDecisionDigest'], {
      planDigest: ref('digest'), planningReviewReceiptDigest: ref('digest'), ownerDecisionDigest: ref('digest'),
    }),
    producer: ref('producer'), issuedAt: ref('dateTime'),
  });

  const digestChange = closed(['repositoryKey', 'path', 'operation', 'beforeDigest', 'afterDigest', 'byteLength'], {
    repositoryKey: ref('repositoryKey'), path: ref('relativePath'), operation: { enum: ['create', 'modify', 'delete'] },
    beforeDigest: nullableRef('digest'), afterDigest: nullableRef('digest'), byteLength: { type: 'integer', minimum: 0 },
  });
  const taskOutput = documentSchema('task-output-manifest', 'task-output-manifest', '1.0.0', [
    'taskOutputId', 'taskBinding', 'roleBinding', 'attempt', 'outcome', 'startedAt', 'completedAt', 'changes',
    'preserveVerification', 'commandEvidence', 'acceptanceEvidence', 'outputs', 'diagnostics', 'errorHandoff',
    'externalEffects', 'producer',
  ], {
    taskOutputId: { type: 'string', pattern: '^tof_[0-9a-f]{32}$' },
    taskBinding: closed(['taskManifestId', 'taskManifestDigest'], {
      taskManifestId: { type: 'string', pattern: '^tmf_[0-9a-f]{32}$' }, taskManifestDigest: ref('digest'),
    }),
    roleBinding: ref('roleBinding'),
    attempt: closed(['initialAttempt', 'correctionIteration'], {
      initialAttempt: { const: 1 }, correctionIteration: { type: 'integer', minimum: 0 },
    }),
    outcome: { enum: ['completed', 'blocked'] }, startedAt: ref('dateTime'), completedAt: ref('dateTime'),
    changes: array(digestChange, 0, 4096),
    preserveVerification: array(closed(['repositoryKey', 'path', 'beforeDigest', 'afterDigest', 'unchanged'], {
      repositoryKey: ref('repositoryKey'), path: ref('relativePath'), beforeDigest: ref('digest'), afterDigest: ref('digest'), unchanged: { const: true },
    }), 0, 4096),
    commandEvidence: array(closed([
      'commandId', 'argvDigest', 'workingDirectory', 'startedAt', 'completedAt', 'exitCode', 'stdoutDigest', 'stderrDigest', 'status',
    ], {
      commandId: ref('identifier'), argvDigest: ref('digest'), workingDirectory: repositoryPath,
      startedAt: ref('dateTime'), completedAt: ref('dateTime'), exitCode: { anyOf: [{ type: 'integer', minimum: 0, maximum: 255 }, { type: 'null' }] },
      stdoutDigest: ref('digest'), stderrDigest: ref('digest'), status: { enum: ['passed', 'failed', 'skipped-not-configured'] },
    }), 0, 128),
    acceptanceEvidence: array(closed(['acceptanceRef', 'verifier', 'result', 'evidenceDigest'], {
      acceptanceRef: ref('nonBlankText'), verifier: ref('identifier'), result: { enum: ['passed', 'failed', 'not-run'] }, evidenceDigest: ref('digest'),
    }), 1, 256),
    outputs: array(closed(['outputId', 'path', 'mediaType', 'byteLength', 'digest'], {
      outputId: ref('identifier'), path: repositoryPath, mediaType: { type: 'string', pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' },
      byteLength: { type: 'integer', minimum: 0 }, digest: ref('digest'),
    }), 0, 512),
    diagnostics: array(ref('diagnostic'), 0, 256),
    errorHandoff: { anyOf: [closed(['path', 'digest'], { path: repositoryPath, digest: ref('digest') }), { type: 'null' }] },
    externalEffects: array(closed(['effectClass', 'description'], { effectClass: ref('identifier'), description: ref('nonBlankText') }), 0, 0),
    producer: ref('producer'),
  }, {
    allOf: [
      {
        if: { properties: { outcome: { const: 'completed' } } },
        then: {
          properties: { errorHandoff: { type: 'null' } },
          not: { properties: { diagnostics: { contains: { properties: { severity: { const: 'error' } } } } } },
        },
      },
      {
        if: { properties: { outcome: { const: 'blocked' } } },
        then: {
          properties: {
            diagnostics: { contains: { properties: { severity: { const: 'error' } } }, minContains: 1 },
            errorHandoff: { type: 'object' },
          },
        },
      },
      { if: { properties: { roleBinding: { properties: { roleId: { const: 'planr-qa' } } } } }, then: { properties: { changes: { maxItems: 0 } } } },
    ],
  });

  const implementationResult = {
    $schema: SCHEMA,
    $id: `${BASE}implementation-result.schema.json`,
    'x-openplanr-contract': { id: 'implementation-result', version: '1.5.0' },
    ...closed(['outcome', 'task', 'changed', 'checks', 'issues'], {
      outcome: closed(['status', 'summary'], {
        status: { enum: ['completed', 'partial', 'blocked'] },
        summary: ref('nonBlankText'),
      }),
      task: {
        oneOf: [
          {
            title: 'Planr task',
            ...closed(['kind', 'id', 'path'], {
              kind: { const: 'planr-task' }, id: ref('taskId'), path: ref('relativePath'),
            }),
          },
          {
            title: 'Direct request',
            ...closed(['kind'], { kind: { const: 'direct-request' } }),
          },
        ],
      },
      changed: array(closed(['path', 'purpose'], {
        path: ref('relativePath'), purpose: ref('nonBlankText'),
      }), 0, 4096),
      checks: array(closed(['command', 'status', 'detail'], {
        command: ref('nonBlankText'), status: { enum: ['passed', 'failed', 'not-run'] }, detail: ref('nonBlankText'),
      }), 0, 256),
      issues: array(closed(['problem', 'impact', 'nextAction'], {
        problem: ref('nonBlankText'), impact: ref('nonBlankText'), nextAction: ref('nonBlankText'),
      }), 0, 256),
    }),
  };

  const ruleCatalog = documentSchema('rule-catalog', 'rule-catalog', '1.0.0', ['rules'], {
    rules: array(closed([
      'ruleId', 'ruleVersion', 'title', 'status', 'normativeText', 'enforcementPoints', 'testRefs', 'citedBy', 'source',
    ], {
      ruleId: ref('ruleId'), ruleVersion: ref('semver'), title: ref('nonBlankText'), status: { enum: ['active', 'deprecated', 'retired'] },
      normativeText: ref('nonBlankText'),
      enforcementPoints: array(closed(['package', 'path', 'symbol'], {
        package: ref('nonBlankText'), path: ref('relativePath'), symbol: ref('nonBlankText'),
      }), 1, 64),
      testRefs: array(ref('relativePath'), 1, 64, true), citedBy: array(ref('relativePath'), 1, 256, true), source: sourceRef,
    }), 1, 100),
  });

  const commandCatalog = documentSchema('command-catalog', 'command-catalog', '1.0.0', ['binaries', 'inventory', 'commands', 'negativeContracts'], {
    binaries: array(closed(['id', 'lifecycle', 'aliasOf'], {
      id: ref('identifier'), lifecycle: { enum: ['canonical', 'exact-alias', 'deprecated-exact-alias'] }, aliasOf: nullableString({ pattern: '^[a-z][a-z0-9-]*$' }),
    }), 3, 3),
    inventory: closed(['rootCommandModules', 'rootCommandSlugs', 'pipelineMachineLeaves', 'pipelineMachineGrammar', 'frozenClaudeDocuments', 'frozenClaudeSlugs'], {
      rootCommandModules: { const: 39 }, rootCommandSlugs: array(ref('identifier'), 39, 39, true),
      pipelineMachineLeaves: { const: 31 }, pipelineMachineGrammar: array(array({ type: 'string', minLength: 1, maxLength: 128 }, 1, 8), 31, 31),
      frozenClaudeDocuments: { const: 8 }, frozenClaudeSlugs: array(ref('identifier'), 8, 8, true),
    }),
    commands: array(closed([
      'commandId', 'surface', 'argv', 'lifecycle', 'ownerPackage', 'source', 'authorityClass', 'machineJson',
      'outputContracts', 'skillId', 'aliases', 'testRefs',
    ], {
      commandId: ref('identifier'), surface: { enum: ['cli-root', 'cli-leaf', 'pipeline-machine', 'frozen-host-alias'] },
      argv: array({ type: 'string', minLength: 1, maxLength: 128 }, 1, 16), lifecycle: { enum: ['active', 'compatibility-alias', 'deprecated'] },
      ownerPackage: ref('nonBlankText'), source: sourceRef, authorityClass: ref('identifier'), machineJson: { type: 'boolean' },
      outputContracts: array(contractRef, 0, 32), skillId: nullableRef('skillId'), aliases: array(array({ type: 'string', minLength: 1 }, 1, 16), 0, 32),
      testRefs: array(ref('relativePath'), 1, 64, true),
    }), 1, 512),
    negativeContracts: array(closed(['negativeContractId', 'forbiddenArgvPrefix', 'forbiddenPaths', 'reason', 'testRefs'], {
      negativeContractId: ref('identifier'), forbiddenArgvPrefix: array({ type: 'string', minLength: 1 }, 1, 16),
      forbiddenPaths: array(ref('relativePath'), 0, 64, true), reason: ref('nonBlankText'), testRefs: array(ref('relativePath'), 1, 64, true),
    }), 1, 64),
  });

  const skillCatalog = documentSchema('skill-catalog', 'skill-catalog', '1.0.0', ['matchingPolicyVersion', 'skills', 'compatibilityAliases'], {
    matchingPolicyVersion: ref('semver'),
    skills: array(closed([
      'skillId', 'skillVersion', 'description', 'lifecycle', 'authorityClass', 'source', 'sourceDigest', 'triggerPolicy',
      'contracts', 'cliRequirements', 'ruleIds', 'contributionManifestRefs', 'hosts', 'testRefs', 'certificationRefs',
    ], {
      skillId: ref('skillId'), skillVersion: ref('semver'), description: ref('nonBlankText'), lifecycle: { enum: ['active', 'deprecated', 'retired'] },
      authorityClass: ref('identifier'), source: ref('relativePath'), sourceDigest: ref('digest'),
      triggerPolicy: closed(['include', 'exclude', 'deferTo'], {
        include: array(ref('nonBlankText'), 1, 64, true), exclude: array(ref('nonBlankText'), 1, 64, true), deferTo: array(ref('skillId'), 0, 32, true),
      }),
      contracts: closed(['inputs', 'outputs'], { inputs: array(contractRef, 0, 32), outputs: array(contractRef, 1, 32) }),
      cliRequirements: array(closed(['commandId', 'argv', 'requiredOptions'], {
        commandId: ref('identifier'), argv: array({ type: 'string', minLength: 1 }, 1, 16), requiredOptions: array({ type: 'string', pattern: '^--[a-z0-9-]+$' }, 0, 32, true),
      }), 0, 64),
      ruleIds: array(ref('ruleId'), 1, 10, true), contributionManifestRefs: array(ref('relativePath'), 1, 64, true),
      hosts: array(closed(['host', 'entrypoint', 'path'], {
        host: { enum: ['claude-code', 'codex', 'cursor'] }, entrypoint: ref('nonBlankText'), path: ref('relativePath'),
      }), 1, 8),
      testRefs: array(ref('relativePath'), 1, 64, true), certificationRefs: array(ref('relativePath'), 1, 64, true),
    }), 1, 256),
    compatibilityAliases: array(closed(['aliasId', 'canonicalSkillId', 'lifecycle', 'generatedPaths'], {
      aliasId: ref('identifier'), canonicalSkillId: ref('skillId'), lifecycle: { const: 'deprecated' }, generatedPaths: array(ref('relativePath'), 1, 16, true),
    }), 0, 64),
  });

  const outputCatalog = documentSchema('output-catalog', 'output-catalog', '1.0.0', ['outputs'], {
    outputs: array(closed([
      'outputId', 'title', 'outputClass', 'ownerPackage', 'pathFunctionId', 'pathTemplate', 'sourceOfTruth', 'schemaRef',
      'manifestRef', 'generator', 'validator', 'compatibilityReaders', 'retentionPolicy', 'cleanupPolicy', 'mediaTypes', 'testRefs',
    ], {
      outputId: ref('identifier'), title: ref('nonBlankText'), outputClass: { enum: ['A', 'B', 'C', 'D'] }, ownerPackage: ref('nonBlankText'),
      pathFunctionId: ref('identifier'), pathTemplate: ref('relativePath'), sourceOfTruth: { type: 'boolean' },
      schemaRef: { anyOf: [contractRef, { type: 'null' }] }, manifestRef: { anyOf: [contractRef, { type: 'null' }] },
      generator: closed(['id', 'version', 'sourceDigest'], { id: ref('identifier'), version: ref('semver'), sourceDigest: ref('digest') }),
      validator: closed(['id', 'version'], { id: ref('identifier'), version: ref('semver') }),
      compatibilityReaders: array(closed(['package', 'entrypoint'], { package: ref('nonBlankText'), entrypoint: ref('nonBlankText') }), 1, 32),
      retentionPolicy: { enum: ['project', 'run', 'release', 'ephemeral'] }, cleanupPolicy: { enum: ['never', 'on-success', 'bounded-expiry', 'explicit-owner'] },
      mediaTypes: array({ type: 'string', pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' }, 1, 16, true), testRefs: array(ref('relativePath'), 1, 64, true),
    }), 1, 512),
  });

  const outputPathCatalog = documentSchema(
    'output-path-catalog',
    'output-path-catalog',
    '1.0.0',
    ['outputCatalogDigest', 'outputs'],
    {
      outputCatalogDigest: ref('digest'),
      outputs: array(closed(['outputId', 'pathTemplates'], {
        outputId: ref('identifier'),
        pathTemplates: closed(['default', 'spec-driven'], {
          default: ref('relativePath'),
          'spec-driven': ref('relativePath'),
        }),
      }), 1, 512),
    },
  );

  const generatedAssetManifest = documentSchema('generated-asset-manifest', 'generated-asset-manifest', '1.0.0', [
    'assetSetId', 'generator', 'sourceEpoch', 'inputs', 'assets', 'compatibility', 'purity', 'custody',
  ], {
    assetSetId: { type: 'string', pattern: '^gas_[0-9a-f]{32}$' },
    generator: closed(['id', 'version', 'sourceDigest', 'commandId'], {
      id: ref('identifier'), version: ref('semver'), sourceDigest: ref('digest'), commandId: ref('identifier'),
    }),
    sourceEpoch: { type: 'integer', minimum: 0 },
    inputs: array(closed(['inputKind', 'path', 'version', 'digest'], {
      inputKind: { enum: ['canonical-source', 'schema', 'registry', 'template', 'overlay', 'contribution'] },
      path: ref('relativePath'), version: ref('semver'), digest: ref('digest'),
    }), 1, 4096),
    assets: array(closed([
      'path', 'assetKind', 'host', 'mediaType', 'byteLength', 'mode', 'digest', 'outputId', 'sourceMap',
    ], {
      path: ref('relativePath'), assetKind: ref('identifier'), host: nullableString({ enum: ['claude-code', 'codex', 'cursor'] }),
      mediaType: { type: 'string', pattern: '^[a-z0-9.+-]+/[a-z0-9.+-]+$' }, byteLength: { type: 'integer', minimum: 0 },
      mode: { enum: ['100644', '100755'] }, digest: ref('digest'), outputId: ref('identifier'),
      sourceMap: array(closed(['path', 'digest', 'moduleVersion', 'sectionIds'], {
        path: ref('relativePath'), digest: ref('digest'), moduleVersion: ref('semver'), sectionIds: array(ref('identifier'), 1, 256, true),
      }), 1, 256),
    }), 0, 32768),
    compatibility: closed(['protocolVersions', 'packageVersions', 'adapterProfiles', 'hostProfiles'], {
      protocolVersions: array(ref('semver'), 1, 32, true), packageVersions: array(ref('nonBlankText'), 1, 64, true),
      adapterProfiles: array(ref('identifier'), 1, 32, true), hostProfiles: array(ref('identifier'), 1, 32, true),
    }),
    purity: closed(['checkerVersion', 'checkerDigest', 'violations'], {
      checkerVersion: ref('semver'), checkerDigest: ref('digest'), violations: array(ref('diagnostic'), 0, 0),
    }),
    custody: closed(['ownerPackage', 'distributionPackage', 'editPolicy', 'includedInPublicPackage'], {
      ownerPackage: ref('nonBlankText'), distributionPackage: ref('nonBlankText'), editPolicy: { const: 'generated-do-not-edit' }, includedInPublicPackage: { type: 'boolean' },
    }),
  });

  const migrationPreservation = documentSchema('migration-preservation-manifest', 'migration-preservation-manifest', '1.0.0', [
    'migrationId', 'destination', 'sources', 'tagMappings', 'pathMappings', 'catalogBindings', 'coverage', 'historyProof',
    'verificationGates', 'sourceUnchangedProof',
  ], {
    migrationId: { type: 'string', pattern: '^mig_[0-9a-f]{32}$' },
    destination: closed(['repository', 'integrationVersion', 'commit'], {
      repository: { const: 'AsemDevs/openplanr' }, integrationVersion: { const: '0.1.0' }, commit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
    }),
    sources: array(closed([
      'sourceId', 'cutoffCommit', 'branch', 'includedState', 'trackedPatchDigest', 'untrackedInventoryDigest', 'refsDigest',
      'fileInventoryDigest', 'licenseRefs', 'custodyArtifacts',
    ], {
      sourceId: { enum: ['openplanr-cli', 'planr-pipeline', 'skills', 'marketplace', 'openplanr-web'] },
      cutoffCommit: { type: 'string', pattern: '^[0-9a-f]{40}$' }, branch: ref('nonBlankText'), includedState: { enum: ['clean', 'tracked-dirty', 'tracked-and-untracked-dirty', 'external-reference'] },
      trackedPatchDigest: nullableRef('digest'), untrackedInventoryDigest: ref('digest'), refsDigest: ref('digest'), fileInventoryDigest: ref('digest'),
      licenseRefs: array(ref('relativePath'), 1, 16, true),
      custodyArtifacts: array(closed(['name', 'byteLength', 'digest'], {
        name: ref('relativePath'), byteLength: { type: 'integer', minimum: 0 }, digest: ref('digest'),
      }), 1, 64),
    }), 5, 5),
    tagMappings: array(closed(['sourceId', 'originalRef', 'tagObjectId', 'peeledCommitId', 'destinationRef'], {
      sourceId: ref('identifier'), originalRef: ref('nonBlankText'), tagObjectId: { type: 'string', pattern: '^[0-9a-f]{40}$' },
      peeledCommitId: { type: 'string', pattern: '^[0-9a-f]{40}$' }, destinationRef: { type: 'string', pattern: '^source/[a-z0-9-]+/.+$' },
    }), 0, 4096),
    pathMappings: array(closed(['mappingId', 'sources', 'destinations', 'disposition', 'owner', 'reasonCode', 'contractRefs', 'verificationRefs'], {
      mappingId: ref('identifier'),
      sources: array(closed(['sourceId', 'path', 'cutoffPresent', 'currentPresent', 'mode', 'digest', 'state'], {
        sourceId: ref('identifier'), path: ref('relativePath'), cutoffPresent: { type: 'boolean' }, currentPresent: { type: 'boolean' },
        mode: nullableString({ pattern: '^(?:100644|100755|120000)$' }), digest: nullableRef('digest'), state: { enum: ['tracked', 'untracked', 'deleted'] },
      }), 1, 32),
      destinations: array(closed(['path', 'mode', 'digest'], {
        path: ref('relativePath'), mode: { enum: ['100644', '100755'] }, digest: ref('digest'),
      }), 0, 32),
      disposition: { enum: ['exact', 'moved', 'merged', 'regenerated', 'retired', 'external', 'excluded'] },
      owner: ref('nonBlankText'), reasonCode: ref('identifier'), contractRefs: array(contractRef, 0, 32), verificationRefs: array(ref('relativePath'), 1, 64, true),
    }), 1, 131072),
    catalogBindings: closed(['roles', 'taskKinds', 'rules', 'commands', 'skills', 'outputs', 'exports', 'generators', 'generatedAssets'], {
      roles: ref('digest'), taskKinds: ref('digest'), rules: ref('digest'), commands: ref('digest'), skills: ref('digest'), outputs: ref('digest'),
      exports: ref('digest'), generators: ref('digest'), generatedAssets: ref('digest'),
    }),
    coverage: closed(['originalSchemas', 'originalRegistries', 'canonicalRoles', 'canonicalSkills', 'cliRootCommands', 'pipelineExportKeys', 'pipelineRootSymbols', 'sourcePaths'], {
      originalSchemas: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 180 }, mapped: { const: 180 }, unmapped: { const: 0 } }),
      originalRegistries: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 12 }, mapped: { const: 12 }, unmapped: { const: 0 } }),
      canonicalRoles: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 9 }, mapped: { const: 9 }, unmapped: { const: 0 } }),
      canonicalSkills: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 23 }, mapped: { const: 23 }, unmapped: { const: 0 } }),
      cliRootCommands: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 38 }, mapped: { const: 38 }, unmapped: { const: 0 } }),
      pipelineExportKeys: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 37 }, mapped: { const: 37 }, unmapped: { const: 0 } }),
      pipelineRootSymbols: closed(['expected', 'mapped', 'unmapped'], { expected: { const: 229 }, mapped: { const: 229 }, unmapped: { const: 0 } }),
      sourcePaths: closed(['expected', 'mapped', 'unmapped'], {
        expected: { type: 'integer', minimum: 1 }, mapped: { type: 'integer', minimum: 1 }, unmapped: { const: 0 },
      }),
    }),
    historyProof: closed(['firstParentSeed', 'importedSourceCommits', 'subtreeMergeCommits', 'preservedAuthorsDigest', 'absentCommits'], {
      firstParentSeed: { type: 'string', pattern: '^[0-9a-f]{40}$' }, importedSourceCommits: array({ type: 'string', pattern: '^[0-9a-f]{40}$' }, 4, 16, true),
      subtreeMergeCommits: array({ type: 'string', pattern: '^[0-9a-f]{40}$' }, 3, 16, true), preservedAuthorsDigest: ref('digest'),
      absentCommits: array({ enum: ['0a4f3b2', '7ad18f4', '2c22a45'] }, 3, 3, true),
    }),
    verificationGates: array(closed(['gateId', 'status', 'commandRef', 'reportDigest', 'evidenceDigest'], {
      gateId: ref('identifier'), status: { enum: ['passed', 'failed', 'blocked'] }, commandRef: ref('nonBlankText'), reportDigest: ref('digest'), evidenceDigest: ref('digest'),
    }), 1, 256),
    sourceUnchangedProof: array(closed(['sourceId', 'pre', 'post'], {
      sourceId: ref('identifier'),
      pre: closed(['head', 'refsDigest', 'trackedPatchDigest', 'untrackedManifestDigest', 'statusDigest'], {
        head: { type: 'string', pattern: '^[0-9a-f]{40}$' }, refsDigest: ref('digest'), trackedPatchDigest: ref('digest'), untrackedManifestDigest: ref('digest'), statusDigest: ref('digest'),
      }),
      post: closed(['head', 'refsDigest', 'trackedPatchDigest', 'untrackedManifestDigest', 'statusDigest'], {
        head: { type: 'string', pattern: '^[0-9a-f]{40}$' }, refsDigest: ref('digest'), trackedPatchDigest: ref('digest'), untrackedManifestDigest: ref('digest'), statusDigest: ref('digest'),
      }),
    }), 5, 5),
  });

  return new Map([
    ['common.schema.json', common],
    ['role-registry.schema.json', roleRegistry],
    ['task-kind-registry.schema.json', taskKindRegistry],
    ['task-manifest.schema.json', taskManifest],
    ['task-output-manifest.schema.json', taskOutput],
    ['implementation-result.schema.json', implementationResult],
    ['rule-catalog.schema.json', ruleCatalog],
    ['command-catalog.schema.json', commandCatalog],
    ['skill-catalog.schema.json', skillCatalog],
    ['output-catalog.schema.json', outputCatalog],
    ['output-path-catalog.schema.json', outputPathCatalog],
    ['generated-asset-manifest.schema.json', generatedAssetManifest],
    ['migration-preservation-manifest.schema.json', migrationPreservation],
  ]);
}

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const digestFor = (value) => `sha256:${sha256Hex(value)}`;
const digestForCanonicalPath = (path, fallbackNamespace) => {
  const absolute = resolve(workspaceRoot, path);
  return existsSync(absolute) ? digestFor(readFileSync(absolute)) : digestFor(`${fallbackNamespace}:${path}`);
};
const source = (path) => ({ path, digest: digestForCanonicalPath(path, 'source') });
const contract = (id, version = '1.0.0') => ({ id, version });
const producer = (id) => ({ id, version: '1.0.0', sourceDigest: digestFor(`producer:${id}@1.0.0`) });
const document = (kind, schemaVersion, fields) => withDocumentDigest({
  kind, schemaVersion, protocolVersion: '1.5.0', documentVersion: '1.0.0', digestAlgorithm: 'sha256', canonicalization: 'rfc8785', ...fields,
});

// Registry definitions follow below. Keeping them in this generator makes the
// JSON files deterministic products and prevents prose or host files becoming
// a second source of truth.

const ROLE_DEFINITIONS = [
  ['planr-backend', 'backend-agent', 'dev', 'conditional', 'implementation-high', 'implementation', 'declared-paths', 'none', ['B', 'C'], ['scope-expansion', 'deploy', 'publish', 'credential-write'], ['backend'], ['R3', 'R5', 'R6', 'R7', 'R9', 'R10']],
  ['planr-database', 'db-agent', 'po-preflight', 'conditional', 'analysis-high', 'database-inspection', 'declared-paths', 'read-only', ['A'], ['database-mutation', 'deploy', 'publish', 'credential-write', 'scope-expansion'], ['database'], ['R3', 'R8', 'R10']],
  ['planr-designer', 'designer-agent', 'po', 'conditional', 'analysis-high', 'design-planning', 'declared-paths', 'none', ['A', 'B'], ['deploy', 'publish', 'credential-write', 'scope-expansion'], [], ['R1', 'R3', 'R10']],
  ['planr-devops', 'devops-agent', 'post-build', 'conditional', 'analysis-high', 'infrastructure-configuration', 'declared-paths', 'none', ['B', 'C'], ['deploy', 'publish', 'credential-write', 'scope-expansion'], ['devops'], ['R3', 'R5', 'R6', 'R7', 'R10']],
  ['planr-documentation', 'doc-gen-agent', 'post-build', 'conditional', 'analysis-high', 'documentation', 'declared-paths', 'none', ['B', 'C'], ['deploy', 'publish', 'credential-write', 'scope-expansion'], ['documentation'], ['R3', 'R5', 'R6', 'R7', 'R10']],
  ['planr-entity-scaffold', 'entity-scaffold-agent', 'po-preflight', 'manual', 'analysis-high', 'entity-scaffold', 'declared-paths', 'none', ['B', 'C'], ['database-mutation', 'deploy', 'publish', 'credential-write', 'scope-expansion'], ['entity-scaffold'], ['R3', 'R5', 'R6', 'R10']],
  ['planr-frontend', 'frontend-agent', 'dev', 'conditional', 'implementation-high', 'implementation', 'declared-paths', 'none', ['B', 'C'], ['scope-expansion', 'deploy', 'publish', 'credential-write'], ['frontend'], ['R2', 'R3', 'R5', 'R6', 'R7', 'R9', 'R10']],
  ['planr-qa', 'qa-agent', 'qa', 'always', 'read-only-qa', 'quality-verification', 'read-only', 'none', ['B'], ['database-mutation', 'deploy', 'publish', 'credential-write', 'scope-expansion'], ['qa'], ['R5', 'R6', 'R7', 'R10']],
  ['planr-specification', 'specification-agent', 'po', 'always', 'analysis-high', 'planning-write', 'declared-paths', 'none', ['A'], ['deploy', 'publish', 'credential-write', 'scope-expansion'], [], ['R1', 'R2', 'R3', 'R4', 'R10']],
];

function roleRecord([roleId, legacyId, phase, activation, capabilityTier, authorityClass, repositoryAccess,
  externalDataAccess, allowedOutputClasses, forbiddenEffects, taskKinds, ruleIds]) {
  const slug = roleId.slice('planr-'.length);
  const phaseDirectory = phase === 'po-preflight' ? 'po/preflight' : phase === 'post-build' ? 'post-build' : phase;
  return {
    roleId,
    roleVersion: '1.0.0',
    displayName: slug.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
    description: `Canonical ${slug} role for the OpenPlanr ${phase} phase.`,
    legacyAliases: [{ id: legacyId, status: 'compatibility', since: '1.5.0', removalVersion: null }],
    phase,
    activation,
    capabilityTier,
    authorityClass,
    writeBoundary: { repositoryAccess, externalDataAccess, allowedOutputClasses, forbiddenEffects },
    source: source(`agents/${phaseDirectory}/${roleId}/AGENT.md`),
    taskKinds,
    outputContracts: [contract(
      ['planr-backend', 'planr-frontend'].includes(roleId)
        ? 'implementation-result'
        : taskKinds.length ? 'task-output-manifest' : `${slug}-output`,
    )],
    ruleIds,
    adapterMappings: [
      { host: 'claude-code', nativeId: legacyId, generatedPath: `adapters/claude-code/agents/${legacyId}.md` },
      { host: 'codex', nativeId: roleId, generatedPath: `adapters/codex/agents/${roleId}.md` },
      { host: 'cursor', nativeId: roleId, generatedPath: `adapters/cursor/agents/${roleId}.md` },
    ],
    qaCoverage: [`tests/protocol/role-alias-registry.test.mjs`, `evaluation/roles/${roleId}.json`],
  };
}

function buildRoles() {
  return document('role-registry', '1.1.0', { roles: ROLE_DEFINITIONS.map(roleRecord) });
}

const TASK_BINDINGS = [
  ['backend', 'planr-backend', 'story', true, true, ['R2', 'R3', 'R5', 'R6', 'R9']],
  ['database', 'planr-database', 'preflight', false, false, ['R3', 'R8']],
  ['devops', 'planr-devops', 'feature', false, true, ['R3', 'R5', 'R6']],
  ['documentation', 'planr-documentation', 'feature', false, true, ['R3', 'R5', 'R6']],
  ['entity-scaffold', 'planr-entity-scaffold', 'preflight', false, true, ['R3', 'R5', 'R6']],
  ['frontend', 'planr-frontend', 'story', true, true, ['R2', 'R3', 'R5', 'R6', 'R9']],
  ['qa', 'planr-qa', 'quality', false, false, ['R5', 'R7', 'R10']],
];

function buildTaskKinds(roleRegistryDigest) {
  return document('task-kind-registry', '1.0.0', {
    roleRegistryDigest,
    bindings: TASK_BINDINGS.map(([taskKind, roleId, assignmentLevel, countsTowardR2, implementationAuthority, requiredRuleIds]) => ({
      taskKind, roleId, assignmentLevel, countsTowardR2, implementationAuthority,
      description: `${taskKind} assignment routed only to ${roleId}.`,
      inputContracts: [contract('task-manifest')],
      outputContracts: [contract(['backend', 'frontend'].includes(taskKind) ? 'implementation-result' : 'task-output-manifest')],
      requiredRuleIds,
    })),
    legacyMappings: [
      { legacyType: 'UI', legacyAgent: 'frontend-agent', taskKind: 'frontend', evidence: 'explicit-type-and-agent', precedence: 1 },
      { legacyType: 'Tech', legacyAgent: 'db-agent', taskKind: 'database', evidence: 'explicit-type-and-agent', precedence: 2 },
      { legacyType: 'Tech', legacyAgent: 'backend-agent', taskKind: 'backend', evidence: 'explicit-type-and-agent', precedence: 3 },
      { legacyType: 'Tech', legacyAgent: null, taskKind: 'backend', evidence: 'explicit-type-default', precedence: 4 },
    ],
  });
}

const RULES = [
  ['R1', 'Request-directed workflow', 'Planning requests produce planning artifacts. Implementation requests continue through code and the relevant engineering checks.', 'plan-ship-boundary'],
  ['R2', 'Bounded story decomposition', 'A story produces at most two implementation tasks: frontend and backend when design or UI input exists, otherwise one backend task.', 'task-decomposition'],
  ['R3', 'Portable capability tiers', 'Roles use registry-owned capability tiers and adapters own host model mapping; vendor model names are not protocol truth.', 'role-resolution'],
  ['R4', 'Generated task custody', 'Generated task documents are not manually edited; their reviewed parent source is corrected and deterministic generation is rerun.', 'task-generation'],
  ['R5', 'Immutable Preserve boundaries', 'Every Preserve repository path is immutable for the complete task and SHIP run and is verified against its bound baseline.', 'preserve-verification'],
  ['R6', 'Adaptive recovery', 'Use command results and diagnostics to choose useful corrections, continue while meaningful engineering progress is possible, and report a genuine impasse with the relevant error context.', 'adaptive-recovery'],
  ['R7', 'Proportional verification', 'Local work uses verification proportional to its risk and directly corrects relevant failures. Dedicated release certification owns release closure.', 'ship-closure'],
  ['R8', 'Read-only database inspection', 'Database inspection is read-only and cannot issue DDL, DML, or any external mutation.', 'database-authority'],
  ['R9', 'Implementation ownership', 'Frontend and backend ownership boundaries are binding; companion changes must be acceptance-required, disclosed, and outside Preserve.', 'ownership-boundary'],
  ['R10', 'Role QA parity', 'No role is releasable without corresponding QA verification coverage and generated adapter parity.', 'role-parity'],
];

function buildRules() {
  return document('rule-catalog', '1.0.0', {
    rules: RULES.map(([ruleId, title, normativeText, symbol]) => ({
      ruleId, ruleVersion: '1.0.0', title, status: 'active', normativeText,
      enforcementPoints: [{ package: '@openplanr/pipeline', path: `packages/pipeline/lib/pipeline/${symbol}.mjs`, symbol }],
      testRefs: [`tests/protocol/rule-catalog.test.mjs`], citedBy: ['docs/rules.md', 'agents/shared/rules.md'], source: source('docs/rules.md'),
    })).sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
  });
}

export const ROOT_COMMAND_SLUGS = [
  'artifact', 'backlog', 'checklist', 'config', 'context', 'diagram', 'doctor', 'epic', 'estimate', 'evidence', 'export', 'feature',
  'github', 'graph', 'init', 'land', 'linear', 'operate', 'pipeline', 'plan', 'quick', 'refine', 'report-linter', 'report',
  'revise', 'rules', 'runtime', 'search', 'setup', 'spec', 'sprint', 'status', 'story', 'sync', 'task', 'template', 'update',
  'upgrade', 'voice',
];

const RETIRED_SEMANTIC_ROOT_COMMANDS = new Map([
  ['estimate', 'skills/planr-plan/SKILL.md'],
  ['evidence', 'docs/generated/utility-command-catalog.json'],
  ['pipeline', 'docs/generated/utility-command-catalog.json'],
  ['plan', 'skills/planr-plan/SKILL.md'],
  ['refine', 'skills/planr-spec/SKILL.md'],
  ['revise', 'skills/planr-spec/SKILL.md'],
]);

const ROOT_COMMAND_SOURCE_OVERRIDES = new Map([
  ['config', 'packages/cli/src/cli/commands/config-deterministic.ts'],
  ['dashboard', 'packages/cli/src/cli/commands/dashboard.ts'],
  ['init', 'packages/cli/src/cli/commands/init-deterministic.ts'],
]);

export const PIPELINE_MACHINE_GRAMMAR = [
  ['advance-plan-review'], ['advance-ship'], ['complete-plan'], ['dashboard'], ['decide-plan-review'], ['design'], ['design-engine'],
  ['design-loop'], ['design-review'], ['doctor'], ['finalize-ship'], ['investigate', 'advance'], ['investigate', 'finalize'],
  ['investigate', 'start'], ['investigate', 'verify'], ['land'], ['plan'], ['plan-context'], ['prepare-browser-qa'], ['prepare-plan'],
  ['prepare-plan-review'], ['prepare-ship'], ['record-browser-qa'], ['reopen-ship'], ['run-ship-gates'], ['ship'], ['ship-context'],
  ['start-plan-review'], ['start-ship'], ['status'], ['sync'],
];

export const FROZEN_COMMAND_SLUGS = ['dashboard', 'design', 'design-loop', 'design-review', 'plan', 'ship', 'status', 'sync'];

const skillForFrozen = (slug) => `planr-${slug}`;
const commandSource = (path) => source(path);
const commandRecord = ({ commandId, surface, argv, ownerPackage, sourcePath, authorityClass = 'workflow', machineJson = false, skillId = null, lifecycle = 'active' }) => ({
  commandId, surface, argv, lifecycle, ownerPackage, source: commandSource(sourcePath), authorityClass, machineJson,
  outputContracts: [], skillId, aliases: [], testRefs: ['tests/protocol/command-catalog.test.mjs'],
});

const DEPRECATED_PLANNING_REVIEW_ACTIONS = new Set([
  'advance-plan-review',
  'decide-plan-review',
  'prepare-plan-review',
  'start-plan-review',
]);

function buildCommands() {
  const commands = [
    ...ROOT_COMMAND_SLUGS.map((slug) => commandRecord({
      commandId: `cli-${slug}`, surface: 'cli-root', argv: [slug], ownerPackage: 'openplanr',
      sourcePath: RETIRED_SEMANTIC_ROOT_COMMANDS.get(slug)
        ?? ROOT_COMMAND_SOURCE_OVERRIDES.get(slug)
        ?? (slug === 'diagram'
          ? 'packages/cli/src/cli/commands/diagram/index.ts'
          : `packages/cli/src/cli/commands/${slug}.ts`),
      machineJson: ['diagram', 'operate', 'pipeline', 'status'].includes(slug),
      lifecycle: RETIRED_SEMANTIC_ROOT_COMMANDS.has(slug) ? 'deprecated' : 'active',
    })),
    ...PIPELINE_MACHINE_GRAMMAR.map((tokens) => commandRecord({
      commandId: `pipeline-${tokens.join('-')}`, surface: 'pipeline-machine', argv: ['pipeline', ...tokens], ownerPackage: 'planr-pipeline',
      sourcePath: 'packages/pipeline/bin/planr-pipeline.mjs', machineJson: true,
      lifecycle: DEPRECATED_PLANNING_REVIEW_ACTIONS.has(tokens.join('-')) ? 'deprecated' : 'active',
    })),
    ...FROZEN_COMMAND_SLUGS.map((slug) => commandRecord({
      commandId: `frozen-${slug}`, surface: 'frozen-host-alias', argv: [`/planr-pipeline:${slug}`], ownerPackage: 'planr-pipeline',
      sourcePath: `skills/${skillForFrozen(slug)}/SKILL.md`, authorityClass: 'compatibility-router', machineJson: false,
      skillId: skillForFrozen(slug), lifecycle: 'deprecated',
    })),
  ].sort((left, right) => left.commandId.localeCompare(right.commandId));
  return document('command-catalog', '1.0.0', {
    binaries: [
      { id: 'openplanr', lifecycle: 'exact-alias', aliasOf: 'planr' },
      { id: 'opr', lifecycle: 'deprecated-exact-alias', aliasOf: 'planr' },
      { id: 'planr', lifecycle: 'canonical', aliasOf: null },
    ],
    inventory: {
      rootCommandModules: ROOT_COMMAND_SLUGS.length, rootCommandSlugs: ROOT_COMMAND_SLUGS,
      pipelineMachineLeaves: 31, pipelineMachineGrammar: PIPELINE_MACHINE_GRAMMAR,
      frozenClaudeDocuments: 8, frozenClaudeSlugs: FROZEN_COMMAND_SLUGS,
    },
    commands,
    negativeContracts: [
      {
        negativeContractId: 'retired-pipeline-operate', forbiddenArgvPrefix: ['pipeline', 'operate'],
        forbiddenPaths: ['packages/pipeline/commands/operate.md', 'packages/pipeline/skills/planr-operate/SKILL.md'],
        reason: 'Operate remains a CLI-owned planr operate facade; pipeline-owned Operate grammar and plugin assets are retired.',
        testRefs: ['tests/protocol/command-catalog.test.mjs', 'tests/ecosystem/operate-v2-clean-boundary-absence.test.mjs'],
      },
      ...[...RETIRED_SEMANTIC_ROOT_COMMANDS.keys()].map((slug) => ({
        negativeContractId: `retired-semantic-cli-${slug}`,
        forbiddenArgvPrefix: [slug],
        forbiddenPaths: [`packages/cli/src/cli/commands/${slug}.ts`],
        reason: `Semantic ${slug} work belongs to the active host agent under Protocol 1.8.`,
        testRefs: ['packages/cli/tests/unit/command-registration-parity.test.ts'],
      })),
    ],
  });
}

const CANONICAL_SKILL_REGISTRY = readCanonicalSkillRegistry();
export const CANONICAL_SKILL_IDS = Object.freeze(
  CANONICAL_SKILL_REGISTRY.skills.map(({ skillId }) => skillId),
);

function buildSkills() {
  const projectedName = (skillId) => skillId.replace(/^planr-/u, '');
  return document('skill-catalog', '1.0.0', {
    matchingPolicyVersion: '1.0.0',
    skills: CANONICAL_SKILL_REGISTRY.skills.map((row) => ({
        skillId: row.skillId,
        skillVersion: row.skillVersion,
        description: row.description,
        lifecycle: row.lifecycle,
        authorityClass: row.authorityClass,
        source: row.source,
        sourceDigest: sourceDigest(row.source),
        triggerPolicy: row.triggerPolicy,
        contracts: row.contracts,
        cliRequirements: row.cliRequirements,
        ruleIds: row.ruleIds,
        contributionManifestRefs: [`packages/skill-runtime/contributions/${row.contribution}.json`],
        hosts: [
          { host: 'claude-code', entrypoint: `/planr:${projectedName(row.skillId)}`, path: `dist/plugins/claude/openplanr/skills/${projectedName(row.skillId)}/SKILL.md` },
          { host: 'codex', entrypoint: `$planr:${projectedName(row.skillId)}`, path: `dist/plugins/openai/openplanr/skills/${projectedName(row.skillId)}/SKILL.md` },
          { host: 'cursor', entrypoint: row.skillId, path: `dist/plugins/cursor/openplanr/rules/${row.skillId}.mdc` },
        ],
        testRefs: ['tests/protocol/skill-catalog.test.mjs'],
        certificationRefs: [row.certification.migration],
      })),
    compatibilityAliases: CANONICAL_SKILL_REGISTRY.aliases.map((alias) => ({
      aliasId: alias.id,
      canonicalSkillId: alias.canonicalSkillId,
      lifecycle: 'deprecated',
      generatedPaths: [],
    })),
  });
}

const OUTPUTS = [
  ['artifact-review-bundle', 'Artifact review bundle', 'D', '@openplanr/artifact', 'artifact-bundle-path', '.planr/artifacts/{artifactId}/bundle.html', false, null, 'generated-asset-manifest', 'release', 'explicit-owner', ['text/html']],
  ['canonical-skill-source', 'Canonical skill source', 'A', '@openplanr/skill-runtime', 'skill-source-path', 'skills/{skillId}/SKILL.md', true, null, null, 'project', 'never', ['text/markdown', 'application/json']],
  ['dashboard-contract-data', 'Dashboard contract data', 'B', '@openplanr/protocol', 'dashboard-data-path', '.planr/dashboard/{projectId}.json', false, 'dashboard-bootstrap', null, 'run', 'on-success', ['application/json']],
  ['database-snapshot', 'Read-only database snapshot', 'A', '@openplanr/pipeline', 'database-snapshot-path', 'output/db/schema.json', true, null, null, 'project', 'never', ['application/json']],
  ['design-session', 'Design review session', 'B', '@openplanr/design', 'design-session-path', '.planr/design/{feature}/session.json', false, 'design-session', null, 'run', 'bounded-expiry', ['application/json']],
  ['design-specification', 'Design specification', 'A', '@openplanr/design', 'design-spec-path', 'output/feats/{feature}/design-spec.md', true, null, null, 'project', 'never', ['text/markdown']],
  ['diagram-set', 'Verified diagram set', 'D', '@openplanr/artifact', 'diagram-manifest-path', 'diagrams/{slug}/{slug}.manifest.json', false, 'diagram-manifest', 'diagram-manifest', 'project', 'explicit-owner', ['application/json', 'image/png', 'image/svg+xml', 'text/html']],
  ['diagram-source', 'Canonical diagram source', 'A', '@openplanr/artifact', 'diagram-source-path', 'diagrams/{slug}/{slug}.planr-diagram.json', true, 'diagram-document', 'diagram-manifest', 'project', 'never', ['application/vnd.openplanr.diagram+json']],
  ['evaluation-report', 'Evaluation report', 'B', '@openplanr/skill-runtime', 'evaluation-report-path', 'evaluation/results/{runId}.json', false, 'evaluation-aggregate-report', null, 'release', 'never', ['application/json']],
  ['generated-host-assets', 'Generated host plugin assets', 'D', '@openplanr/skill-runtime', 'host-asset-path', 'dist/plugins/{host}/openplanr/{assetPath}', false, null, 'generated-asset-manifest', 'release', 'never', ['application/json', 'text/markdown']],
  ['generated-project-files', 'Generated implementation files', 'C', '@openplanr/pipeline', 'generated-file-path', '{repositoryKey}/{path}', false, null, 'task-output-manifest', 'project', 'explicit-owner', ['application/octet-stream']],
  ['gherkin-feature', 'Gherkin acceptance feature', 'A', '@openplanr/pipeline', 'gherkin-path', 'output/feats/{feature}/us-{story}/acceptance.feature', true, null, null, 'project', 'never', ['text/plain'], {
    default: 'output/feats/{feature}/us-{story}/acceptance.feature',
    'spec-driven': '.planr/specs/{specId}-{specSlug}/stories/{storyId}-gherkin.feature',
  }],
  ['operate-state', 'Operate runtime state', 'B', '@openplanr/operate', 'operate-state-path', '.planr/operate/{cycleId}/state.json', true, 'operating-runtime-state', null, 'project', 'never', ['application/json']],
  ['planning-review-receipt', 'Planning review receipt', 'B', '@openplanr/pipeline', 'planning-review-path', '.planr/pipeline/{feature}/planning-review-receipt.json', true, 'planning-review-receipt', null, 'release', 'never', ['application/json']],
  ['professional-specification', 'Professional specification', 'A', '@openplanr/pipeline', 'professional-spec-path', 'input/specs/spec-{feature}.md', true, 'professional-specification', null, 'project', 'never', ['text/markdown'], {
    default: 'input/specs/spec-{feature}.md',
    'spec-driven': '.planr/specs/{specId}-{specSlug}/{specId}-{specSlug}.md',
  }],
  ['project-config', 'Project configuration', 'A', 'openplanr', 'project-config-path', '.planr/config.json', true, null, null, 'project', 'never', ['application/json']],
  ['release-proof', 'Release proof', 'D', '@openplanr/protocol', 'release-proof-path', 'conformance/release/{version}.json', false, 'migration-preservation-manifest', 'generated-asset-manifest', 'release', 'never', ['application/json']],
  ['ship-closure', 'SHIP closure receipt', 'B', '@openplanr/pipeline', 'ship-closure-path', '.planr/pipeline/{feature}/ship-closure.json', true, 'ship-closure', null, 'release', 'never', ['application/json']],
  ['task', 'Implementation task', 'A', '@openplanr/pipeline', 'task-path', 'output/feats/{feature}/us-{story}/tasks/task-{task}.md', true, 'task', 'task-manifest', 'project', 'never', ['text/markdown'], {
    default: 'output/feats/{feature}/us-{story}/tasks/task-{task}.md',
    'spec-driven': '.planr/specs/{specId}-{specSlug}/tasks/{taskId}-{taskSlug}.md',
  }],
  ['task-error-handoff', 'Blocked task error handoff', 'C', '@openplanr/pipeline', 'task-error-path', 'output/feats/{feature}/us-{story}/tasks/{taskId}-error-report.md', false, null, 'task-output-manifest', 'run', 'explicit-owner', ['text/markdown']],
  ['task-output-manifest', 'Task execution result', 'C', '@openplanr/pipeline', 'task-output-path', '.planr/pipeline/{feature}/tasks/{taskId}-output.json', true, 'task-output-manifest', null, 'run', 'never', ['application/json']],
  ['technology-stack', 'Technology stack contract', 'A', '@openplanr/pipeline', 'stack-path', 'input/tech/stack.md', true, 'stack', null, 'project', 'never', ['text/markdown']],
  ['user-story', 'User story', 'A', '@openplanr/pipeline', 'story-path', 'output/feats/{feature}/us-{story}/us-{story}.md', true, 'story', null, 'project', 'never', ['text/markdown'], {
    default: 'output/feats/{feature}/us-{story}/us-{story}.md',
    'spec-driven': '.planr/specs/{specId}-{specSlug}/stories/{storyId}-{storySlug}.md',
  }],
];

function buildOutputs() {
  return document('output-catalog', '1.0.0', {
    outputs: OUTPUTS.map(([outputId, title, outputClass, ownerPackage, pathFunctionId, pathTemplate, sourceOfTruth,
      schemaId, manifestId, retentionPolicy, cleanupPolicy, mediaTypes]) => ({
      outputId, title, outputClass, ownerPackage, pathFunctionId, pathTemplate,
      sourceOfTruth,
      schemaRef: schemaId ? contract(schemaId, schemaId.startsWith('operating-') ? '2.0.0' : schemaId === 'evaluation-aggregate-report' ? '1.4.0' : schemaId === 'dashboard-bootstrap' ? '1.2.0' : schemaId === 'ship-closure' || schemaId === 'planning-review-receipt' || schemaId === 'professional-specification' ? '1.1.0' : '1.0.0') : null,
      manifestRef: manifestId ? contract(manifestId) : null,
      generator: producer(`generate-${outputId}`), validator: { id: `validate-${outputId}`, version: '1.0.0' },
      compatibilityReaders: [{ package: ownerPackage, entrypoint: `${ownerPackage}/${outputId}` }],
      retentionPolicy, cleanupPolicy, mediaTypes, testRefs: ['tests/protocol/output-catalog.test.mjs'],
    })),
  });
}

function buildOutputPaths(outputCatalogDigest) {
  return document('output-path-catalog', '1.0.0', {
    outputCatalogDigest,
    outputs: OUTPUTS.flatMap(([outputId, _title, _outputClass, _ownerPackage, _pathFunctionId,
      _pathTemplate, _sourceOfTruth, _schemaId, _manifestId, _retentionPolicy, _cleanupPolicy,
      _mediaTypes, projectModePathTemplates]) => (
      projectModePathTemplates ? [{ outputId, pathTemplates: projectModePathTemplates }] : []
    )),
  });
}

export function buildRegistries() {
  const roles = buildRoles();
  const outputs = buildOutputs();
  return new Map([
    ['roles.json', roles],
    ['task-kinds.json', buildTaskKinds(roles.documentDigest)],
    ['rules.json', buildRules()],
    ['commands.json', buildCommands()],
    ['skills.json', buildSkills()],
    ['outputs.json', outputs],
    ['output-paths.json', buildOutputPaths(outputs.documentDigest)],
  ]);
}
