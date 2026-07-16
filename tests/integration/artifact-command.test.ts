import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const CLI = resolve('src/cli/index.ts');
const TSX = resolve('node_modules/tsx/dist/cli.mjs');
const pipelineRoot = process.env.OPENPLANR_PIPELINE_ROOT ?? resolve('../planr-pipeline');
const tempDirs: string[] = [];

function temporary(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openplanr-artifact-command-'));
  tempDirs.push(dir);
  return dir;
}

function run(args: string[], cwd: string) {
  return spawnSync(process.execPath, [TSX, CLI, '--project-dir', cwd, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      OPENPLANR_PIPELINE_ROOT: pipelineRoot,
    },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('planr artifact and PATH-safe pipeline routing', { timeout: 30_000 }, () => {
  it('reserves --short for the explicit immutable snapshot transport', () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><title>review</title>');
    const result = run(
      ['artifact', 'share', 'artifact.html', '--short', '--no-open', '--json'],
      dir,
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('requires `--snapshot`');
  });

  it('creates a private fragment link through the public planr artifact command', () => {
    const dir = temporary();
    writeFileSync(
      join(dir, 'artifact.html'),
      '<!doctype html><html><body><button id="ready">Ready</button></body></html>',
    );

    const result = run(
      ['artifact', 'share', 'artifact.html', '--snapshot', '--no-open', '--json'],
      dir,
    );
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      ok: true,
      transport: 'fragment',
      uploaded: false,
      presentation: 'document',
    });
    expect(output.url).toMatch(/^https:\/\/share\.openplanr\.dev\/#v1\./);
  });

  it('serializes explicit canvas presentation while auto remains a document compatibility fallback', () => {
    const dir = temporary();
    writeFileSync(join(dir, 'artifact.html'), '<!doctype html><html><body>Canvas</body></html>');

    const explicit = run(
      [
        'artifact',
        'share',
        'artifact.html',
        '--snapshot',
        '--presentation',
        'canvas',
        '--no-open',
        '--json',
      ],
      dir,
    );
    expect(explicit.status, explicit.stderr).toBe(0);
    expect(JSON.parse(explicit.stdout)).toMatchObject({ presentation: 'canvas' });

    const invalid = run(
      ['artifact', 'share', 'artifact.html', '--presentation', 'website', '--no-open', '--json'],
      dir,
    );
    expect(invalid.status).not.toBe(0);
    expect(JSON.parse(invalid.stdout)).toMatchObject({
      code: 'E_ARTIFACT_INPUT_INVALID',
      problem: expect.stringContaining('auto, document, or canvas'),
    });
  });

  it('routes deterministic engine actions without requiring planr-pipeline on PATH', () => {
    const dir = temporary();
    const result = run(['pipeline', 'prepare-plan', 'checkout', '--json'], dir);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      phase: 'plan.prepared',
      slug: 'checkout',
    });
  });
});
