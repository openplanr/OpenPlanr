// @vitest-environment node

import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  assertOperatingConnectorCheckpointV2,
  assertOperatingLiveEvidenceConsentRecordV2,
  assertOperatingLiveEvidenceIngestionV2,
  deriveOperatingLiveEvidenceContentDigestV2,
  deriveOperatingLiveEvidenceRequestHashV2,
  reduceOperatingConnectorCheckpointV2,
} from 'planr-pipeline';
import { OPEN_REFERENCE_EVIDENCE_REGISTRY_V2 } from 'planr-pipeline/operate/evidence-v2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256CanonicalJson } from '../../src/services/canonical-json.js';
import { githubLiveEvidenceAdapterV2 } from '../../src/services/connectors/adapters/github.js';
import { createConnectorCheckpointCustodyV2 } from '../../src/services/connectors/checkpoint-custody.js';
import {
  type ConnectorEvidenceRequestV2,
  createConnectorRuntimeV2,
} from '../../src/services/connectors/connector-runtime.js';
import {
  createOperateClient,
  type LiveEvidenceSubmissionRequestV2,
  type OperateActorV2,
} from '../../src/services/operate/client.js';
import { createOperateComposition } from '../../src/services/operate/composition.js';
import { ensureOperateStorageLayout } from '../../src/services/operate/storage-layout.js';
import { createOperateStore, type OperateStoredRuntime } from '../../src/services/operate/store.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const actor: OperateActorV2 = {
  actorId: 'connector.runtime',
  kind: 'agent',
  runtime: 'openplanr',
};

function runtime(outputSchemaId = 'operating-live-evidence-ingestion'): OperateStoredRuntime {
  const assignmentId = 'asg_liveevidence00000001';
  const submissionId = 'sub_liveevidence00000001';
  return {
    generation: 'gen_00000000000000000000000000000001',
    baseState: {},
    events: [],
    artifacts: new Map(),
    preferences: {
      selectedScopeId: null,
      selectedDomainId: null,
      selectedDomainVersion: null,
      lastCycleId: null,
      reviewOwners: {},
      cycleModes: {},
      cycleDeliveryRoutes: {},
      assignmentArtifactIds: {
        [assignmentId]: 'art_liveevidence00000001',
      },
      cycleRoleAssignments: {},
      cycleIntelligencePlanIds: {},
      actorMemberships: {},
    },
    state: {
      assignments: [
        {
          assignmentId,
          assignmentKind: 'verification',
          state: 'running',
          claim: {
            actorId: actor.actorId,
            actorKind: actor.kind,
            runtime: actor.runtime,
          },
          inputArtifactIds: [],
          outputContract: {
            schemaId: outputSchemaId,
            schemaVersion: '2.0.0',
            mediaType: 'application/json',
            encoding: 'utf-8',
            maxBytes: 65_536,
          },
        },
      ],
      submissions: [
        {
          assignmentId,
          submissionId,
          state: 'issued',
        },
      ],
    },
  };
}

function clientFor(source: OperateStoredRuntime) {
  const client = createOperateClient('/tmp/openplanr-live-evidence-no-store');
  Object.defineProperty(client, 'requiredRuntime', {
    configurable: true,
    value: async () => source,
  });
  return client;
}

