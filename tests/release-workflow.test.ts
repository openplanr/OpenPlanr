import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const publishWorkflow = readFileSync('.github/workflows/publish.yml', 'utf8');
const packageScripts = (
  JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

describe('npm release workflows', () => {
  it('passes the npm secret through the setup-node auth variable', () => {
    expect(releaseWorkflow).toContain('NODE_AUTH_TOKEN: $' + '{{ secrets.NPM_TOKEN }}');
  });

  it('keeps release-triggered publishing idempotent', () => {
    expect(publishWorkflow).toContain('run: npm run release');
    expect(publishWorkflow).not.toContain('run: npm publish --provenance --access public');
  });

  it('runs excluded Operating Board integration gates through the heavy config', () => {
    expect(packageScripts['test:operate:guided']).toContain(
      '--config vitest.heavy.config.ts tests/integration/operate-guided-init.test.ts',
    );
    expect(packageScripts['test:operate:security']).toContain(
      '--config vitest.heavy.config.ts tests/integration/operate-preview-boundaries.test.ts',
    );
  });
});
