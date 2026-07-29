import { defineConfig } from 'vitest/config';

/**
 * The two I/O-heavy suites, run sequentially and on their own.
 *
 * `operate-packed-install` packs two real tarballs and performs two real npm
 * installs; `operate-checkpoint-scale` chains, replays, and reduces a
 * 10,000-event stream. Both are legitimate SPEC-002 verification and both stay
 * in CI — but inside the shared worker pool they saturate the runner and
 * starve unrelated files into timing out. On Windows, where file I/O is
 * several times slower, that showed up as different tests failing on different
 * runs of identical code.
 *
 * Isolating them removes the contention rather than widening deadlines around
 * it. `fileParallelism: false` keeps the two from competing with each other.
 */
export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: [
      'tests/e2e/operate-packed-install.test.ts',
      'tests/unit/operate-checkpoint-scale.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
