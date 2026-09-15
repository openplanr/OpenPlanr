// @vitest-environment node

import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256CanonicalJson } from '../../src/services/canonical-json.js';
import {
  type ConnectorCheckpointCustodyError,
  createConnectorCheckpointCustodyV2,
} from '../../src/services/connectors/checkpoint-custody.js';
import {
  type ConnectorCredentialCapabilityBindingV2,
  ConnectorCredentialCustodyError,
  type ConnectorCredentialSourceV2,
  createConnectorCredentialCustodyV2,
} from '../../src/services/connectors/credential-custody.js';
import { resolvePipelinePackageRoot } from '../helpers/pipeline-package-root.js';

vi.mock('@napi-rs/keyring', () => {
  throw new Error('Native credential binding is unavailable at /sensitive/native-binding.node.');
});

type PipelineLiveEvidenceApi = Readonly<{
  assertOperatingLiveEvidenceConsentRecordV2(value: unknown): Readonly<Record<string, unknown>>;
  assertOperatingConnectorCheckpointV2(value: unknown): Readonly<Record<string, unknown>>;
  reduceOperatingConnectorCheckpointV2(
    current: unknown,
    event: unknown,
  ): Readonly<Record<string, unknown>>;
}>;

const pipelineRoot = resolvePipelinePackageRoot();
const pipeline = (await import(
  pathToFileURL(join(pipelineRoot, 'lib/pipeline/index.mjs')).href
)) as PipelineLiveEvidenceApi;
const liveFixture = JSON.parse(
  readFileSync(
    join(
      pipelineRoot,
      'conformance/fixtures/operating-runtime-v2/live-evidence-contracts-valid.json',
    ),
    'utf8',
  ),
) as Record<string, Record<string, unknown>>;

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-live-evidence-custody-'));
  temporaryRoots.push(root);
  return realpathSync(root);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const hash = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}` as `sha256:${string}`;

function selfHash(record: Record<string, unknown>, field: string): Record<string, unknown> {
  const body = structuredClone(record);
  delete body[field];
  return { ...body, [field]: sha256CanonicalJson(body) };
}

function consent(queryHash = hash('6')): Record<string, unknown> {
  const record = structuredClone(liveFixture['operating-live-evidence-consent-record']);
  const docket = record.docket as Record<string, unknown>;
  docket.queryHash = queryHash;
  record.queryHash = queryHash;
  record.docketHash = sha256CanonicalJson(docket);
  return selfHash(record, 'consentHash');
}

function capabilityBinding(
  record: Record<string, unknown>,
): ConnectorCredentialCapabilityBindingV2 {
  const actor = record.actor as Record<string, unknown>;
  const provider = record.provider as Record<string, unknown>;
  return {
    actorId: String(actor.actorId),
    credentialRef: 'reference-live-credential',
    requestHash: hash('9'),
    consentRecordId: String(record.consentRecordId),
    protocolDocketHash: String(record.docketHash) as `sha256:${string}`,
    provider: { id: String(provider.id), version: String(provider.version) },
    adapterVersion: String(record.adapterVersion),
    accountIdentityHash: String(record.accountIdentityHash) as `sha256:${string}`,
  };
}

function credentialCustody(input: {
  store: Map<string, unknown>;
  confirmOwner: (docket: Readonly<Record<string, unknown>>) => Promise<{
    approved: boolean;
    actorId: string;
  }>;
  entropyByte: number;
  onEnvironmentRead?: () => void;
  source?: ConnectorCredentialSourceV2;
  readKeychain?: (service: string, account: string) => Promise<string | Uint8Array | undefined>;
}) {
  return createConnectorCredentialCustodyV2({
    contracts: pipeline,
    bindings: [
      {
        credentialRef: 'reference-live-credential',
        provider: { id: 'reference-live-provider', version: '1.0.0' },
        adapterVersion: '1.0.0',
        accountIdentityHash: hash('5'),
        source: input.source ?? {
          kind: 'environment-name',
          name: 'OPENPLANR_TEST_LIVE_EVIDENCE_KEY',
        },
      },
    ],
    allowedEnvironmentNames: ['OPENPLANR_TEST_LIVE_EVIDENCE_KEY'],
    loadConsentRecord: async (consentRecordId) => input.store.get(consentRecordId) ?? null,
    persistConsentRecord: async (record) => {
      input.store.set(String(record.consentRecordId), structuredClone(record));
      return record;
    },
    confirmOwner: async (docket) => input.confirmOwner(docket),
    readEnvironment: () => {
      input.onEnvironmentRead?.();
      return 'synthetic-credential-value';
    },
    readKeychain: input.readKeychain,
    now: () => Date.parse('2026-08-24T12:00:00.000Z'),
    entropy: () => new Uint8Array(32).fill(input.entropyByte),
  });
}

function preparedCheckpoint(): Record<string, unknown> {
  const checkpoint = structuredClone(liveFixture['operating-connector-checkpoint']);
  Object.assign(checkpoint, {
    generation: 0,
    lastEventId: null,
    lastEventHash: null,
    state: 'prepared',
    consentRecordId: null,
    consentRecordHash: null,
    consentExpiresAt: null,
    runtimeCapabilityHash: null,
    predecessorDigest: null,
    watermarkDigest: null,
    artifactId: null,
    artifactHash: null,
    absenceDigest: null,
    createdAt: '2026-08-24T10:00:00.000Z',
    updatedAt: '2026-08-24T10:00:00.000Z',
  });
  return selfHash(checkpoint, 'checkpointHash');
}

function connectorEvent(input: {
  eventId: string;
  type: string;
  checkpoint: Record<string, unknown>;
  at: string;
  patch: Record<string, unknown>;
}): Record<string, unknown> {
  const body = {
    eventId: input.eventId,
    type: input.type,
    expectedGeneration: input.checkpoint.generation,
    expectedCheckpointHash: input.checkpoint.checkpointHash,
    at: input.at,
    patch: input.patch,
  };
  return { ...body, eventHash: sha256CanonicalJson(body) };
}

describe('live-evidence credential custody', () => {
  it('confirms and persists a new grant before resolving one zeroed one-shot credential', async () => {
    const proposed = consent();
    const binding = capabilityBinding(proposed);
    const store = new Map<string, unknown>();
    let environmentReads = 0;
    let confirmationDocket: Readonly<Record<string, unknown>> | undefined;
    const custody = credentialCustody({
      store,
      entropyByte: 1,
      onEnvironmentRead: () => {
        environmentReads += 1;
      },
      confirmOwner: async (docket) => {
        confirmationDocket = docket;
        return { approved: true, actorId: binding.actorId };
      },
    });

    await expect(custody.issueCapability({ binding })).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_OWNER_CONFIRMATION_REQUIRED',
    } satisfies Partial<ConnectorCredentialCustodyError>);
    expect(environmentReads).toBe(0);

    const ownerConfirmation = await custody.issueOwnerConfirmation({
      binding,
      proposedConsentRecord: proposed,
    });
    expect(environmentReads).toBe(0);
    expect(confirmationDocket).toMatchObject({
      logicalCredentialRef: binding.credentialRef,
      protocolDocket: proposed.docket,
      protocolDocketHash: proposed.docketHash,
      choices: ['approve', 'cancel'],
      defaultChoice: null,
      cancelEffect: 'none',
    });
    expect(Object.isFrozen(confirmationDocket?.protocolDocket)).toBe(true);
    expect(() => JSON.stringify(ownerConfirmation)).toThrow('cannot be serialized');

    const capability = await custody.issueCapability({ binding, ownerConfirmation });
    expect(custody.capabilityHash(capability)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(await custody.validatedConsent(binding)).toEqual(proposed);
    let observed: Uint8Array | undefined;
    const result = await custody.withResolvedCredential(capability, binding, async (credential) => {
      observed = credential;
      expect(Buffer.from(credential).toString('utf8')).toBe('synthetic-credential-value');
      return 'bounded-result';
    });
    expect(result).toBe('bounded-result');
    expect(observed && [...observed].every((value) => value === 0)).toBe(true);
    expect(environmentReads).toBe(1);
    await expect(
      custody.withResolvedCredential(capability, binding, async () => undefined),
    ).rejects.toMatchObject({ code: 'LIVE_EVIDENCE_CAPABILITY_REPLAYED' });
  });

  it('reuses an exact current stored grant across process custody while changed dockets re-confirm', async () => {
    const original = consent();
    const originalBinding = capabilityBinding(original);
    const store = new Map([[String(original.consentRecordId), structuredClone(original)]]);
    const first = credentialCustody({
      store,
      entropyByte: 2,
      confirmOwner: async () => {
        throw new Error('Exact current grant must not prompt.');
      },
    });
    const firstCapability = await first.issueCapability({ binding: originalBinding });
    const { requestHash: _firstRequestHash, ...protocolBinding } = originalBinding;
    const stableBindingHash = await first.protocolBindingHash(protocolBinding);
    expect(
      await first.protocolBindingHash({
        ...protocolBinding,
      }),
    ).toBe(stableBindingHash);

    const restarted = credentialCustody({
      store,
      entropyByte: 3,
      confirmOwner: async () => {
        throw new Error('Restart replay must not prompt.');
      },
    });
    const restartedCapability = await restarted.issueCapability({ binding: originalBinding });
    expect(await restarted.protocolBindingHash(protocolBinding)).toBe(stableBindingHash);
    expect(restarted.capabilityHash(restartedCapability)).not.toBe(
      first.capabilityHash(firstCapability),
    );

    const changed = consent(hash('7'));
    const changedBinding = capabilityBinding(changed);
    await expect(restarted.issueCapability({ binding: changedBinding })).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_OWNER_CONFIRMATION_REQUIRED',
    });
    const changing = credentialCustody({
      store,
      entropyByte: 4,
      confirmOwner: async (docket) => ({
        approved: docket.protocolDocketHash === changed.docketHash,
        actorId: changedBinding.actorId,
      }),
    });
    const confirmation = await changing.issueOwnerConfirmation({
      binding: changedBinding,
      proposedConsentRecord: changed,
    });
    await changing.issueCapability({ binding: changedBinding, ownerConfirmation: confirmation });
    expect(store.get(String(changed.consentRecordId))).toEqual(changed);
  });

  it('wipes credential bytes, surfaces source failures, and keeps selectors out of errors', async () => {
    const record = consent();
    const binding = capabilityBinding(record);
    const store = new Map([[String(record.consentRecordId), record]]);
    const custody = credentialCustody({
      store,
      entropyByte: 5,
      confirmOwner: async () => {
        throw new Error('Stored grant should not prompt.');
      },
    });
    const capability = await custody.issueCapability({ binding });
    let observed: Uint8Array | undefined;
    await expect(
      custody.withResolvedCredential(capability, binding, async (credential) => {
        observed = credential;
        throw new Error('synthetic provider failure');
      }),
    ).rejects.toThrow('synthetic provider failure');
    expect(observed && [...observed].every((value) => value === 0)).toBe(true);

    const foreign = { ...binding, actorId: 'foreign.actor' };
    try {
      await custody.issueCapability({ binding: foreign });
      throw new Error('Expected foreign consent to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'LIVE_EVIDENCE_OWNER_CONFIRMATION_REQUIRED' });
      expect((error as Error).message).not.toContain('OPENPLANR_TEST_LIVE_EVIDENCE_KEY');
      expect((error as Error).message).not.toContain('synthetic-credential-value');
    }

    const keyringRecord = consent();
    const keyringBinding = capabilityBinding(keyringRecord);
    const keyringStore = new Map([[String(keyringRecord.consentRecordId), keyringRecord]]);
    const keyringSource = {
      kind: 'os-custody-key',
      service: 'private.service.selector',
      account: 'private.account.selector',
    } as const;
    const resolvedError = async (
      readKeychain?: (service: string, account: string) => Promise<string | undefined>,
    ): Promise<ConnectorCredentialCustodyError> => {
      const custody = credentialCustody({
        store: keyringStore,
        entropyByte: 6,
        source: keyringSource,
        readKeychain,
        confirmOwner: async () => {
          throw new Error('Stored grant should not prompt.');
        },
      });
      const capability = await custody.issueCapability({ binding: keyringBinding });
      try {
        await custody.withResolvedCredential(capability, keyringBinding, async () => 'unused');
      } catch (error) {
        if (error instanceof ConnectorCredentialCustodyError) return error;
        throw error;
      }
      throw new Error('Expected credential resolution to fail.');
    };

    const unavailable = await resolvedError();
    expect(unavailable).toMatchObject({
      code: 'LIVE_EVIDENCE_CREDENTIAL_CUSTODY_UNAVAILABLE',
      sourceCode: 'LIVE_EVIDENCE_KEYRING_UNAVAILABLE',
    });
    expect(unavailable.cause).toBeUndefined();

    const denied = await resolvedError(async () => {
      throw new Error(
        'Read denied for private.service.selector/private.account.selector at /sensitive/keyring.',
      );
    });
    expect(denied).toMatchObject({
      code: 'LIVE_EVIDENCE_CREDENTIAL_READ_FAILED',
      sourceCode: 'LIVE_EVIDENCE_KEYRING_READ_FAILED',
    });
    expect(denied.cause).toBeUndefined();

    const absent = await resolvedError(async () => undefined);
    expect(absent).toMatchObject({ code: 'LIVE_EVIDENCE_CREDENTIAL_UNAVAILABLE' });
    expect(absent.cause).toBeUndefined();

    for (const error of [unavailable, denied, absent]) {
      expect(error.message).toContain(keyringBinding.credentialRef);
      for (const privateValue of [keyringSource.service, keyringSource.account, '/sensitive/']) {
        expect(error.message).not.toContain(privateValue);
        expect(JSON.stringify(error)).not.toContain(privateValue);
      }
    }
  });
});

describe('live-evidence checkpoint custody', () => {
  it('persists exact replay, local cursor/freshness, and refuses divergent request or replay bytes', async () => {
    const root = temporaryRoot();
    const custody = createConnectorCheckpointCustodyV2({ root, contracts: pipeline });
    const prepared = preparedCheckpoint();
    const initial = await custody.initialize(prepared);
    expect(initial.checkpoint).toEqual(prepared);
    expect(initial.evidence).toBeNull();

    const request = connectorEvent({
      eventId: 'lcev_request0001',
      type: 'request',
      checkpoint: prepared,
      at: '2026-08-24T10:00:01.000Z',
      patch: {
        consentRecordId: 'lcon_reference0001',
        consentRecordHash: hash('8'),
        consentExpiresAt: '2026-08-25T00:00:00.000Z',
        runtimeCapabilityHash: hash('b'),
        health: {
          status: 'available',
          checkedAt: '2026-08-24T10:00:00.000Z',
          freshUntil: '2026-08-24T10:05:00.000Z',
          proofDigest: hash('3'),
        },
      },
    });
    const requesting = await custody.transition({
      checkpointId: String(prepared.checkpointId),
      event: request,
    });
    expect(requesting.checkpoint.state).toBe('requesting');

    const cursor = Buffer.from('opaque-local-cursor');
    const evidenceBytes = Buffer.from('{"kind":"redacted","records":[{"status":"healthy"}]}');
    const materialize = connectorEvent({
      eventId: 'lcev_materialize0001',
      type: 'materialize',
      checkpoint: requesting.checkpoint as Record<string, unknown>,
      at: '2026-08-24T10:00:02.000Z',
      patch: {
        artifactId: 'art_reference0001',
        artifactHash: hash('4'),
        watermarkDigest: `sha256:${createHash('sha256').update(cursor).digest('hex')}`,
        health: {
          status: 'available',
          checkedAt: '2026-08-24T10:00:01.000Z',
          freshUntil: '2026-08-24T10:05:01.000Z',
          proofDigest: hash('5'),
        },
      },
    });
    const materialized = await custody.transition({
      checkpointId: String(prepared.checkpointId),
      event: materialize,
      evidenceBytes,
      evidenceFreshness: {
        capturedAt: '2026-08-24T10:00:02.000Z',
        freshUntil: '2026-08-24T10:05:02.000Z',
      },
      providerCursor: cursor,
    });
    expect(materialized.checkpoint.state).toBe('materialized');
    expect(materialized.checkpointHistory.map(({ state }) => state)).toEqual([
      'prepared',
      'requesting',
    ]);
    await expect(custody.readByIdentity(String(prepared.checkpointId))).resolves.toMatchObject({
      checkpoint: { checkpointId: prepared.checkpointId },
    });
    await expect(custody.readByIdentity(String(prepared.requestId))).resolves.toMatchObject({
      checkpoint: { checkpointId: prepared.checkpointId, requestId: prepared.requestId },
    });
    expect(Buffer.from(materialized.evidence?.bytes ?? []).toString('utf8')).toContain('redacted');
    expect(materialized).not.toHaveProperty('providerCursor');

    materialized.evidence?.bytes.fill(0);
    const read = await custody.read({
      checkpointId: String(prepared.checkpointId),
      requestHash: String(prepared.requestHash) as `sha256:${string}`,
    });
    expect(read.checkpointHistory[1]).toEqual(requesting.checkpoint);
    expect(Buffer.from(read.evidence?.bytes ?? []).toString('utf8')).toContain('redacted');

    const replay = await custody.transition({
      checkpointId: String(prepared.checkpointId),
      event: materialize,
      evidenceBytes,
      providerCursor: cursor,
    });
    expect(replay.checkpoint).toEqual(materialized.checkpoint);
    await expect(
      custody.transition({
        checkpointId: String(prepared.checkpointId),
        event: materialize,
        evidenceBytes: Buffer.from('{"kind":"changed"}'),
        providerCursor: cursor,
      }),
    ).rejects.toMatchObject({ code: 'LIVE_EVIDENCE_CHECKPOINT_CONFLICT' });

    await expect(
      custody.initialize(selfHash({ ...prepared, requestHash: hash('0') }, 'checkpointHash')),
    ).rejects.toMatchObject({ code: 'LIVE_EVIDENCE_CHECKPOINT_CONFLICT' });
  });

  it('recovers an expired nonce lock, rejects a live lock, and refuses indirect roots', async () => {
    const checkpoint = preparedCheckpoint();
    const checkpointId = String(checkpoint.checkpointId);
    const fileId = createHash('sha256').update(checkpointId, 'utf8').digest('hex');
    const root = temporaryRoot();
    writeFileSync(
      join(root, `${fileId}.lock`),
      JSON.stringify({ nonce: 'expired-owner', expiresAt: 1 }),
      { mode: 0o600 },
    );
    const custody = createConnectorCheckpointCustodyV2({
      root,
      contracts: pipeline,
      now: () => 2_000,
      lockTtlMs: 1_000,
    });
    await expect(custody.initialize(checkpoint)).resolves.toMatchObject({
      checkpoint: { checkpointId },
    });

    const liveRoot = temporaryRoot();
    writeFileSync(
      join(liveRoot, `${fileId}.lock`),
      JSON.stringify({ nonce: 'live-owner', expiresAt: 3_000 }),
      { mode: 0o600 },
    );
    const contending = createConnectorCheckpointCustodyV2({
      root: liveRoot,
      contracts: pipeline,
      now: () => 2_000,
      lockTtlMs: 1_000,
    });
    await expect(contending.initialize(checkpoint)).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_CHECKPOINT_LOCKED',
    } satisfies Partial<ConnectorCheckpointCustodyError>);

    const target = temporaryRoot();
    const linked = join(temporaryRoot(), 'linked-custody');
    symlinkSync(target, linked, 'dir');
    const indirect = createConnectorCheckpointCustodyV2({ root: linked, contracts: pipeline });
    await expect(indirect.initialize(checkpoint)).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE',
    });
  });

  it('fails closed for unknown, duplicate, path-like, or symlinked status identities', async () => {
    const root = temporaryRoot();
    const custody = createConnectorCheckpointCustodyV2({ root, contracts: pipeline });
    await expect(custody.readByIdentity('lreq_unknown0001')).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND',
    });
    await expect(custody.readByIdentity('lchk_unknown0001')).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_CHECKPOINT_NOT_FOUND',
    });
    await expect(custody.readByIdentity('/private/tmp/foreign')).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_INVALID',
    });

    const first = preparedCheckpoint();
    const second = selfHash({ ...first, checkpointId: 'lchk_reference0002' }, 'checkpointHash');
    await custody.initialize(first);
    await custody.initialize(second);
    await expect(custody.readByIdentity(String(first.requestId))).rejects.toMatchObject({
      code: 'LIVE_EVIDENCE_CHECKPOINT_CONFLICT',
    });

    const targetRoot = temporaryRoot();
    const target = join(targetRoot, 'foreign.json');
    writeFileSync(target, '{}', { mode: 0o600 });
    symlinkSync(target, join(root, `${'f'.repeat(64)}.checkpoint.json`));
    try {
      await custody.readByIdentity('lreq_unknown0002');
      throw new Error('Expected symlinked custody inventory to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'LIVE_EVIDENCE_CHECKPOINT_CUSTODY_UNSAFE' });
      expect((error as Error).message).not.toContain(target);
      expect((error as Error).message).not.toContain(root);
    }
  });
});
