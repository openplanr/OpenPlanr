import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalDigest } from '../../src/services/operate/canonical.js';
import { OperatingEvidenceCache } from '../../src/services/operate/evidence-cache.js';

/**
 * Advisor lenses record concurrently since the 0.39.0 fan-out contract, so two
 * lenses citing the same file derive the same `evidenceId` and race on one
 * target path. The atomic write must therefore use a temp name unique per
 * WRITE, not per process: a pid-only suffix gave both writes the same temp
 * path, the first rename consumed it, and the second failed
 * `ENOENT ... rename '<target>.<pid>.tmp'` — surfacing to the operator as
 * "<lens> failed before recording an analysis" and costing that lens's work.
 *
 * This reproduced on five of six CI platforms while passing locally, so it is
 * pinned here rather than left to integration timing.
 */
describe('operating evidence cache — concurrent writes to one evidence id', () => {
  let cacheRoot: string;

  beforeEach(async () => {
    cacheRoot = await mkdtemp(path.join(tmpdir(), 'openplanr-cache-race-'));
  });

  afterEach(async () => {
    await rm(cacheRoot, { recursive: true, force: true });
  });

  it('persists a citation snapshot when many lenses cite the same evidence id at once', async () => {
    const cache = new OperatingEvidenceCache(cacheRoot, 'internal');
    const evidenceId = 'EVD-shared-citation';
    const content = 'the same cited line, cited by every lens';

    // Six lenses recording at once — the real board size.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        cache.putCitationSnapshot(
          {
            evidenceId,
            snapshotDigest: canonicalDigest(content) as `sha256:${string}`,
            sourceLocation: 'src/shared.ts#L1-L2',
            sensitivity: 'internal',
            content,
          },
          60_000,
        ),
      ),
    );

    // Every write resolves; none is lost to a rename race.
    expect(results).toEqual(Array.from({ length: 6 }, () => evidenceId));

    // The snapshot is readable, and no temp file was orphaned behind it.
    const snapshot = await cache.getCitationSnapshot(evidenceId);
    expect(snapshot?.content).toBe(content);
    const leftovers = (await readdir(cacheRoot)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('persists a collected-evidence record under the same concurrent pressure', async () => {
    const cache = new OperatingEvidenceCache(cacheRoot, 'internal');
    const evidence = {
      fingerprint: 'sha256:0'.padEnd(71, '0') as `sha256:${string}`,
      items: [],
      sources: [],
      warnings: [],
    };

    // One shared instant across every write, so all six derive the same digest
    // and therefore the same target path — that collision is the point of the
    // test. It must be a real "now" so the record is still inside its TTL when
    // read back.
    const now = new Date();
    const digests = await Promise.all(
      Array.from({ length: 6 }, () => cache.put('shared-key', evidence as never, 60_000, now)),
    );

    expect(new Set(digests).size).toBe(1);
    expect(await cache.get(digests[0], now)).toBeDefined();
    const leftovers = (await readdir(cacheRoot)).filter((name) => name.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
