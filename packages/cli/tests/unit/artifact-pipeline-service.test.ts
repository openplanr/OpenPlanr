import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createArtifactEnvelope,
  exportLiveRoomRecoveryBundle,
  importLiveRoomRecoveryBundle,
  prepareLiveReviewRoom,
} from 'planr-pipeline';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ArtifactPipelineApi,
  type ArtifactSecretBundle,
  createLiveReviewRoomWithSecretCustody,
  openArtifactSecretUrl,
  openExternalUrl,
  readArtifactSecretInput,
  reserveArtifactSecretExport,
  verifyLiveRoomRecoveryCustody,
  writeArtifactSecretExport,
} from '../../src/services/artifact-pipeline-service.js';

const tempDirs: string[] = [];
const secret: ArtifactSecretBundle = {
  schemaVersion: '1.0.0',
  kind: 'openplanr-artifact-share-secrets',
  transport: 'live-room',
  reviewUrl: `https://share.openplanr.dev/r/${'a'.repeat(16)}#k=${'A'.repeat(43)}&w=${'B'.repeat(43)}`,
  ownerUrl: `https://share.openplanr.dev/r/${'a'.repeat(16)}#k=${'A'.repeat(43)}&o=${'C'.repeat(43)}`,
  manageUrl: `https://share.openplanr.dev/r/${'a'.repeat(16)}#k=${'A'.repeat(43)}&m=${'D'.repeat(43)}`,
  ownerSigner: { schemaVersion: '1.0.0', privateKey: 'private' },
};

function liveEnvelope() {
  return createArtifactEnvelope({
    artifacts: [{ id: 'artifact', title: 'Artifact', html: '<p>private review</p>' }],
  });
}

function liveApi(commitLiveReviewRoom: ArtifactPipelineApi['commitLiveReviewRoom']) {
  return {
    prepareLiveReviewRoom,
    exportLiveRoomRecoveryBundle,
    importLiveRoomRecoveryBundle,
    commitLiveReviewRoom,
  } as unknown as ArtifactPipelineApi;
}

function temporary(): string {
  const value = mkdtempSync(join(tmpdir(), 'openplanr-artifact-secret-'));
  tempDirs.push(value);
  return value;
}