describe('live-evidence Operate bridge', () => {
  it('prepares deterministic runtime identities without Store or provider effects', async () => {
    const client = clientFor(runtime());
    const input = {
      assignmentId: 'asg_liveevidence00000001',
      submissionId: 'sub_liveevidence00000001',
      actor,
    } as const;

    const first = await client.prepareLiveEvidenceSubmission(input);
    const second = await client.prepareLiveEvidenceSubmission(input);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      artifactId: 'art_liveevidence00000001',
      assignment: {
        assignmentKind: 'verification',
        outputContract: { schemaId: 'operating-live-evidence-ingestion' },
      },
    });
    expect(first.acceptanceEventIds.submitted).not.toBe(first.acceptanceEventIds.artifactCreated);
    expect(JSON.stringify(first)).not.toContain('/tmp/');
  });

  it('refuses the generic verification submit path before staging ingestion bytes', async () => {
    const client = clientFor(runtime());
    const response = await client.dispatch({
      operation: 'operate.assignment.submit',
      request: {
        assignmentId: 'asg_liveevidence00000001',
        submissionId: 'sub_liveevidence00000001',
        actor,
        mediaType: 'application/json',
        encoding: 'utf-8',
        contentBase64: Buffer.from('{}').toString('base64'),
      },
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'CAPABILITY_DENIED', retryable: false },
    });
  });

  it('rejects foreign output contracts and claimant identities pre-effect', async () => {
    const foreignContract = clientFor(runtime('operating-outcome'));
    await expect(
      foreignContract.prepareLiveEvidenceSubmission({
        assignmentId: 'asg_liveevidence00000001',
        submissionId: 'sub_liveevidence00000001',
        actor,
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });

    const exact = clientFor(runtime());
    await expect(
      exact.prepareLiveEvidenceSubmission({
        assignmentId: 'asg_liveevidence00000001',
        submissionId: 'sub_liveevidence00000001',
        actor: { ...actor, actorId: 'foreign.agent' },
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DENIED' });
  });

  it('accepts one real disposable Assignment, Artifact/Event chain, evidence resolution, Store commit, and exact replay', async () => {
    const projectDir = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'openplanr-live-evidence-bridge-')),
    );
    roots.push(projectDir);
    const pipelineRoot = resolvePipelinePackageRoot();
    const protocolFixtures = JSON.parse(
      readFileSync(
        path.join(
          pipelineRoot,
          'conformance/fixtures/operating-runtime-v2/all-contracts-valid.json',
        ),
        'utf8',
      ),
    ) as Record<string, Record<string, unknown>>;
    const providerRegistry = JSON.parse(
      readFileSync(path.join(pipelineRoot, 'registry/live-evidence-providers.json'), 'utf8'),
    ) as { providers: Record<string, unknown>[] };
    const registration = providerRegistry.providers.find(
      ({ providerId }) => providerId === 'github-delivery',
    );
    if (!registration) throw new Error('Packed GitHub provider registration is unavailable.');

    const cycleId = 'cyc_liveevidence00000001';
    const timestamp = '2026-08-24T10:00:00.000Z';
    const composition = await createOperateComposition();
    const empty = composition.createEmptyState(timestamp) as unknown as Record<string, unknown>;
    const assignment = {
      ...structuredClone(protocolFixtures['operating-assignment']),
      assignmentId: 'asg_liveevidence00000001',
      cycleId,
      assignmentKind: 'verification',
      roleId: 'evidence-connector',
      state: 'running',
      dependsOn: [],
      dependencyPolicy: { kind: 'none' },
      inputArtifactIds: [],
      inputAbsences: [],
      outputContract: {
        schemaId: 'operating-live-evidence-ingestion',
        schemaVersion: '2.0.0',
        mediaType: 'application/json',
        encoding: 'utf-8',
        maxBytes: 65_536,
      },
      capabilityGrantId: 'cgr_liveevidence00000001',
      governedOperationId: 'op_liveevidence00000001',
      claim: {
        actorId: actor.actorId,
        actorKind: actor.kind,
        runtime: actor.runtime,
        claimId: 'claim_liveevidence000001',
      },
      terminalOutcome: null,
      createdAt: timestamp,
      availableAt: timestamp,
      completedAt: null,
    };
    const submission = {
      ...structuredClone(protocolFixtures['operating-submission']),
      submissionId: 'sub_liveevidence00000001',
      assignmentId: assignment.assignmentId,
      cycleId,
      state: 'issued',
      rawHash: null,
      canonicalHash: null,
      sizeBytes: null,
      artifactId: null,
      acceptanceEventIds: [],
      responseData: null,
      issuedAt: timestamp,
      resolvedAt: null,
    };
    const cycle = {
      ...structuredClone(protocolFixtures['operating-cycle']),
      cycleId,
      scopeId: 'scope-reference',
      domainId: 'software',
      domainVersion: '1.0.0',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const inputBinding = {
      ...structuredClone(protocolFixtures['operating-cycle-input-binding']),
      inputBindingId: cycle.inputBindingId,
      cycleId,
      scopeId: cycle.scopeId,
      domainId: cycle.domainId,
      domainVersion: cycle.domainVersion,
      sourceArtifactIds: [],
      capturedAt: timestamp,
    };
    const state = {
      ...structuredClone(empty),
      cycles: [cycle],
      inputBindings: [inputBinding],
      assignments: [assignment],
      submissions: [submission],
    };
    const preferences = runtime().preferences;
    await ensureOperateStorageLayout(projectDir);
    const store = createOperateStore(projectDir);
    const seeded = await store.commit(
      { baseState: state, state, events: [], artifacts: new Map(), preferences },
      null,
    );
    const client = createOperateClient(projectDir);
    const consentDocket = {
      provider: { id: 'github-delivery', version: '1.0.0' },
      adapterVersion: '1.0.0',
      accountIdentityHash: `sha256:${'1'.repeat(64)}`,
      selectors: ['repository.reference'],
      effect: 'provider-call',
      scopes: ['actions:read', 'checks:read', 'contents:read', 'pull-requests:read'],
      queryHash: `sha256:${'2'.repeat(64)}`,
      window: {
        from: '2026-08-24T09:00:00.000Z',
        to: '2026-08-24T09:30:00.000Z',
      },
      ceilings: { maxCalls: 1, maxPages: 1, maxRecords: 10, maxBytes: 65_536 },
      classification: 'internal',
      sensitivity: 'confidential',
      purpose: 'Read the exact approved CI evidence.',
      expiresAt: '2026-08-24T11:00:00.000Z',
      changedRecordDiffHash: null,
      consequences: ['The provider receives one bounded read-only evidence query.'],
      authorityBoundary: 'consent-is-not-access-authority',
      choices: ['approve', 'cancel'],
      defaultChoice: null,
      cancelEffect: 'none',
    };
    const consentBody = {
      kind: 'operating-live-evidence-consent-record',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      consentRecordId: 'lcon_reference0001',
      authority: 'none',
      decision: 'approved',
      docket: consentDocket,
      docketHash: sha256CanonicalJson(consentDocket),
      actor: { actorId: 'owner.reference', kind: 'human' },
      provider: consentDocket.provider,
      adapterVersion: consentDocket.adapterVersion,
      accountIdentityHash: consentDocket.accountIdentityHash,
      selectors: consentDocket.selectors,
      scopes: consentDocket.scopes,
      queryHash: consentDocket.queryHash,
      window: consentDocket.window,
      ceilings: consentDocket.ceilings,
      classification: consentDocket.classification,
      purpose: consentDocket.purpose,
      issuedAt: timestamp,
      expiresAt: consentDocket.expiresAt,
    };
    const consentRecord = { ...consentBody, consentHash: sha256CanonicalJson(consentBody) };
    const baseProvider = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers.find(
      ({ providerId }) => providerId === 'local-operate-artifact-evidence-provider',
    );
    const baseResolver = OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.find(
      ({ resolverId }) => resolverId === 'local-operate-artifact-evidence-resolver',
    );
    if (!baseProvider || !baseResolver)
      throw new Error('Operate-artifact resolver base is missing.');
    const health = {
      status: 'available' as const,
      checkedAt: timestamp,
      freshUntil: '2026-08-24T10:05:00.000Z',
      proofDigest: `sha256:${'8'.repeat(64)}` as const,
    };
    const providerCall = vi.fn();
    let capturedAcceptanceRequest: LiveEvidenceSubmissionRequestV2 | undefined;
    const connector = createConnectorRuntimeV2({
      registry: {
        list: () => [],
        resolve: () => ({ registration, adapter: githubLiveEvidenceAdapterV2 }),
      } as never,
      credentials: {
        validatedConsent: async () => consentRecord,
        protocolBindingHash: async () => `sha256:${'9'.repeat(64)}` as const,
        issueCapability: async () => Object.freeze({}),
        withResolvedCredential: async (
          _capability: unknown,
          _binding: unknown,
          use: (credential: Uint8Array) => Promise<unknown>,
        ) => use(new TextEncoder().encode('ephemeral-fixture')),
      } as never,
      checkpoints: createConnectorCheckpointCustodyV2({
        root: path.join(projectDir, '.connector-checkpoints'),
        contracts: {
          assertOperatingConnectorCheckpointV2,
          reduceOperatingConnectorCheckpointV2,
        },
        now: () => Date.parse(timestamp),
      }),
      contracts: {
        assertOperatingLiveEvidenceConsentRecordV2,
        assertOperatingConnectorCheckpointV2,
        assertOperatingLiveEvidenceIngestionV2,
        deriveOperatingLiveEvidenceRequestHashV2,
        deriveOperatingLiveEvidenceContentDigestV2,
        reduceOperatingConnectorCheckpointV2,
      },
      evidenceRegistry: {
        providers: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.providers,
        resolvers: OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers,
      },
      operate: {
        prepareLiveEvidenceSubmission: (input) => client.prepareLiveEvidenceSubmission(input),
        acceptLiveEvidenceSubmission: (input) => {
          capturedAcceptanceRequest = structuredClone(input);
          return client.acceptLiveEvidenceSubmission(input);
        },
      },
      transport: {
        health: () => health,
        execute: async ({ expectedHealth }) => {
          providerCall();
          return {
            status: 'materialized',
            requestedAt: timestamp,
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
      now: () => Date.parse(timestamp),
    });
    const evidenceRequest: ConnectorEvidenceRequestV2 = {
      kind: 'openplanr-live-evidence-request',
      schemaVersion: '1.0.0',
      assignmentId: String(assignment.assignmentId),
      submissionId: String(submission.submissionId),
      actor,
      ownerActorId: 'owner.reference',
      provider: { id: 'github-delivery', version: '1.0.0' },
      adapterVersion: '1.0.0',
      operation: 'checks',
      sourceContract: { id: 'ci-test-evidence', version: '1.0.0' },
      scope: { scopeId: 'scope-reference', domainId: 'software', domainVersion: '1.0.0' },
      logicalCredentialRef: 'github.reference',
      consentRecordId: 'lcon_reference0001',
      accountIdentityHash: `sha256:${'1'.repeat(64)}`,
      selectors: ['repository.reference'],
      scopes: ['actions:read', 'checks:read', 'contents:read', 'pull-requests:read'],
      queryHash: `sha256:${'2'.repeat(64)}`,
      window: { from: '2026-08-24T09:00:00.000Z', to: '2026-08-24T09:30:00.000Z' },
      bounds: { maxCalls: 1, maxPages: 1, maxRecords: 10, maxBytes: 65_536 },
      classification: 'internal',
      sensitivity: 'confidential',
      purpose: 'Read the exact approved CI evidence.',
      consentExpiresAt: '2026-08-24T11:00:00.000Z',
      claim: { localClaimId: 'local-claim-ci-gate', relation: 'supportedBy', confidence: 1 },
    };

    const accepted = await connector.collect(evidenceRequest);
    expect(accepted.ok).toBe(true);
    const after = await store.load(({ baseState, events, artifacts }) =>
      composition.replay(baseState, events, artifacts),
    );
    expect(after?.state.assignments).toEqual([
      expect.objectContaining({ assignmentId: assignment.assignmentId, state: 'validated' }),
    ]);
    expect(after?.state.evidenceRefs).toHaveLength(1);
    expect(after?.state.evidenceResolutions).toHaveLength(1);
    expect(after?.artifacts.size).toBe(2);
    expect(after?.events).toHaveLength(4);
    expect(after?.generation).not.toBe(seeded.generation);

    const acceptedRequest = capturedAcceptanceRequest as
      | LiveEvidenceSubmissionRequestV2
      | undefined;
    if (!after || !acceptedRequest) {
      throw new Error('The accepted live-evidence request was not retained for hostile replay.');
    }
    const ingestion = JSON.parse(
      Buffer.from(acceptedRequest.contentBase64, 'base64').toString('utf8'),
    ) as Record<string, unknown>;
    const ingestionSubmission = ingestion.submission as Record<string, unknown>;
    const event = (eventId: unknown) => {
      const found = after.events.find((candidateEvent) => candidateEvent.eventId === eventId);
      if (!found) throw new Error('The accepted live-evidence Event chain is incomplete.');
      return found;
    };
    const substitutedIssuedAssignment = {
      ...structuredClone(acceptedRequest.custody.issuedAssignment),
      roleId: 'substituted-evidence-connector',
    };
    expect(() =>
      composition.materializeLiveEvidence(
        {
          candidate: (ingestion.evidenceCandidates as Record<string, unknown>[])[0],
          claimLinks: (ingestion.evidenceClaimLinks as Record<string, unknown>[]).map(
            ({ sourceArtifactId, localClaimId, relation, confidence }) => ({
              sourceArtifactId,
              localClaimId,
              relation,
              confidence,
            }),
          ),
        },
        {
          resolutionId: 'evs_liveevidencehostile1',
          eventId: 'evt_liveevidencehostile1',
          timestamp: '2026-08-24T10:00:02.000Z',
          correlationId: 'corr-live-evidence-hostile',
          evidenceRefId: 'evr_liveevidencehostile1',
          evidenceArtifactId: 'art_liveevidencehostile1',
        },
        after.state,
        new Map(after.artifacts),
        String(ingestionSubmission.artifactId),
        {
          issuedAssignment: substitutedIssuedAssignment,
          liveProviderRegistration: acceptedRequest.custody.liveProviderRegistration,
          baseEvidenceProvider: acceptedRequest.custody.baseEvidenceProvider,
          baseResolver: acceptedRequest.custody.baseResolver,
          consentRecord: acceptedRequest.custody.consentRecord,
          connectorCheckpoint: acceptedRequest.custody.connectorCheckpoint,
          submittedEvent: event(ingestionSubmission.submittedEventId),
          artifactCreatedEvent: event(ingestionSubmission.artifactCreatedEventId),
          validatedEvent: event(ingestionSubmission.validatedEventId),
        },
      ),
    ).toThrow(/failed semantic Assignment\/provider custody/);

    const replayed = await connector.collect(evidenceRequest);
    const replayRuntime = await store.load(({ baseState, events, artifacts }) =>
      composition.replay(baseState, events, artifacts),
    );
    expect(replayed.ok).toBe(true);
    expect(providerCall).toHaveBeenCalledOnce();
    expect(replayRuntime?.generation).toBe(after?.generation);
    expect(replayRuntime?.events).toHaveLength(4);
  });
});
