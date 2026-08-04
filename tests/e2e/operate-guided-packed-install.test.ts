import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = mkdtempSync(join(tmpdir(), 'operate-guided-pack-'));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('guided Operating Board package surface', () => {
  it('packs the public CLI and declares the exact portable pipeline dependency', () => {
    const output = execFileSync(
      npm,
      process.platform === 'win32'
        ? ['pack', '--json', '--ignore-scripts', '--pack-destination', `"${root}"`]
        : ['pack', '--json', '--ignore-scripts', '--pack-destination', root],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        ...(process.platform === 'win32' ? { shell: true } : {}),
      },
    );
    const packed = JSON.parse(output) as Array<{
      filename: string;
      files: Array<{ path: string }>;
    }>;
    const paths = packed[0].files.map((entry) => entry.path);
    expect(paths).toContain('bin/planr.js');
    expect(paths).toContain('dist/cli/commands/operate.js');
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      optionalDependencies?: Record<string, string>;
    };
    // The contract is *exactness*, not a particular number: the packed manifest must pin
    // one resolved version, never a range that could float. Asserting a literal instead
    // meant every pipeline bump broke this until someone hand-edited it, which cost a
    // full CI round-trip during the 0.40.0 release and tested nothing extra.
    expect(manifest.optionalDependencies?.['planr-pipeline']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
