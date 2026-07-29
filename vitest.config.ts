import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
    // Budgets are sized for the slowest supported platform, not the fastest.
    //
    // Operating Board tests create real git projects, fsync a write-ahead
    // journal, and pack/install real tarballs. On Windows CI that I/O runs
    // several times slower than on macOS or Linux, and the recursive cleanups
    // additionally retry through the handle races Windows is prone to — a
    // packed-install teardown removes two complete npm trees.
    //
    // Calibrating these on a developer laptop is what produced the earlier
    // round of intermittent CI failures, so they are set once here against the
    // worst case. Both remain far below the job timeout, so a genuine hang
    // still fails the run rather than stalling it.
    testTimeout: 45_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/models/types.ts'],
      thresholds: {
        statements: 14,
        branches: 12,
        functions: 24,
        lines: 14,
      },
    },
  },
});
