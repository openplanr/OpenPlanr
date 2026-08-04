import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPENPLANR_SKILLS_VERSION } from '../../src/services/claude-plugin-service.js';

/**
 * The CLI pins its pipeline sibling exactly, in `optionalDependencies`. At runtime
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
 * This guard compares the *declared pin* against the pipeline revision the
 * environment actually resolves, so a release that advances one without the other
 * fails here instead of on a user's machine.
 */

function readJson(path: string): { version?: string } {
  return JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
}

const declaredPin = (
  JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    optionalDependencies?: Record<string, string>;
  }
).optionalDependencies?.['planr-pipeline'];

// The sibling the environment resolves: CI pins it to the released tag via
// OPENPLANR_PIPELINE_ROOT; locally it is the working checkout.
const siblingRoot = process.env.OPENPLANR_PIPELINE_ROOT?.trim() || resolve('../planr-pipeline');
const siblingManifest = join(siblingRoot, 'package.json');

describe('the CLI pipeline pin tracks the pipeline it is released against', () => {
  it('declares an exact pin (a range would silently resolve past the tested revision)', () => {
    expect(declaredPin).toBeDefined();
    expect(declaredPin).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.skipIf(!existsSync(siblingManifest))(
    'pins exactly the pipeline version the environment resolves',
    () => {
      const sibling = readJson(siblingManifest).version;
      expect(
        declaredPin,
        `package.json pins planr-pipeline@${declaredPin} but the resolved pipeline is ${sibling}. ` +
          'Bump the optionalDependencies pin (and the lockfile) in the same release, or every ' +
          '`planr setup` fails E_CLAUDE_PLUGIN_UPDATE_FAILED against the published plugin.',
      ).toBe(sibling);
    },
  );

  it('pins every workflow sibling checkout at the same released pipeline', () => {
    // The package pin above governs what the CLI resolves at runtime; these refs
    // govern what CI tests against. They drifted independently: #204 advanced
    // ci.yml and release.yml to v0.41.0 and left publish.yml at v0.39.0, so the
    // job that runs at publish time was validating against a pipeline two
    // releases old. Nothing compared them, so nothing caught it.
    const workflowDirectory = resolve('.github/workflows');
    const stale = readdirSync(workflowDirectory)
      .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
      .flatMap((entry) => {
        const body = readFileSync(join(workflowDirectory, entry), 'utf8');
        // Only refs that belong to a planr-pipeline checkout step.
        return [
          ...body.matchAll(/repository:\s*openplanr\/planr-pipeline[\s\S]{0,200}?ref:\s*(\S+)/g),
        ]
          .map((match) => ({ file: entry, ref: match[1] }))
          .filter((pin) => pin.ref !== `v${declaredPin}`);
      });
    expect(
      stale,
      `Workflow pipeline pins disagree with package.json (v${declaredPin}): ` +
        `${stale.map((pin) => `${pin.file}=${pin.ref}`).join(', ')}. ` +
        'CI would validate against a pipeline the CLI does not ship with.',
    ).toEqual([]);
  });

  it.skipIf(!existsSync(resolve('../skills/package.json')))(
    'targets the skills version the sibling bundle publishes',
    () => {
      const sibling = readJson(resolve('../skills/package.json')).version;
      expect(
        OPENPLANR_SKILLS_VERSION,
        `OPENPLANR_SKILLS_VERSION is ${OPENPLANR_SKILLS_VERSION} but the skills bundle is ${sibling}. ` +
          'A stale constant omits the skills plugin from upgrade prescriptions.',
      ).toBe(sibling);
    },
  );
});
