// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type LandingPackageHandoff,
  verifyLandingPackageHandoff,
} from '../../src/services/pipeline-package-service.js';
import { installPackedPipeline, type PackedPipelineInstall } from './helpers/installed-pipeline.js';

const bytesHash = (bytes: Buffer): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

let installed: PackedPipelineInstall;
let handoff: LandingPackageHandoff;
let archivePath: string;

// The packed install resolves the package's runtime dependencies from the consumer's
// node_modules; a bare tarball extraction cannot load the public entry at all.
beforeAll(async () => {
  installed = await installPackedPipeline();
  archivePath = installed.archivePath;
  handoff = Object.freeze({
    archiveDigest: installed.handoff.archiveDigest,
    packageRoot: installed.handoff.packageRoot,
    sourceInventoryDigest: installed.handoff.sourceInventoryDigest,
    landingManifestDigest: bytesHash(
      readFileSync(
        path.join(
          installed.handoff.packageRoot,
          'conformance',
          'fixtures',
          'landing-workflow',
          'generated-assets.json',
        ),
      ),
    ),
  });
}, 180_000);

afterAll(() => {
  installed?.cleanup();
});

describe('packed landing sandbox', () => {
  it('verifies the exact Package-B root, manifest, public APIs, and private-authority absence', async () => {
    const verified = await verifyLandingPackageHandoff(handoff, { archivePath });

    expect(verified.archiveVerification).toBe('verified');
    expect(verified.landingManifestDigest).toBe(handoff.landingManifestDigest);
    expect(verified.registryValues.workflowCatalog).toMatchObject({
      kind: 'landing-workflow-catalog',
      authority: 'none',
    });
    expect(verified.registryValues.operationRegistry).toMatchObject({
      kind: 'landing-operation-registry',
      authority: 'none',
    });
    expect(typeof verified.landingApi.createLandingOwnerRuntimeHost).toBe('function');
    expect(Object.hasOwn(verified.landingApi, 'createLandingTrustedRuntimeHost')).toBe(false);
    expect(verified.assets.hostAssets).toEqual([]);
    expect(JSON.stringify(verified)).not.toContain('createLandingTrustedRuntimeHost');
  });

  it('rejects manifest substitution and closed-shape extension', async () => {
    await expect(
      verifyLandingPackageHandoff({
        ...handoff,
        landingManifestDigest: `sha256:${'f'.repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: 'E_LANDING_HANDOFF_DIGEST_MISMATCH' });
    await expect(
      verifyLandingPackageHandoff({
        ...handoff,
        contractCatalogDigest: `sha256:${'e'.repeat(64)}`,
      } as never),
    ).rejects.toMatchObject({ code: 'E_LANDING_HANDOFF_INVALID' });
  });

  it('refuses non-TTY host creation before any callback or disposable effect', async () => {
    const verified = await verifyLandingPackageHandoff(handoff);
    const effect = vi.fn();
    const createHost = verified.landingApi.createLandingOwnerRuntimeHost as (
      callbacks: Record<string, unknown>,
    ) => unknown;
    expect(() =>
      createHost({
        snapshot: effect,
        commitIntent: effect,
        dispatch: effect,
        reconcile: effect,
        commitOutcome: effect,
      }),
    ).toThrowError(/live same-process owner terminal/iu);
    expect(effect).not.toHaveBeenCalled();
  });
});
