import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactEnvelope } from '@openplanr/artifact/envelope.mjs';
import { createReviewLink, prepareArtifactPaste } from '@openplanr/artifact/share-client.mjs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type ArtifactPipelineApi,
  artifactPasteCustodyRoot,
  createArtifactReviewLinkWithSecretCustody,
  readArtifactSecretInput,
  readPreparedArtifactPasteRecovery,
} from '../../src/services/artifact-pipeline-service.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temporary() {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-paste-custody-'));
  dirs.push(dir);
  return dir;
}
const envelope = createArtifactEnvelope({
  artifacts: [{ id: 'home', title: 'Private', html: '<h1>Private prototype</h1>' }],
});
describe('paste v2 private CLI custody', () => {
  it('writes default and explicit exact custody before mutation, then retries a lost receipt without new secrets', async () => {
    const root = temporary(),
      output = join(root, 'explicit.json'),
      custodyRoot = join(root, 'pastes');
    let first = true,
      exact: string | undefined,
      count = 0;
    const api = {
      createReviewLink: (value: unknown, options: Record<string, unknown>) =>
        createReviewLink(value, {
          ...options,
          fetchImpl: async (_url: string, init: RequestInit) => {
            count++;
            const file = join(custodyRoot, readdirSync(custodyRoot)[0]);
            const saved = JSON.parse(readFileSync(file, 'utf8'));
            expect(lstatSync(file).mode & 0o777).toBe(0o600);
            expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(saved);
            expect(init.headers).toMatchObject({ 'x-openplanr-paste-custody': saved.custodyToken });
            if (exact) expect(init.body).toBe(exact);
            exact = String(init.body);
            expect(JSON.parse(exact)).toEqual(saved.body);
            if (first) {
              first = false;
              throw new Error('receipt lost');
            }
            return Response.json({
              schemaVersion: '2.0.0',
              operation: 'created',
              id: saved.body.id,
              creationId: saved.body.creationId,
              deletionToken: saved.custodyToken,
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            });
          },
        }),
    } as unknown as ArtifactPipelineApi;
    const result = await createArtifactReviewLinkWithSecretCustody({
      api,
      envelope: envelope as never,
      output,
      custodyRoot,
      options: { short: true, yes: true },
    });
    expect(count).toBe(2);
    expect(readArtifactSecretInput(output).reviewUrl).toBe(result.url);
    const savedBytes = readFileSync(output);
    await createArtifactReviewLinkWithSecretCustody({
      api,
      envelope: envelope as never,
      resume: output,
      options: { yes: true },
    });
    expect(count).toBe(3);
    expect(readFileSync(output)).toEqual(savedBytes);
    expect(readdirSync(custodyRoot)).toHaveLength(1);
  });
  it('blocks unsafe storage and malformed or symlink recovery before network', async () => {
    const root = temporary(),
      custodyRoot = join(root, 'unsafe');
    let called = false;
    const api = {
      createReviewLink: (value: unknown, options: Record<string, unknown>) =>
        createReviewLink(value, {
          ...options,
          pasteClient: {
            create: async () => {
              called = true;
            },
          },
        }),
    } as unknown as ArtifactPipelineApi;
    const file = join(root, 'bad.json');
    writeFileSync(
      file,
      JSON.stringify({ kind: 'openplanr-artifact-paste-preparation', token: 'private-invalid' }),
      { mode: 0o600 },
    );
    await expect(
      createArtifactReviewLinkWithSecretCustody({
        api,
        envelope: envelope as never,
        resume: file,
        options: { yes: true },
      }),
    ).rejects.toMatchObject({ code: 'E_ARTIFACT_SECRET_INPUT' });
    expect(called).toBe(false);
    const prepared = await prepareArtifactPaste(envelope);
    writeFileSync(file, JSON.stringify(prepared));
    const link = join(root, 'link.json');
    symlinkSync(file, link);
    expect(() => readPreparedArtifactPasteRecovery(link)).toThrow(/owned private/);
    chmodSync(file, 0o644);
    expect(() => readPreparedArtifactPasteRecovery(file)).toThrow(/owned private/);
    writeFileSync(join(root, 'collision'), '', { mode: 0o600 });
    await expect(
      createArtifactReviewLinkWithSecretCustody({
        api,
        envelope: envelope as never,
        custodyRoot: join(root, 'collision'),
        options: { short: true, yes: true },
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });
  it('resolves canonical state home and explicit custody root overrides', () => {
    expect(artifactPasteCustodyRoot({ PLANR_HOME: '/private/tmp/planr-test-state' })).toBe(
      '/private/tmp/planr-test-state/artifact-pastes',
    );
    expect(
      artifactPasteCustodyRoot({ PLANR_ARTIFACT_PASTE_CUSTODY_ROOT: '/private/tmp/explicit' }),
    ).toBe('/private/tmp/explicit');
  });
});
