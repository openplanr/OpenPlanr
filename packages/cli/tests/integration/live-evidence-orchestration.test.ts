// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { sha256CanonicalJson } from '../../src/services/canonical-json.js';
import { githubLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/github.js';
import { ConnectorCheckpointCustodyError } from '../../src/services/connectors/checkpoint-custody.js';
import {
  type ConnectorEvidenceRequestV2,
  type ConnectorHealthProofV2,
  createBoundedFetchConnectorTransportV2,
  createConnectorRuntimeV2,
} from '../../src/services/connectors/connector-runtime.js';

const hash = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}` as `sha256:${string}`;

const now = Date.parse('2026-08-24T10:00:00.000Z');

const request: ConnectorEvidenceRequestV2 = {
  kind: 'openplanr-live-evidence-request',
  schemaVersion: '1.0.0',
  assignmentId: 'asg_liveevidence00000001',
  submissionId: 'sub_liveevidence00000001',
  actor: { actorId: 'connector.runtime', kind: 'agent', runtime: 'openplanr' },
  ownerActorId: 'owner.reference',
  provider: { id: 'github-delivery', version: '1.0.0' },
  adapterVersion: '1.0.0',
  operation: 'checks',
  sourceContract: { id: 'ci-test-evidence', version: '1.0.0' },
  scope: { scopeId: 'scope-reference', domainId: 'software', domainVersion: '1.0.0' },
  logicalCredentialRef: 'github.reference',
  consentRecordId: 'lcon_reference0001',
  accountIdentityHash: hash('1'),
  selectors: ['repository.reference'],
  scopes: ['actions:read', 'checks:read', 'contents:read', 'pull-requests:read'],
  queryHash: hash('2'),
  window: { from: '2026-08-24T09:00:00.000Z', to: '2026-08-24T09:30:00.000Z' },
  bounds: { maxCalls: 1, maxPages: 1, maxRecords: 10, maxBytes: 65_536 },
  classification: 'internal',
  sensitivity: 'confidential',
  purpose: 'Read the exact approved CI evidence.',
  consentExpiresAt: '2026-08-24T11:00:00.000Z',
  claim: { localClaimId: 'ci-gate', relation: 'supportedBy', confidence: 1 },
};

function docket() {
  return {
    provider: request.provider,
    adapterVersion: request.adapterVersion,
    accountIdentityHash: request.accountIdentityHash,
    selectors: request.selectors,
    effect: 'provider-call',
    scopes: request.scopes,
    queryHash: request.queryHash,
    window: request.window,
    ceilings: request.bounds,
    classification: request.classification,
    sensitivity: request.sensitivity,
    purpose: request.purpose,
    expiresAt: request.consentExpiresAt,
    changedRecordDiffHash: null,
    consequences: ['The provider receives one bounded read-only evidence query.'],
    authorityBoundary: 'consent-is-not-access-authority',
    choices: ['approve', 'cancel'],
    defaultChoice: null,
    cancelEffect: 'none',
  } as const;
}

function consent() {
  const protocolDocket = docket();
  const body = {
    kind: 'operating-live-evidence-consent-record',
    schemaVersion: '1.0.0',
    protocolVersion: '2.0.0',
    consentRecordId: request.consentRecordId,
    authority: 'none',
    decision: 'approved',
    docket: protocolDocket,
    docketHash: sha256CanonicalJson(protocolDocket),
    actor: { actorId: request.ownerActorId, kind: 'human' },
    provider: request.provider,
    adapterVersion: request.adapterVersion,
    accountIdentityHash: request.accountIdentityHash,
    selectors: request.selectors,
    scopes: request.scopes,
    queryHash: request.queryHash,
    window: request.window,
    ceilings: request.bounds,
    classification: request.classification,
    purpose: request.purpose,
    issuedAt: '2026-08-24T10:00:00.000Z',
    expiresAt: request.consentExpiresAt,
  };
  return Object.freeze({ ...body, consentHash: sha256CanonicalJson(body) });
}

function preparation() {
  return {
    assignment: {
      assignmentId: request.assignmentId,
      assignmentRevision: 1,
      assignmentKind: 'verification',
      outputContract: {
        schemaId: 'operating-live-evidence-ingestion',
        schemaVersion: '2.0.0',
      },
    },
    submissionId: request.submissionId,
    artifactId: 'art_liveevidence00000001',
    ingestionId: 'ling_liveevidence00000001',
    candidateId: 'evc_liveevidence00000001',
    evidenceRefId: 'evr_liveevidence00000001',
    evidenceArtifactId: 'art_liveevidencesnapshot01',
    evidenceResolutionId: 'evrs_liveevidence0000001',
    resolutionEventId: 'evt_liveevidenceresolve001',
    acceptanceEventIds: {
      submitted: 'evt_liveevidencesubmit0001',
      artifactCreated: 'evt_liveevidenceartifact01',
      validated: 'evt_liveevidencevalidate01',
    },
    correlationId: 'cor_liveevidence00000001',
    preparationHash: hash('3'),
  } as const;
}

describe('live-evidence orchestration', () => {
  it('recovers a write-then-throw materialized retry without a second provider or Store mutation', async () => {
    const providerCalls = vi.fn();
    let storeMutations = 0;
    let acceptCalls = 0;
    let stored:
      | {
          checkpoint: Record<string, unknown>;
          checkpointHistory: Record<string, unknown>[];
          evidence: null | {
            bytes: Uint8Array;
            digest: `sha256:${string}`;
            capturedAt: string;
            freshUntil: string;
          };
        }
      | undefined;
    const states = {
      request: 'requesting',
      materialize: 'materialized',
      commit: 'committed',
      absent: 'absent',
      uncertain: 'uncertain',
    } as const;
    const checkpoints = {
      async initialize(checkpoint: Record<string, unknown>) {
        stored ??= {
          checkpoint: structuredClone(checkpoint),
          checkpointHistory: [],
          evidence: null,
        };
        return structuredClone(stored);
      },
      async read(input: { checkpointId: string; requestHash: string }) {
        if (!stored) {
          throw new ConnectorCheckpointCustodyError(
            'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND',
            'not found',
          );
        }
        expect(stored.checkpoint.checkpointId).toBe(input.checkpointId);
        expect(stored.checkpoint.requestHash).toBe(input.requestHash);
        return structuredClone(stored);
      },
      async readByIdentity(identity: string) {
        if (!stored) {
          throw new ConnectorCheckpointCustodyError(
            'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND',
            'not found',
          );
        }
        expect([stored.checkpoint.checkpointId, stored.checkpoint.requestId]).toContain(identity);
        return structuredClone(stored);
      },
      async transition(input: {
        event: Record<string, unknown>;
        evidenceBytes?: Uint8Array;
        evidenceFreshness?: { capturedAt: string; freshUntil: string };
      }) {
        if (!stored) throw new Error('checkpoint missing');
        const previous = structuredClone(stored.checkpoint);
        const patch = input.event.patch as Record<string, unknown>;
        const type = input.event.type as keyof typeof states;
        const body = {
          ...previous,
          ...patch,
          state: states[type],
          generation: Number(previous.generation) + 1,
          lastEventId: input.event.eventId,
          lastEventHash: input.event.eventHash,
          predecessorDigest: previous.checkpointHash,
          updatedAt: input.event.at,
        };
        delete (body as Record<string, unknown>).checkpointHash;
        stored = {
          checkpoint: { ...body, checkpointHash: sha256CanonicalJson(body) },
          checkpointHistory: [...stored.checkpointHistory, previous],
          evidence: input.evidenceBytes
            ? {
                bytes: new Uint8Array(input.evidenceBytes),
                digest: `sha256:${'4'.repeat(64)}`,
                capturedAt: input.evidenceFreshness?.capturedAt ?? '',
                freshUntil: input.evidenceFreshness?.freshUntil ?? '',
              }
            : stored.evidence,
        };
        return structuredClone(stored);
      },
    };
    const liveRegistration = {
      providerId: request.provider.id,
      providerVersion: request.provider.version,
      adapterVersion: request.adapterVersion,
      baseEvidenceProvider: {
        providerId: 'reference-evidence-provider',
        providerVersion: '1.0.0',
        recordDigest: hash('5'),
      },
      baseResolver: {
        resolverId: 'reference-evidence-resolver',
        resolverVersion: '1.0.0',
        recordDigest: hash('6'),
      },
      registrationHash: hash('7'),
      bounds: { ...request.bounds, timeoutMs: 1_000 },
      health: { maxAgeSeconds: 300 },
    };
    const currentConsent = consent();
    const health: ConnectorHealthProofV2 = {
      status: 'available',
      checkedAt: '2026-08-24T10:00:00.000Z',
      freshUntil: '2026-08-24T10:05:00.000Z',
      proofDigest: hash('8'),
    };
    const healthCheck = vi.fn(() => health);
    let exactRequestingObserved = 0;
    const runtime = createConnectorRuntimeV2({
      registry: {
        list: () => [],
        resolve: () => ({ registration: liveRegistration, adapter: githubLiveEvidenceAdapterV2 }),
      } as never,
      credentials: {
        validatedConsent: async () => currentConsent,
        protocolBindingHash: async () => hash('9'),
        issueCapability: async () => Object.freeze({}),
        withResolvedCredential: async (
          _capability: unknown,
          _binding: unknown,
          use: (value: Uint8Array) => Promise<unknown>,
        ) => use(new TextEncoder().encode('ephemeral-fixture')),
      } as never,
      checkpoints: checkpoints as never,
      contracts: {
        assertOperatingLiveEvidenceConsentRecordV2: (value: unknown) =>
          value as Record<string, unknown>,
        assertOperatingConnectorCheckpointV2: (value: unknown) => value as Record<string, unknown>,
        assertOperatingLiveEvidenceIngestionV2: (
          value: unknown,
          options?: Record<string, unknown>,
        ) => {
          if ((options?.connectorCheckpoint as Record<string, unknown>)?.state === 'requesting') {
            exactRequestingObserved += 1;
          }
          return value as Record<string, unknown>;
        },
        deriveOperatingLiveEvidenceRequestHashV2: () => hash('a'),
        deriveOperatingLiveEvidenceContentDigestV2: () => hash('b'),
        reduceOperatingConnectorCheckpointV2: (value: unknown) => value as Record<string, unknown>,
      },
      evidenceRegistry: {
        providers: [
          {
            providerId: 'reference-evidence-provider',
            providerVersion: '1.0.0',
          },
        ],
        resolvers: [
          {
            resolverId: 'reference-evidence-resolver',
            resolverVersion: '1.0.0',
            recordDigest: hash('6'),
          },
        ],
      },
      operate: {
        prepareLiveEvidenceSubmission: async () => preparation(),
        acceptLiveEvidenceSubmission: async () => {
          acceptCalls += 1;
          if (acceptCalls === 1) {
            storeMutations += 1;
            throw new Error('response lost after Store commit');
          }
          return {
            assignmentId: request.assignmentId,
            submissionId: request.submissionId,
            artifactId: preparation().artifactId,
            artifactHash: hash('c'),
            evidenceRefId: preparation().evidenceRefId,
            evidenceArtifactId: preparation().evidenceArtifactId,
            resolutionId: preparation().evidenceResolutionId,
            replayed: true,
          };
        },
      },
      transport: {
        health: healthCheck,
        execute: async ({ expectedHealth }) => {
          providerCalls();
          return {
            status: 'materialized',
            requestedAt: '2026-08-24T10:00:00.000Z',
            capturedAt: '2026-08-24T10:00:01.000Z',
            freshUntil: '2026-08-24T10:05:00.000Z',
            health: expectedHealth,
            payload: {
              checks: [
                {
                  id: 'check.reference',
                  observedAt: '2026-08-24T10:00:01.000Z',
                  data: { conclusion: 'success' },
                },
              ],
            },
          };
        },
      },
      now: () => now,
    });

    await expect(runtime.collect(request)).rejects.toThrow('response lost');
    expect(stored?.checkpoint.state).toBe('materialized');
    const recovered = await runtime.collect(request);

    expect(recovered.ok).toBe(true);
    expect(providerCalls).toHaveBeenCalledOnce();
    expect(healthCheck).toHaveBeenCalledOnce();
    expect(storeMutations).toBe(1);
    expect(acceptCalls).toBe(2);
    expect(exactRequestingObserved).toBe(2);
    expect(stored?.checkpoint.state).toBe('committed');
    expect(stored?.checkpointHistory.some(({ state }) => state === 'requesting')).toBe(true);
  });

  it('turns divergent or unavailable provider health into typed uncertainty without materializing evidence', async () => {
    let stored:
      | {
          checkpoint: Record<string, unknown>;
          checkpointHistory: Record<string, unknown>[];
          evidence: null;
        }
      | undefined;
    const states = {
      request: 'requesting',
      materialize: 'materialized',
      commit: 'committed',
      absent: 'absent',
      uncertain: 'uncertain',
    } as const;
    const checkpoints = {
      async readByIdentity(identity: string) {
        if (!stored) {
          throw new ConnectorCheckpointCustodyError(
            'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND',
            'not found',
          );
        }
        expect([stored.checkpoint.checkpointId, stored.checkpoint.requestId]).toContain(identity);
        return structuredClone(stored);
      },
      async initialize(checkpoint: Record<string, unknown>) {
        stored ??= {
          checkpoint: structuredClone(checkpoint),
          checkpointHistory: [],
          evidence: null,
        };
        return structuredClone(stored);
      },
      async transition(input: { event: Record<string, unknown> }) {
        if (!stored) throw new Error('checkpoint missing');
        const previous = structuredClone(stored.checkpoint);
        const patch = input.event.patch as Record<string, unknown>;
        const type = input.event.type as keyof typeof states;
        const body = {
          ...previous,
          ...patch,
          state: states[type],
          generation: Number(previous.generation) + 1,
          lastEventId: input.event.eventId,
          lastEventHash: input.event.eventHash,
          predecessorDigest: previous.checkpointHash,
          updatedAt: input.event.at,
        };
        delete (body as Record<string, unknown>).checkpointHash;
        stored = {
          checkpoint: { ...body, checkpointHash: sha256CanonicalJson(body) },
          checkpointHistory: [...stored.checkpointHistory, previous],
          evidence: null,
        };
        return structuredClone(stored);
      },
    };
    const liveRegistration = {
      providerId: request.provider.id,
      providerVersion: request.provider.version,
      adapterVersion: request.adapterVersion,
      baseEvidenceProvider: {
        providerId: 'reference-evidence-provider',
        providerVersion: '1.0.0',
        recordDigest: hash('5'),
      },
      baseResolver: {
        resolverId: 'reference-evidence-resolver',
        resolverVersion: '1.0.0',
        recordDigest: hash('6'),
      },
      registrationHash: hash('7'),
      bounds: { ...request.bounds, timeoutMs: 1_000 },
      health: { maxAgeSeconds: 300 },
    };
    const preflightHealth: ConnectorHealthProofV2 = {
      status: 'available',
      checkedAt: '2026-08-24T10:00:00.000Z',
      freshUntil: '2026-08-24T10:05:00.000Z',
      proofDigest: hash('8'),
    };
    const health = vi.fn(() => preflightHealth);
    const execute = vi.fn(async () => ({
      status: 'materialized' as const,
      requestedAt: '2026-08-24T10:00:00.000Z',
      capturedAt: '2026-08-24T10:00:01.000Z',
      freshUntil: '2026-08-24T10:05:00.000Z',
      health: {
        status: 'unavailable' as const,
        checkedAt: '2026-08-24T10:00:01.000Z',
        freshUntil: '2026-08-24T10:05:00.000Z',
        proofDigest: hash('f'),
      },
      payload: {
        checks: [
          {
            id: 'check.reference',
            observedAt: '2026-08-24T10:00:01.000Z',
            data: { conclusion: 'success' },
          },
        ],
      },
    }));
    const acceptLiveEvidenceSubmission = vi.fn();
    const runtime = createConnectorRuntimeV2({
      registry: {
        list: () => [],
        resolve: () => ({ registration: liveRegistration, adapter: githubLiveEvidenceAdapterV2 }),
      } as never,
      credentials: {
        validatedConsent: async () => consent(),
        protocolBindingHash: async () => hash('9'),
        issueCapability: async () => Object.freeze({}),
        withResolvedCredential: async (
          _capability: unknown,
          _binding: unknown,
          use: (value: Uint8Array) => Promise<unknown>,
        ) => use(new TextEncoder().encode('ephemeral-fixture')),
      } as never,
      checkpoints: checkpoints as never,
      contracts: {
        assertOperatingLiveEvidenceConsentRecordV2: (value: unknown) =>
          value as Record<string, unknown>,
        assertOperatingConnectorCheckpointV2: (value: unknown) => value as Record<string, unknown>,
        assertOperatingLiveEvidenceIngestionV2: (value: unknown) =>
          value as Record<string, unknown>,
        deriveOperatingLiveEvidenceRequestHashV2: () => hash('a'),
        deriveOperatingLiveEvidenceContentDigestV2: () => hash('b'),
        reduceOperatingConnectorCheckpointV2: (value: unknown) => value as Record<string, unknown>,
      },
      evidenceRegistry: {
        providers: [
          {
            providerId: 'reference-evidence-provider',
            providerVersion: '1.0.0',
          },
        ],
        resolvers: [
          {
            resolverId: 'reference-evidence-resolver',
            resolverVersion: '1.0.0',
            recordDigest: hash('6'),
          },
        ],
      },
      operate: {
        prepareLiveEvidenceSubmission: async () => preparation(),
        acceptLiveEvidenceSubmission,
      },
      transport: { health, execute },
      now: () => now,
    });

    const result = await runtime.collect(request);
    expect(result).toMatchObject({
      ok: false,
      authorityRequired: false,
      ownerActionRequired: false,
      effects: [
        { id: 'provider-call', executed: true },
        { id: 'operate-assignment-submit', executed: false },
        { id: 'evidence-materialization', executed: false },
      ],
      error: { code: 'PROVIDER_HEALTH_DIVERGED' },
    });
    expect(health).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(acceptLiveEvidenceSubmission).not.toHaveBeenCalled();
    expect(stored?.checkpoint.state).toBe('uncertain');
  });

  it('rejects mapped metadata/private addresses before fetch and DNS rebinding after one bounded call', async () => {
    const policy = {
      providerId: request.provider.id,
      origin: 'https://evidence.example.test',
      pathnameByOperation: { checks: '/checks' },
      allowLoopback: false,
      authorizationScheme: 'Bearer' as const,
      timeoutMs: 1_000,
    };
    const expectedHealth: ConnectorHealthProofV2 = {
      status: 'available',
      checkedAt: '2026-08-24T10:00:00.000Z',
      freshUntil: '2026-08-24T10:05:00.000Z',
      proofDigest: hash('d'),
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ checks: [{ id: 'one', observedAt: '2026-08-24T10:00:01Z', data: {} }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const mapped = createBoundedFetchConnectorTransportV2({
      policies: [policy],
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: async () => [{ address: '::ffff:a9fe:a9fe' }],
      now: () => now,
    });
    await expect(
      mapped.execute({
        request,
        registration: {},
        collection: 'checks',
        credential: new TextEncoder().encode('fixture'),
        expectedHealth,
      }),
    ).rejects.toMatchObject({ code: 'E_LIVE_EVIDENCE_TRANSPORT_FORBIDDEN' });
    expect(fetchImpl).not.toHaveBeenCalled();

    let resolution = 0;
    const rebound = createBoundedFetchConnectorTransportV2({
      policies: [policy],
      fetchImpl: fetchImpl as typeof fetch,
      resolveHost: async () => [
        { address: resolution++ === 0 ? '93.184.216.34' : '93.184.216.35' },
      ],
      now: () => now,
    });
    await expect(
      rebound.execute({
        request,
        registration: {},
        collection: 'checks',
        credential: new TextEncoder().encode('fixture'),
        expectedHealth,
      }),
    ).rejects.toMatchObject({ code: 'E_LIVE_EVIDENCE_DNS_REBINDING' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