afterEach(() => {
  for (const value of tempDirs.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('artifact secret custody', () => {
  it('keeps a reserved sink unreadable until same-descriptor finalization', () => {
    const dir = temporary();
    const file = join(dir, 'room.secret.json');
    const reservation = reserveArtifactSecretExport(file);
    expect(lstatSync(file).mode & 0o777).toBe(0o000);
    reservation.finalize(secret);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(readArtifactSecretInput(file)).toEqual(secret);
    expect(readdirSync(dir)).toEqual(['room.secret.json']);
  });

  it('creates an exclusive 0600 file and reads through a no-follow descriptor', () => {
    const file = join(temporary(), 'room.secret.json');
    writeArtifactSecretExport(file, secret);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(readArtifactSecretInput(file)).toEqual(secret);
    expect(() => writeArtifactSecretExport(file, secret)).toThrowError(/created exclusively/u);
  });

  it('rejects symlinks and group/world-readable secret files', () => {
    const dir = temporary();
    const file = join(dir, 'room.secret.json');
    writeArtifactSecretExport(file, secret);
    chmodSync(file, 0o644);
    expect(() => readArtifactSecretInput(file)).toThrowError(/without group or world permissions/u);
    const link = join(dir, 'link.secret.json');
    symlinkSync(file, link);
    expect(() => readArtifactSecretInput(link)).toThrowError(/could not be read/u);
  });

  it('rejects insecure and credential-bearing browser URLs before spawning', async () => {
    await expect(openExternalUrl('http://example.test/review')).rejects.toMatchObject({
      code: 'E_ARTIFACT_BROWSER_OPEN_FAILED',
    });
    await expect(openExternalUrl('https://user:secret@example.test/review')).rejects.toMatchObject({
      code: 'E_ARTIFACT_BROWSER_OPEN_FAILED',
    });
    await expect(openExternalUrl('file:///tmp/review')).rejects.toMatchObject({
      code: 'E_ARTIFACT_BROWSER_OPEN_FAILED',
    });
  });

  it('uses an opaque loopback handoff with strict Host/Origin and no-store responses', async () => {
    let handoff = '';
    await openArtifactSecretUrl(secret.reviewUrl, {
      openUrl: async (value) => {
        handoff = value;
      },
    });
    expect(handoff).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/handoff\/[a-f0-9]{64}$/u);
    expect(handoff).not.toContain('#k=');
    const hostile = await fetch(handoff, {
      redirect: 'manual',
      headers: { origin: 'https://attacker.example' },
    });
    expect(hostile.status).toBe(404);
    expect(hostile.headers.get('cache-control')).toBe('no-store');
    expect(hostile.headers.get('referrer-policy')).toBe('no-referrer');
    const accepted = await fetch(handoff, { redirect: 'manual' });
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get('location')).toBe(secret.reviewUrl);
    expect(accepted.headers.get('cache-control')).toBe('no-store');
    expect(accepted.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects unknown secret-envelope fields and non-loopback HTTP before network use', () => {
    const dir = temporary();
    const insecure = join(dir, 'insecure.json');
    writeFileSync(
      insecure,
      JSON.stringify({ ...secret, reviewUrl: 'http://example.test/r/room', injected: true }),
      { mode: 0o600 },
    );
    expect(() => readArtifactSecretInput(insecure)).toThrowError(/unsupported shape/u);
  });

  it('makes exact recovery custody durable before dispatch and reuses one preparation after a lost response', async () => {
    const dir = temporary();
    const output = join(dir, 'room.secret.json');
    let firstPrepared: unknown;
    const remote = vi.fn(async (prepared: Record<string, unknown>) => {
      expect(lstatSync(output).mode & 0o777).toBe(0o600);
      const durable = JSON.parse(readFileSync(output, 'utf8')) as Record<string, unknown>;
      expect(durable).toMatchObject({
        kind: 'openplanr-live-room-recovery',
        roomId: prepared.roomId,
        reviewOf: prepared.reviewOf,
        url: expect.stringContaining(`/r/${String(prepared.roomId)}#`),
        ownerUrl: expect.stringContaining('&o='),
        manageUrl: expect.stringContaining('&m='),
        ownerSigner: expect.objectContaining({ kind: 'openplanr-live-room-signer' }),
      });
      expect(durable).not.toHaveProperty('ciphertext');
      expect(durable).not.toHaveProperty('creationId');
      if (!firstPrepared) {
        firstPrepared = prepared;
        throw Object.assign(new Error('response lost'), {
          code: 'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS',
          details: { effect: 'ambiguous', roomId: prepared.roomId },
        });
      }
      expect(prepared).toBe(firstPrepared);
      const recovery = await exportLiveRoomRecoveryBundle(prepared);
      return {
        id: String(prepared.roomId),
        reviewOf: String(prepared.reviewOf),
        expiresAt: '2026-08-30T00:00:00.000Z',
        url: recovery.url,
        ownerUrl: recovery.ownerUrl,
        manageUrl: recovery.manageUrl,
        descriptor: { roomId: prepared.roomId, reviewOf: prepared.reviewOf },
        generation: 0,
        head: `sha256:${'0'.repeat(64)}`,
        ownerSigner: prepared.ownerSigner,
      };
    });

    const result = await createLiveReviewRoomWithSecretCustody({
      api: liveApi(remote),
      envelope: liveEnvelope() as never,
      output,
      baseUrl: 'https://share.openplanr.dev',
      ttl: '7d',
    });

    expect(remote).toHaveBeenCalledTimes(2);
    expect(result.id).toBe((firstPrepared as { roomId: string }).roomId);
    expect(lstatSync(output).mode & 0o777).toBe(0o600);
    const projected = readArtifactSecretInput(output);
    expect(projected.reviewUrl).toBe(result.url);
    expect(projected.ownerUrl).toBe(result.ownerUrl);
    expect(projected.manageUrl).toBe(result.manageUrl);
    expect(projected.recovery?.kind).toBe('openplanr-live-room-recovery');
  });

  it('never dispatches when sink reservation, preparation, or recovery export fails', async () => {
    const dir = temporary();
    const existing = join(dir, 'existing.secret.json');
    writeFileSync(existing, 'owner bytes', { mode: 0o600 });
    const remote = vi.fn();
    const prepare = vi.fn(prepareLiveReviewRoom);
    const api = liveApi(remote);
    api.prepareLiveReviewRoom = prepare as never;

    await expect(
      createLiveReviewRoomWithSecretCustody({
        api,
        envelope: liveEnvelope() as never,
        output: existing,
        baseUrl: 'https://share.openplanr.dev',
        ttl: '7d',
      }),
    ).rejects.toMatchObject({ code: 'E_ARTIFACT_SECRET_EXPORT' });
    expect(remote).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(readFileSync(existing, 'utf8')).toBe('owner bytes');

    const failedPrepare = join(dir, 'failed-prepare.secret.json');
    api.prepareLiveReviewRoom = vi.fn(async () => {
      throw new Error('local preparation failed');
    });
    await expect(
      createLiveReviewRoomWithSecretCustody({
        api,
        envelope: liveEnvelope() as never,
        output: failedPrepare,
        baseUrl: 'https://share.openplanr.dev',
        ttl: '7d',
      }),
    ).rejects.toThrowError('local preparation failed');
    expect(remote).not.toHaveBeenCalled();
    expect(existsSync(failedPrepare)).toBe(false);

    const failedExport = join(dir, 'failed-export.secret.json');
    api.prepareLiveReviewRoom = prepareLiveReviewRoom;
    api.exportLiveRoomRecoveryBundle = vi.fn(async () => {
      throw new Error('local export failed');
    });
    await expect(
      createLiveReviewRoomWithSecretCustody({
        api,
        envelope: liveEnvelope() as never,
        output: failedExport,
        baseUrl: 'https://share.openplanr.dev',
        ttl: '7d',
      }),
    ).rejects.toThrowError('local export failed');
    expect(remote).not.toHaveBeenCalled();
    expect(existsSync(failedExport)).toBe(false);
  });

  it('rejects mismatched or unbounded owner recovery before dispatch with a safe error', async () => {
    const dir = temporary();
    const remote = vi.fn();
    const api = liveApi(remote);
    api.exportLiveRoomRecoveryBundle = vi.fn(async (prepared) => {
      const recovery = await exportLiveRoomRecoveryBundle(prepared);
      return {
        ...recovery,
        ownerSigner: { ...recovery.ownerSigner, keyId: `sha256:${'f'.repeat(64)}` },
      };
    });
    const mismatched = join(dir, 'mismatched.secret.json');

    const error = (await createLiveReviewRoomWithSecretCustody({
      api,
      envelope: liveEnvelope() as never,
      output: mismatched,
      baseUrl: 'https://share.openplanr.dev',
      ttl: '7d',
    }).catch((value: unknown) => value)) as {
      code: string;
      toJSON(): Record<string, unknown>;
    };

    expect(error).toMatchObject({ code: 'E_ARTIFACT_SECRET_EXPORT' });
    expect(JSON.stringify(error.toJSON())).not.toContain(dir);
    expect(remote).not.toHaveBeenCalled();
    expect(existsSync(mismatched)).toBe(false);

    api.exportLiveRoomRecoveryBundle = vi.fn(async (prepared) => {
      const recovery = await exportLiveRoomRecoveryBundle(prepared);
      return {
        ...recovery,
        ownerSigner: { ...recovery.ownerSigner, privateKey: 'x'.repeat(1024 * 1024) },
      };
    });
    const oversized = join(dir, 'oversized.secret.json');
    await expect(
      createLiveReviewRoomWithSecretCustody({
        api,
        envelope: liveEnvelope() as never,
        output: oversized,
        baseUrl: 'https://share.openplanr.dev',
        ttl: '7d',
      }),
    ).rejects.toMatchObject({ code: 'E_ARTIFACT_SECRET_EXPORT' });
    expect(remote).not.toHaveBeenCalled();
    expect(existsSync(oversized)).toBe(false);
  });

  it('preserves ambiguous custody, revokes definite no-effect custody, and never deletes a substituted path', async () => {
    const dir = temporary();
    const ambiguousOutput = join(dir, 'ambiguous.secret.json');
    const ambiguous = vi.fn(async () => {
      throw Object.assign(new Error('network response lost'), {
        code: 'E_ARTIFACT_ROOM_CREATE_AMBIGUOUS',
        details: { effect: 'ambiguous' },
      });
    });
    const error = (await createLiveReviewRoomWithSecretCustody({
      api: liveApi(ambiguous),
      envelope: liveEnvelope() as never,
      output: ambiguousOutput,
      baseUrl: 'https://share.openplanr.dev',
      ttl: '7d',
    }).catch((value: unknown) => value)) as {
      code: string;
      toJSON(): Record<string, unknown>;
    };
    expect(ambiguous).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('E_ARTIFACT_ROOM_CREATE_AMBIGUOUS');
    expect(JSON.stringify(error.toJSON())).not.toContain(dir);
    expect(lstatSync(ambiguousOutput).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(ambiguousOutput, 'utf8'))).toMatchObject({
      kind: 'openplanr-live-room-recovery',
    });

    const rejectedOutput = join(dir, 'rejected.secret.json');
    const rejected = vi.fn(async () => {
      throw Object.assign(new Error('request rejected'), {
        code: 'E_ARTIFACT_ROOM_INVALID',
        details: { effect: 'none' },
      });
    });
    await expect(
      createLiveReviewRoomWithSecretCustody({
        api: liveApi(rejected),
        envelope: liveEnvelope() as never,
        output: rejectedOutput,
        baseUrl: 'https://share.openplanr.dev',
        ttl: '7d',
      }),
    ).rejects.toMatchObject({ code: 'E_ARTIFACT_ROOM_INVALID' });
    expect(rejected).toHaveBeenCalledOnce();
    expect(existsSync(rejectedOutput)).toBe(false);

    const target = join(dir, 'substituted.secret.json');
    const parked = join(dir, 'original.secret.json');
    const reservation = reserveArtifactSecretExport(target);
    reservation.finalize(secret);
    renameSync(target, parked);
    writeFileSync(target, 'replacement', { mode: 0o600 });
    expect(() => reservation.revoke()).toThrowError(/identity changed/u);
    expect(readFileSync(target, 'utf8')).toBe('replacement');
    expect(readArtifactSecretInput(parked)).toEqual(secret);
  });

  it('authenticates a recovery signer against the hydrated room descriptor', async () => {
    const prepared = await prepareLiveReviewRoom(liveEnvelope(), {
      baseUrl: 'https://share.openplanr.dev',
      ttl: '7d',
    });
    const recovery = await exportLiveRoomRecoveryBundle(prepared);
    const output = join(temporary(), 'recovery.secret.json');
    const reservation = reserveArtifactSecretExport(output);
    reservation.finalize(recovery);
    const projected = readArtifactSecretInput(output);
    const api = liveApi(vi.fn());
    const room = {
      reviewOf: recovery.reviewOf,
      descriptor: {
        roomId: recovery.roomId,
        reviewOf: recovery.reviewOf,
        ownerKey: recovery.ownerKey,
      },
    };
    await expect(verifyLiveRoomRecoveryCustody(api, projected, room)).resolves.toBeUndefined();
    await expect(
      verifyLiveRoomRecoveryCustody(api, projected, {
        ...room,
        descriptor: {
          ...room.descriptor,
          ownerKey: { ...room.descriptor.ownerKey, keyId: `sha256:${'f'.repeat(64)}` },
        },
      }),
    ).rejects.toMatchObject({ code: 'E_ARTIFACT_SECRET_INPUT' });

    const malformed = join(temporary(), 'malformed.recovery.json');
    writeFileSync(malformed, JSON.stringify({ ...recovery, injected: true }), { mode: 0o600 });
    expect(() => readArtifactSecretInput(malformed)).toThrowError(
      expect.objectContaining({ code: 'E_ARTIFACT_SECRET_INPUT' }),
    );
  });
});
