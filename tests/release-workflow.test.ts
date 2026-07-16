import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const publishWorkflow = readFileSync('.github/workflows/publish.yml', 'utf8');

describe('npm release workflows', () => {
  it('passes the npm secret through the setup-node auth variable', () => {
    expect(releaseWorkflow).toContain('NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}');
  });

  it('keeps release-triggered publishing idempotent', () => {
    expect(publishWorkflow).toContain('run: npm run release');
    expect(publishWorkflow).not.toContain('run: npm publish --provenance --access public');
  });
});
