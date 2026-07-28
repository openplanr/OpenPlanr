import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
    // Operating Board integration tests create real git projects and fsync a
    // write-ahead journal. Under parallel workers that disk contention pushes
    // individual cases past vitest's 5s default even though they finish in
    // well under a second in isolation. 20s still fails a genuine hang.
    testTimeout: 20_000,
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
