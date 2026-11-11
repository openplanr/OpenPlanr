import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pipeline = vi.hoisted(() => ({ current: null as { root: string; version: string } | null }));

vi.mock('../../src/services/pipeline-package-service.js', () => ({
  resolvePipelinePackage: () => pipeline.current,
}));

const { prepareDesignArtifact, readDesignCapabilities, runDesignUtility } = await import(
  '../../src/services/design-artifact-service.js'
);

const roots: string[] = [];

function fakePipeline(utility: string) {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-fake-pipeline-'));
  roots.push(root);
  mkdirSync(join(root, 'lib/design'), { recursive: true });
  writeFileSync(join(root, 'lib/design/utility.mjs'), utility);
  pipeline.current = { root, version: '9.9.9' };
}

afterEach(() => {
  pipeline.current = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the design utility runtime', () => {
  it('reports a missing workflow package as a capability, not a failure', async () => {
    await expect(readDesignCapabilities('1.2.3')).resolves.toEqual({
      ok: false,
      code: 'E_DESIGN_RUNTIME_MISSING',
      problem: expect.stringContaining('planr-pipeline'),
      recovery: expect.stringContaining('--omit=optional'),
      contract: null,
      supported: null,
      cli: '1.2.3',
      pipeline: null,
    });
  });

  it('refuses design commands with the reinstall step when the workflow package is missing', async () => {
    await expect(runDesignUtility(['inspect', '/design-document.json'])).rejects.toMatchObject({
      code: 'E_DESIGN_RUNTIME_MISSING',
      fix: expect.stringContaining('--omit=optional'),
    });
  });

  it('tells artifact review to reinstall without --omit=optional', async () => {
    const failure = prepareDesignArtifact('/design-document.json');
    await expect(failure).rejects.toThrow(
      'Design review requires the OpenPlanr workflow package. Reinstall openplanr without --omit=optional.',
    );
  });

  it('reports the contract range the installed workflow package serves', async () => {
    fakePipeline(
      'export const DESIGN_UTILITY_CONTRACT = 2;\n' +
        'export const DESIGN_UTILITY_SUPPORTED = Object.freeze({ min: 1, max: 2 });\n' +
        'export async function designUtility() { return {}; }\n',
    );
    await expect(readDesignCapabilities('1.2.3')).resolves.toEqual({
      ok: true,
      contract: 2,
      supported: { min: 1, max: 2 },
      cli: '1.2.3',
      pipeline: '9.9.9',
    });
  });

  it('treats a workflow package without a contract as unsupported', async () => {
    fakePipeline('export async function designUtility() { return {}; }\n');
    await expect(readDesignCapabilities('1.2.3')).rejects.toMatchObject({
      code: 'E_DESIGN_RUNTIME_UNSUPPORTED',
    });
  });

  it('passes the arguments through and gives uncoded failures a stable code', async () => {
    fakePipeline(
      'export async function designUtility(argv, { stdout }) {\n' +
        "  if (argv[0] === 'plain') throw new Error('plain failure');\n" +
        "  if (argv[0] === 'coded') throw Object.assign(new Error('coded failure'), { code: 'E_DESIGN_OWN' });\n" +
        '  stdout({ printed: true });\n' +
        '  return { ok: true, argv };\n' +
        '}\n',
    );
    await expect(runDesignUtility(['inspect', '/a.json', '--json'])).resolves.toEqual({
      ok: true,
      argv: ['inspect', '/a.json', '--json'],
    });
    await expect(runDesignUtility(['plain', '/a.json'])).rejects.toMatchObject({
      code: 'E_DESIGN_UTILITY_FAILED',
      message: 'plain failure',
    });
    await expect(runDesignUtility(['coded', '/a.json'])).rejects.toMatchObject({
      code: 'E_DESIGN_OWN',
    });
  });
});
