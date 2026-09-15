// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256CanonicalJson } from '../../src/services/canonical-json.js';
import { businessMetricsLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/business-metrics.js';
import {
  assertDeploymentCommandDescriptorV2,
  deploymentHealthLiveEvidenceAdapterV2,
} from '../../src/services/connectors/adapters/deployment-health.js';
import { githubLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/github.js';
import { linearJiraLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/linear-jira.js';
import { posthogLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/posthog.js';
import { sentryLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/sentry.js';
import {
  type ConnectorAdapterV2,
  createConnectorRegistryV2,
  readConnectorAdapterResultBytesV2,
} from '../../src/services/connectors/connector-registry.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

type MatrixCase = Readonly<{
  id: string;
  providerId: string;
  category: string;
  operation: string;
  collection: string;
  sourceContractId: string;
  status: 'materialized' | 'absent';
}>;

const matrix = JSON.parse(
  readFileSync(resolve('tests/fixtures/live-evidence/adapter-matrix.json'), 'utf8'),
) as { schemaVersion: string; cases: MatrixCase[] };

const adapters: readonly ConnectorAdapterV2[] = [
  businessMetricsLiveEvidenceAdapterV2,
  deploymentHealthLiveEvidenceAdapterV2,
  githubLiveEvidenceAdapterV2,
  linearJiraLiveEvidenceAdapterV2,
  posthogLiveEvidenceAdapterV2,
  sentryLiveEvidenceAdapterV2,
];

const adapterSourceByProvider = new Map([
  ['business-metrics', resolve('src/services/connectors/adapters/business-metrics.ts')],
  ['deployment-health', resolve('src/services/connectors/adapters/deployment-health.ts')],
  ['github-delivery', resolve('src/services/connectors/adapters/github.ts')],
  ['linear-jira-work', resolve('src/services/connectors/adapters/linear-jira.ts')],
  ['posthog-product', resolve('src/services/connectors/adapters/posthog.ts')],
  ['sentry-error', resolve('src/services/connectors/adapters/sentry.ts')],
] as const);

const hash = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}` as `sha256:${string}`;

const healthy = Object.freeze({
  status: 'available' as const,
  checkedAt: '2026-08-24T10:00:00.000Z',
  freshUntil: '2026-08-24T10:05:00.000Z',
  proofDigest: hash('a'),
});

const bounds = Object.freeze({ maxCalls: 2, maxPages: 4, maxRecords: 100, maxBytes: 65_536 });

function adapterFor(providerId: string): ConnectorAdapterV2 {
  const adapter = adapters.find((candidate) => candidate.definition.provider.id === providerId);
  if (!adapter) throw new Error(`Fixture provider is not implemented: ${providerId}`);
  return adapter;
}

function normalize(input: MatrixCase, sourceIdentityHash = hash('b')) {
  const adapter = adapterFor(input.providerId);
  return adapter.normalize({
    operation: input.operation,
    sourceContract: { id: input.sourceContractId, version: '1.0.0' },
    requestHash: hash('c'),
    sourceIdentityHash,
    classification: 'internal',
    status: input.status,
    requestedAt: '2026-08-24T10:00:00.000Z',
    capturedAt: '2026-08-24T10:00:01.000Z',
    freshUntil: '2026-08-24T10:05:00.000Z',
    health:
      input.status === 'materialized' ? healthy : { ...healthy, status: 'unavailable' as const },
    bounds,
    payload:
      input.status === 'materialized'
        ? {
            [input.collection]: [
              {
                id: `${input.providerId}.record`,
                observedAt: '2026-08-24T10:00:01.000Z',
                data: {
                  status: 'healthy',
                  authorization: 'Bearer synthetic-test-value',
                  diagnostic: 'provider failed at /Users/example/private/fixture.json',
                },
              },
            ],
          }
        : {},
    absence:
      input.status === 'absent'
        ? {
            kind: 'provider-unavailable',
            reasonCode: 'PROVIDER_UNAVAILABLE',
            required: true,
            observedAt: '2026-08-24T10:00:01.000Z',
            details: { message: 'bounded unavailable result' },
          }
        : undefined,
  });
}

describe('live-evidence connector adapters', () => {
  it('binds original registry provenance to the exact six OpenPlanr adapter bytes', async () => {
    const pipelinePackageRoot = resolvePipelinePackageRoot();
    const registry = JSON.parse(
      readFileSync(join(pipelinePackageRoot, 'registry/live-evidence-providers.json'), 'utf8'),
    ) as {
      providers: Array<{
        providerId: string;
        providerVersion: string;
        adapterVersion: string;
        conformanceDigest: string;
        implementation: { id: string };
        provenance: { packageName: string; packageVersion: string; integrity: string };
      }>;
    };
    const openPlanrPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      name: string;
    };
    const contracts = (await import(
      pathToFileURL(join(pipelinePackageRoot, 'lib/pipeline/index.mjs')).href
    )) as {
      assertLiveEvidenceProviderRegistryV2(value: unknown, options: unknown): unknown;
      assertLiveEvidenceProviderRegistrationV2(value: unknown, options: unknown): unknown;
    };
    const { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2: baseRegistry } = (await import(
      pathToFileURL(join(pipelinePackageRoot, 'lib/operate/evidence-v2.mjs')).href
    )) as {
      OPEN_REFERENCE_EVIDENCE_REGISTRY_V2: { providers: unknown[]; resolvers: unknown[] };
    };
    const contractOptions = {
      baseEvidenceProviders: baseRegistry.providers,
      baseResolvers: baseRegistry.resolvers,
    };
    // Validate schema identities, the registry/registration hashes, and the exact
    // base provider/resolver records with the runtime's real contract reader.
    expect(() =>
      contracts.assertLiveEvidenceProviderRegistryV2(registry, contractOptions),
    ).not.toThrow();
    const expectedIds = [
      'business-metrics',
      'deployment-health',
      'github-delivery',
      'linear-jira-work',
      'posthog-product',
      'sentry-error',
    ];
    expect(registry.providers.map(({ providerId }) => providerId)).toEqual(expectedIds);
    expect(adapters.map(({ definition }) => definition.provider.id).sort()).toEqual(expectedIds);

    for (const row of registry.providers) {
      const adapter = adapterFor(row.providerId);
      const source = adapterSourceByProvider.get(row.providerId);
      if (!source) throw new Error(`Adapter source is not declared: ${row.providerId}`);
      expect(row.providerVersion).toBe(adapter.definition.provider.version);
      expect(row.adapterVersion).toBe(adapter.definition.adapterVersion);
      expect(row.conformanceDigest).toBe(adapter.definition.conformanceDigest);
      expect(row.implementation.id).toBe(adapter.definition.adapterId);
      expect(row.provenance.packageName).toBe(openPlanrPackage.name);
      // This version records the original registration, not the current CLI
      // release. Repackaging unchanged adapters must preserve that provenance.
      const repackagedVersion = `${Number(row.provenance.packageVersion.split('.')[0]) + 1}.0.0`;
      expect(() =>
        contracts.assertLiveEvidenceProviderRegistrationV2(
          { ...row, provenance: { ...row.provenance, packageVersion: repackagedVersion } },
          contractOptions,
        ),
      ).toThrow(/registrationHash does not bind the exact canonical record/u);
      expect(row.provenance.integrity).toBe(
        `sha256:${createHash('sha256').update(readFileSync(source)).digest('hex')}`,
      );
    }
  });

  it('normalizes every fixture through one bounded, redacted, GET-only result contract', () => {
    expect(matrix.schemaVersion).toBe('1.0.0');
    expect(matrix.cases).toHaveLength(12);
    expect(new Set(matrix.cases.map(({ category }) => category))).toEqual(
      new Set(['delivery', 'work', 'error', 'product', 'deployment', 'business-metrics']),
    );

    for (const entry of matrix.cases) {
      const adapter = adapterFor(entry.providerId);
      const result = normalize(entry);
      expect(adapter.definition.allowedMethods).toEqual(['GET']);
      expect(adapter.definition.transport).toBe('https-or-loopback');
      expect(adapter.definition.unavailableBehavior).toBe('typed-absence');
      expect(adapter.definition.conformanceDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(result.provider.id).toBe(entry.providerId);
      expect(result.category).toBe(entry.category);
      expect(result.status).toBe(entry.status);
      expect(result.requestHash).toBe(hash('c'));
      expect(result.sourceIdentityHash).toBe(hash('b'));
      expect(result.records).toHaveLength(entry.status === 'materialized' ? 1 : 0);
      expect(result.absences).toHaveLength(entry.status === 'absent' ? 1 : 0);

      const first = readConnectorAdapterResultBytesV2(result);
      const text = Buffer.from(first).toString('utf8');
      expect(text).not.toContain('synthetic-test-value');
      expect(text).not.toContain('/Users/example');
      if (entry.status === 'materialized') expect(text).toContain('[REDACTED]');
      first.fill(0);
      const second = readConnectorAdapterResultBytesV2(result);
      expect(second.some((value) => value !== 0)).toBe(true);
      expect(`sha256:${createHash('sha256').update(second).digest('hex')}`).toBe(
        result.redactedBytesDigest,
      );
    }
  });

  it('binds identical provider record IDs to exact request and account/source custody', () => {
    const fixture = matrix.cases.find(({ id }) => id === 'github-materialized');
    if (!fixture) throw new Error('GitHub fixture is missing.');
    const left = normalize(fixture, hash('d'));
    const right = normalize(fixture, hash('e'));
    expect(left.records[0].recordIdentityHash).not.toBe(right.records[0].recordIdentityHash);
    expect(left.redactedBytesDigest).not.toBe(right.redactedBytesDigest);
  });

  it('selects only exact frozen registry membership and rejects substitution or duplicates', () => {
    const registrations = adapters.map((adapter) => ({
      providerId: adapter.definition.provider.id,
      providerVersion: adapter.definition.provider.version,
      adapterVersion: adapter.definition.adapterVersion,
      conformanceDigest: adapter.definition.conformanceDigest,
      implementation: { id: adapter.definition.adapterId },
      supportedKinds: [
        ...new Set(adapter.definition.operations.flatMap(({ sourceContracts }) => sourceContracts)),
      ].sort(),
      supportedDomains: [...adapter.definition.supportedDomains],
      effects: ['provider-call'],
    }));
    const contracts = {
      assertLiveEvidenceProviderRegistryV2: (value: unknown) => value,
      assertLiveEvidenceProviderRegistrationV2: (value: unknown) => value,
    };
    const registry = createConnectorRegistryV2({
      contracts,
      registry: { providers: registrations },
      baseEvidenceProviders: [],
      baseResolvers: [],
      adapters,
    });
    const selected = registry.resolve({
      providerId: 'github-delivery',
      providerVersion: '1.0.0',
      adapterVersion: '1.0.0',
      operation: 'checks',
      sourceContractId: 'ci-test-evidence',
      domainId: 'software',
    });
    expect(selected.adapter).toBe(githubLiveEvidenceAdapterV2);
    expect(registry.list()).toHaveLength(6);
    expect(() =>
      registry.resolve({
        providerId: 'github-delivery',
        providerVersion: '1.0.0',
        adapterVersion: '1.0.0',
        operation: 'checks',
        sourceContractId: 'finance-metrics',
        domainId: 'software',
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE' }));

    expect(() =>
      createConnectorRegistryV2({
        contracts,
        registry: { providers: registrations },
        baseEvidenceProviders: [],
        baseResolvers: [],
        adapters: [...adapters, githubLiveEvidenceAdapterV2],
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIVE_EVIDENCE_ADAPTER_CONFLICT' }));

    const replaced = structuredClone(registrations);
    replaced[0].conformanceDigest = hash('f');
    expect(() =>
      createConnectorRegistryV2({
        contracts,
        registry: { providers: replaced },
        baseEvidenceProviders: [],
        baseResolvers: [],
        adapters,
      }),
    ).toThrowError(expect.objectContaining({ code: 'LIVE_EVIDENCE_PROVIDER_INCOMPATIBLE' }));
  });

  it('validates deployment metadata as a descriptor only and exposes no execution seam', () => {
    const body = {
      kind: 'openplanr-deployment-command-descriptor' as const,
      schemaVersion: '1.0.0' as const,
      descriptorId: 'deploy.fixture',
      targetIdentityHash: hash('1'),
      operation: 'deploy' as const,
      commandDigest: hash('2'),
      effect: 'descriptor-only' as const,
      previewOnly: true as const,
    };
    const descriptor = assertDeploymentCommandDescriptorV2({
      ...body,
      descriptorHash: sha256CanonicalJson(body),
    });
    expect(descriptor.effect).toBe('descriptor-only');
    expect(descriptor).not.toHaveProperty('execute');
    expect(descriptor).not.toHaveProperty('command');
    expect(() =>
      assertDeploymentCommandDescriptorV2({ ...descriptor, previewOnly: false }),
    ).toThrow('descriptor-only contract');
  });
});
