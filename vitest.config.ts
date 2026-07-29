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
    // Windows runners pair a modest core count with markedly slower file I/O,
    // and these suites are I/O-bound: real git repositories, fsynced journals,
    // and npm pack/install in the packed-install e2e. At vitest's default
    // worker count they saturate the runner and starve each other, which shows
    // up as several unrelated files timing out in the same run — the same
    // cascade seen locally under heavy load. Capping workers there trades a
    // little wall-clock for a deterministic result; other platforms keep the
    // default.
    poolOptions: {
      threads: {
        maxThreads: process.platform === 'win32' ? 2 : undefined,
      },
      forks: {
        maxForks: process.platform === 'win32' ? 2 : undefined,
      },
    },
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
