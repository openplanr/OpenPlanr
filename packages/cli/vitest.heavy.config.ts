import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    setupFiles: ['tests/setup/isolate-user-state.ts'],
    include: [
      // Packs and installs a real tarball, then runs the real `bin/planr.js`
      // against it — the SPEC-006 Trap-A proof that `planr upgrade status`
      // reads the actual installed CLI version, not an in-memory fixture.
      'tests/e2e/upgrade-packed-install.test.ts',
      'tests/dashboard/operate-actions-recovery.test.tsx',
    ],
    fileParallelism: false,
    pool: 'threads',
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
