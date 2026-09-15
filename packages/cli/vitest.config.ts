import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    setupFiles: ['tests/setup/isolate-user-state.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/dashboard/operate-actions-recovery.test.tsx',
      'tests/e2e/upgrade-packed-install.test.ts',
      'tests/integration/operate-lifecycle.test.ts',
      'tests/e2e/dashboard-visual-regression.test.ts',
    ],
    testTimeout: 45_000,
    hookTimeout: 60_000,
    maxWorkers: 2,
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
