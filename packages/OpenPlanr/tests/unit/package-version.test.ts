import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArtifactSession } from '../../src/services/operate/artifacts.js';
import { OPENPLANR_VERSION, readOpenPlanrVersion } from '../../src/utils/package-version.js';

describe('OpenPlanr package version provenance', () => {
  it('uses package.json as the single CLI and operating producer version', async () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version: string;
    };

    expect(readOpenPlanrVersion()).toBe(manifest.version);
    expect(OPENPLANR_VERSION).toBe(manifest.version);

    const session = await createArtifactSession({
      id: 'ART-001',
      cycleId: 'CYCLE-001',
      artifactType: 'markdown',
      inputDigest: `sha256:${'a'.repeat(64)}`,
      destination: '.planr/operate/cycles/CYCLE-001/artifacts/owner-brief.md',
      evidenceRefs: ['EVD-001'],
      runtime: 'fixture',
      now: '2026-07-29T16:00:00.000Z',
    });
    expect(session.producer.version).toBe(manifest.version);
  });
});
