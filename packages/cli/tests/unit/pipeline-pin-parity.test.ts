import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SEMVER_REGEX } from '../../../protocol/src/semver.mjs';

/**
 * The CLI pins its public pipeline compatibility package exactly in
 * `optionalDependencies`. At runtime
 * `resolvePipelinePackage()` reads the *installed* `node_modules/planr-pipeline`
 * manifest and that version becomes the version the Claude plugin is expected to
 * be — compared by strict equality.
 *
 * When a pipeline release advances without this pin advancing with it, every
 * `planr setup` fails with `E_CLAUDE_PLUGIN_UPDATE_FAILED` and rolls back: the
 * user's correctly-installed newer plugin reads as drift against the CLI's stale
 * expectation. That is exactly what shipped in 1.25.0 (pin 0.40.0, published
 * pipeline 0.41.0), and it broke the front door for every user.
 *
 * No existing test could catch it: the suites set `OPENPLANR_PIPELINE_ROOT` to a
 * source checkout, which bypasses the node_modules resolution the pin governs.
 * The monorepo makes the pipeline a repository-owned workspace while preserving the
 * public package contract. This guard compares the exact public compatibility pin,
 * local package version, root lock projection, and root-only workflows so drift
 * fails before any tarball can be considered releasable.
 */

function readJson(path: string): { version?: string } {
  return JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
}

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workspaceRoot = resolve(cliRoot, '..', '..');
const workflowDirectory = resolve(workspaceRoot, '.github', 'workflows');
const pipelineRoot = resolve(workspaceRoot, 'packages', 'pipeline');
const rootLock = JSON.parse(readFileSync(resolve(workspaceRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<
    string,
    {
      link?: boolean;
      optionalDependencies?: Record<string, string>;
      resolved?: string;
      version?: string;
    }
  >;
};
const cliManifest = JSON.parse(readFileSync(resolve(cliRoot, 'package.json'), 'utf8')) as {
  optionalDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};
const pipelineManifest = readJson(resolve(pipelineRoot, 'package.json'));
const declaredPin = cliManifest.optionalDependencies?.['planr-pipeline'];

const installedPipelineManifest = resolve(
  workspaceRoot,
  'node_modules',
  'planr-pipeline',
  'package.json',
);

function rootWorkflow(name: string): string {
  return readFileSync(resolve(workflowDirectory, name), 'utf8');
}

describe('the CLI pipeline pin tracks the pipeline it is released against', () => {
  it('declares the candidate pipeline version as one exact compatibility pin', () => {
    expect(declaredPin).toMatch(SEMVER_REGEX);
    expect(pipelineManifest.version).toBe(declaredPin);
  });

  it('projects the exact pairing through the one root lockfile', () => {
    expect(rootLock.packages['packages/cli']?.optionalDependencies?.['planr-pipeline']).toBe(
      declaredPin,
    );
    expect(rootLock.packages['packages/pipeline']?.version).toBe(declaredPin);
    expect(rootLock.packages['node_modules/planr-pipeline']).toEqual({
      resolved: 'packages/pipeline',
      link: true,
    });
  });

  it.skipIf(!existsSync(installedPipelineManifest))(
    'resolves the root-installed workspace at the exact public version',
    () => {
      expect(readJson(installedPipelineManifest).version).toBe(declaredPin);
    },
  );

  it('keeps workflow authority at the repository root without external pipeline refs', () => {
    expect(existsSync(resolve(cliRoot, '.github', 'workflows'))).toBe(false);
    expect(existsSync(resolve(pipelineRoot, '.github', 'workflows'))).toBe(false);

    const violations = readdirSync(workflowDirectory)
      .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
      .flatMap((entry) => {
        const body = readFileSync(join(workflowDirectory, entry), 'utf8');
        const reasons = [];
        if (/repository:\s*openplanr\/planr-pipeline/u.test(body))
          reasons.push('external-checkout');
        if (/\bv0\.42\.0\b/u.test(body)) reasons.push('stale-0.42.0-ref');
        if (/OPENPLANR_PIPELINE_(?:ROOT|SOURCE|TARBALL)/u.test(body)) {
          reasons.push('ambient-pipeline-authority');
        }
        return reasons.map((reason) => `${entry}:${reason}`);
      });

    expect(violations).toEqual([]);
  });

  it('tests the consolidated pipeline and dashboard from local workspace custody', () => {
    const workflow = rootWorkflow('ci.yml');
    const dashboardWorkflow = rootWorkflow('dashboard-browser.yml');

    expect(workflow).toContain('node-version: 24');
    expect(workflow).toContain('run: npm test');
    expect(workflow).toContain('node: [20, 22]');
    expect(workflow).toContain('run: npm run test:focused');
    expect(workflow).toContain('run: npm ci');
    expect(workflow).toContain('run: npm run check:generated');
    expect(workflow).toContain('run: npm run check:boundaries');
    expect(workflow).toContain('run: npm run verify:packed:strict');
    expect(workflow).not.toContain('dashboard-candidate');
    expect(workflow).not.toContain('.ci/planr-pipeline');

    expect(dashboardWorkflow).toContain("- 'apps/dashboard/**'");
    expect(dashboardWorkflow).toContain('run: npm run test:browser --workspace=openplanr');
    expect(dashboardWorkflow).toContain('against local workspace packages');
    expect(dashboardWorkflow).not.toContain('OPENPLANR_PIPELINE_SOURCE');
    expect(cliManifest.scripts?.['verify:dashboard-candidate']).toBe(
      'node scripts/run-dashboard-browser-tests.mjs --compile-only',
    );
    expect(cliManifest.scripts?.['build:core']).toBe(
      'node ../../scripts/skills/generate-v18.mjs --write && node scripts/clean-dist.mjs && tsc && node scripts/copy-templates.mjs',
    );
  });
});
