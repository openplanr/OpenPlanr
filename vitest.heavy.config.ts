import { defineConfig } from 'vitest/config';

/**
 * The I/O-heavy suites, run sequentially and on their own.
 *
 * `operate-packed-install` packs two real tarballs and performs two real npm
 * installs; `operate-checkpoint-scale` chains, replays, and reduces a
 * 10,000-event stream; the operate integration suites build real git projects
 * and fsync event, checkpoint, journal, and route state. They are legitimate
 * SPEC-002 verification and stay in CI, but inside the shared worker pool they
 * saturate the runner and starve unrelated files into timing out. On Windows,
 * where file I/O is several times slower, that showed up as different tests
 * failing on different runs of identical code.
 *
 * Isolating them removes the contention rather than widening deadlines around
 * it. `fileParallelism: false` keeps the suites from competing with each other.
 */
export default defineConfig({
  test: {
    globals: true,
    root: '.',
    setupFiles: ['tests/setup/isolate-user-state.ts'],
    include: [
      'tests/e2e/operate-packed-install.test.ts',
      'tests/e2e/operate-guided-packed-install.test.ts',
      // Packs and installs a real tarball, then runs the real `bin/planr.js`
      // against it — the SPEC-006 Trap-A proof that `planr upgrade status`
      // reads the actual installed CLI version, not an in-memory fixture.
      'tests/e2e/upgrade-packed-install.test.ts',
      'tests/unit/operate-checkpoint-scale.test.ts',
      'tests/integration/doctor-guided-operate.test.ts',
      // Every operate integration suite builds real git projects and drives the
      // fsynced write-ahead journal. Measured on one CI run, operate-route-lanes
      // took 9-14s on macOS and Linux, 31s on one Windows runner, and 115s on
      // another — the same file, the same commit. That spread is the runner's
      // I/O, not the test, and it cannot be absorbed by a per-test budget
      // without hiding real hangs. Running them sequentially removes the
      // contention instead of widening the deadline around it.
      'tests/integration/operate-*.test.ts',
    ],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
