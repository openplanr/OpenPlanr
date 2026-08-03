import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// BL-010: CI workflows live at the MONOREPO root (git hooks and Actions are
// per-repository), while this suite runs with cwd = packages/OpenPlanr. Resolve
// upward from this file rather than from cwd.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workflow = (name: string) =>
  readFileSync(resolve(repoRoot, '.github/workflows', name), 'utf8');

const releaseWorkflow = workflow('release.yml');
const packageScripts = (
  JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

describe('npm release workflows', () => {
  it('passes the npm secret through the setup-node auth variable', () => {
    expect(releaseWorkflow).toContain('NODE_AUTH_TOKEN: $' + '{{ secrets.NPM_TOKEN }}');
  });

  it('publishes through changesets rather than a bare npm publish', () => {
    // BL-010 deleted the separate publish.yml (release-published -> npm run
    // release). The monorepo has ONE release workflow: changesets decides what
    // to version and what to publish, so a hand-rolled `npm publish` here would
    // republish packages changesets deliberately skipped.
    expect(releaseWorkflow).toContain('changesets/action');
    expect(releaseWorkflow).toContain('changeset publish');
    expect(releaseWorkflow).not.toContain('run: npm publish');
  });

  it('grants the id-token permission provenance attestation requires', () => {
    expect(releaseWorkflow).toMatch(/id-token:\s*write/);
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
