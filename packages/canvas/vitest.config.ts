import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/canvas-context.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/browser/**'],
  },
});
