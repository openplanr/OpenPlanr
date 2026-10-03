import { lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import {
  commitLiveReviewRoom,
  exportLiveRoomRecoveryBundle,
  importLiveRoomRecoveryBundle,
  prepareLiveReviewRoom,
} from '@openplanr/artifact/live-room.mjs';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import {
  ROOM_V3_CAPABILITIES,
  ROOM_V3_GENESIS_HASH,
} from '@openplanr/protocol/sharing-security-contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ArtifactPipelineApi,
  createLiveReviewRoomWithSecretCustody,
  readArtifactSecretInput,
  verifyLiveRoomRecoveryCustody,
} from '../../src/services/artifact-pipeline-service.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temporary() {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-room-v3-custody-'));
  dirs.push(dir);
  return dir;
}
const envelope = createArtifactEnvelope({
  artifacts: [{ id: 'one', title: 'Confidential', html: '<h1>Private room</h1>' }],
});
describe('room v3 CLI durable custody', () => {
  it('saves exact opaque v3 preparation before remote mutation and retries a lost response once', async () => {
    const output = join(temporary(), 'room.secret.json');
    let request: string | undefined;
    let count = 0;
    let descriptor: Record<string, unknown> | undefined;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      const stored = JSON.parse(readFileSync(output, 'utf8'));
      expect(lstatSync(output).mode & 0o777).toBe(0o600);
      expect(stored.schemaVersion).toBe('2.0.0');
      expect(canonicalizeJson(stored.body)).toBe(init.body);
      if (request) expect(init.body).toBe(request);
      request = String(init.body);
      count++;
      if (count === 1) throw new Error('lost response');
      const body = stored.body;
      descriptor = {
        schemaVersion: '3.0.0',
        protocolVersion: '3.0.0',
        roomId: body.roomId,
        reviewCommitment: body.reviewCommitment,
        ownerKey: body.ownerKey,
        capabilities: ROOM_V3_CAPABILITIES,
        createdAt: new Date().toISOString(),
      };
      return Response.json({
        id: body.roomId,
        descriptor,
        generation: 0,
        head: ROOM_V3_GENESIS_HASH,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
    };
    const api = {
      prepareLiveReviewRoom,
      exportLiveRoomRecoveryBundle,
      importLiveRoomRecoveryBundle,
      commitLiveReviewRoom: (prepared: unknown) => commitLiveReviewRoom(prepared, { fetchImpl }),
    } as unknown as ArtifactPipelineApi;
    const result = await createLiveReviewRoomWithSecretCustody({
      api,
      envelope: envelope as never,
      output,
      baseUrl: 'https://share.openplanr.dev',
      ttl: '7d',
    });
    expect(count).toBe(2);
    const projected = readArtifactSecretInput(output);
    expect(projected.reviewUrl).toBe(result.url);
    expect(projected.reviewUrl).toContain('&r=');
    expect(projected.recovery?.schemaVersion).toBe('2.0.0');
    expect(JSON.stringify(projected)).not.toContain('inputDigest');
    const recovery = projected.recovery;
    if (!recovery) throw new Error('Expected durable room recovery custody.');
    await expect(
      verifyLiveRoomRecoveryCustody(api, projected, { descriptor, reviewOf: recovery.reviewOf }),
    ).resolves.toBeUndefined();
    await expect(
      verifyLiveRoomRecoveryCustody(api, projected, {
        descriptor: { ...descriptor, reviewCommitment: '0'.repeat(64) },
        reviewOf: recovery.reviewOf,
      }),
    ).rejects.toMatchObject({ code: 'E_ARTIFACT_SECRET_INPUT' });
  });
  it('rejects a recovery with extra authority or altered signed bytes before application', async () => {
    const output = join(temporary(), 'room.secret.json');
    const prepared = await prepareLiveReviewRoom(envelope),
      recovery = await exportLiveRoomRecoveryBundle(prepared);
    writeFileSync(output, JSON.stringify({ ...recovery, foreignAuthority: 'x' }), { mode: 0o600 });
    expect(() => readArtifactSecretInput(output)).toThrow(/unsupported v3 recovery/);
    await expect(
      importLiveRoomRecoveryBundle({ ...recovery, foreignAuthority: 'x' }),
    ).rejects.toThrow(/invalid/);
  });
});
