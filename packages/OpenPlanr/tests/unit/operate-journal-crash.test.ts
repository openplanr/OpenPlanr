import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyJournalTransaction,
  assertCommittedOperatingView,
  prepareJournalTransaction,
  readJournal,
  recoverOperatingTransactions,
} from '../../src/services/operate/journal.js';
import type { OperatingEventHead } from '../../src/services/operate/types.js';

/**
 * Crash injection across every write-ahead journal transition (SPEC-002).
 *
 * Two distinct failure shapes are covered:
 *
 *   1. In-process failure — an exception raised at a transition. The journal
 *      unwinds itself and every destination is restored byte-exact.
 *   2. Hard crash — the process dies mid-promotion leaving a non-terminal
 *      journal on disk. Readers must refuse to expose the partial state, and
 *      recovery must restore byte-exact.
 *
 * `applyJournalTransaction` exposes `beforeTransition` precisely so the first
 * shape can be driven deterministically; the second is reproduced by leaving
 * the exact on-disk residue an abrupt termination would leave behind.
 */

const HEAD: OperatingEventHead = {
  sequence: 3,
  hash: `sha256:${'a'.repeat(64)}`,
};

const PREVIEW = `sha256:${'b'.repeat(64)}` as const;

const ORIGINAL_ALPHA = 'alpha: original contents\n';
const ORIGINAL_BETA = 'beta: original contents\n';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 })),
  );
});

async function project(): Promise<{ projectRoot: string; localRoot: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'openplanr-journal-crash-'));
  const localRoot = await mkdtemp(join(tmpdir(), 'openplanr-journal-local-'));
  roots.push(projectRoot, localRoot);
  await writeFile(join(projectRoot, 'alpha.txt'), ORIGINAL_ALPHA, 'utf8');
  await writeFile(join(projectRoot, 'beta.txt'), ORIGINAL_BETA, 'utf8');
  return { projectRoot, localRoot };
}

function writes() {
  return [
    { relativePath: 'alpha.txt', content: 'alpha: promoted contents\n' },
    { relativePath: 'beta.txt', content: 'beta: promoted contents\n' },
    { relativePath: 'gamma.txt', content: 'gamma: created by transaction\n' },
  ];
}

async function contents(projectRoot: string) {
  return {
    alpha: await readFile(join(projectRoot, 'alpha.txt'), 'utf8').catch(() => null),
    beta: await readFile(join(projectRoot, 'beta.txt'), 'utf8').catch(() => null),
    gamma: await readFile(join(projectRoot, 'gamma.txt'), 'utf8').catch(() => null),
  };
}

const UNTOUCHED = {
  alpha: ORIGINAL_ALPHA,
  beta: ORIGINAL_BETA,
  // The transaction creates gamma.txt, so an unwound transaction leaves none.
  gamma: null,
};

describe('Operating Board journal crash injection', () => {
  const transitions: Array<['promote-write' | 'promoted' | 'committed', number | undefined]> = [
    ['promote-write', 0],
    ['promote-write', 1],
    ['promote-write', 2],
    ['promoted', undefined],
    ['committed', undefined],
  ];

  for (const [transition, index] of transitions) {
    const label = index === undefined ? transition : `${transition}[${index}]`;
    it(`restores every destination byte-exact when the process fails at ${label}`, async () => {
      const { projectRoot, localRoot } = await project();
      const prepared = await prepareJournalTransaction(projectRoot, {
        writes: writes(),
        eventHead: HEAD,
        previewDigest: PREVIEW,
        localRoot,
      });
      expect(prepared.record.state).toBe('staged-fsynced');

      await expect(
        applyJournalTransaction(projectRoot, prepared, {
          currentEventHead: HEAD,
          beforeTransition: (candidate, candidateIndex) => {
            if (candidate === transition && candidateIndex === index) {
              throw new Error(`simulated crash at ${label}`);
            }
          },
        }),
      ).rejects.toThrowError(`simulated crash at ${label}`);

      // Byte-exact restoration, including removal of created files.
      expect(await contents(projectRoot)).toEqual(UNTOUCHED);

      // The journal reached a terminal state, so readers are unblocked.
      const record = await readJournal(prepared.manifestPath);
      expect(record.state).toBe('rolled-back');
      await expect(
        assertCommittedOperatingView(projectRoot, { localRoot }),
      ).resolves.toBeUndefined();

      // Recovery is idempotent: nothing left to recover.
      expect(await recoverOperatingTransactions(projectRoot, { localRoot })).toEqual([]);
    });
  }

  it('commits every destination when no crash is injected', async () => {
    const { projectRoot, localRoot } = await project();
    const prepared = await prepareJournalTransaction(projectRoot, {
      writes: writes(),
      eventHead: HEAD,
      previewDigest: PREVIEW,
      localRoot,
    });

    const record = await applyJournalTransaction(projectRoot, prepared, {
      currentEventHead: HEAD,
    });

    expect(record.state).toBe('committed');
    expect(await contents(projectRoot)).toEqual({
      alpha: 'alpha: promoted contents\n',
      beta: 'beta: promoted contents\n',
      gamma: 'gamma: created by transaction\n',
    });
    await expect(assertCommittedOperatingView(projectRoot, { localRoot })).resolves.toBeUndefined();
  });

  it('refuses to expose a hard-crash residue and recovers it byte-exact', async () => {
    const { projectRoot, localRoot } = await project();
    const prepared = await prepareJournalTransaction(projectRoot, {
      writes: writes(),
      eventHead: HEAD,
      previewDigest: PREVIEW,
      localRoot,
    });

    // Reproduce an abrupt termination: the first destination was promoted, the
    // journal is still 'staged-fsynced', and no unwind handler ever ran.
    await writeFile(join(projectRoot, 'alpha.txt'), 'alpha: promoted contents\n', 'utf8');
    expect((await readJournal(prepared.manifestPath)).state).toBe('staged-fsynced');

    // A reader must never present this half-applied view as committed state.
    await expect(assertCommittedOperatingView(projectRoot, { localRoot })).rejects.toThrowError(
      expect.objectContaining({ code: 'E_OPERATE_TRANSACTION_INVALID' }),
    );

    const recovered = await recoverOperatingTransactions(projectRoot, { localRoot });
    expect(recovered).toEqual([prepared.record.transactionId]);
    expect(await contents(projectRoot)).toEqual(UNTOUCHED);
    expect((await readJournal(prepared.manifestPath)).state).toBe('rolled-back');

    // Recovery is idempotent and leaves readers unblocked.
    expect(await recoverOperatingTransactions(projectRoot, { localRoot })).toEqual([]);
    await expect(assertCommittedOperatingView(projectRoot, { localRoot })).resolves.toBeUndefined();
  });

  it('refuses to promote when the event head moves under a staged transaction', async () => {
    const { projectRoot, localRoot } = await project();
    const prepared = await prepareJournalTransaction(projectRoot, {
      writes: writes(),
      eventHead: HEAD,
      previewDigest: PREVIEW,
      localRoot,
    });

    await expect(
      applyJournalTransaction(projectRoot, prepared, {
        currentEventHead: HEAD,
        revalidateEventHead: async () => ({
          sequence: HEAD.sequence + 1,
          hash: `sha256:${'c'.repeat(64)}`,
        }),
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'E_OPERATE_ROUTE_DRIFT' }));

    expect(await contents(projectRoot)).toEqual(UNTOUCHED);
    expect((await readJournal(prepared.manifestPath)).state).toBe('rolled-back');
  });
});
