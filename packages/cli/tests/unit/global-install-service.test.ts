import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { npmPrefixOf, openPlanrOnPath } from '../../src/services/global-install-service.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openplanr-global-installs-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A POSIX npm global install: `<prefix>/bin/openplanr` links into `<prefix>/lib/node_modules`. */
function posixInstall(name: string, version: string): string {
  const prefix = join(root, name);
  const packageRoot = join(prefix, 'lib', 'node_modules', 'openplanr');
  mkdirSync(join(packageRoot, 'bin'), { recursive: true });
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'openplanr', version }));
  writeFileSync(join(packageRoot, 'bin', 'openplanr.js'), '#!/usr/bin/env node\n');
  symlinkSync('../lib/node_modules/openplanr/bin/openplanr.js', join(prefix, 'bin', 'openplanr'));
  return prefix;
}

describe.skipIf(process.platform === 'win32')('openPlanrOnPath', () => {
  it('lists each distinct install on PATH in order, with its version', () => {
    const first = posixInstall('homebrew', '3.0.1');
    const second = posixInstall('fnm', '3.1.0');
    const path = [join(first, 'bin'), join(second, 'bin'), join(first, 'bin')].join(delimiter);

    expect(
      openPlanrOnPath({ PATH: path }).map(({ command, version }) => ({ command, version })),
    ).toEqual([
      { command: join(first, 'bin', 'openplanr'), version: '3.0.1' },
      { command: join(second, 'bin', 'openplanr'), version: '3.1.0' },
    ]);
  });

  it('derives the npm prefix of a global install and rejects other layouts', () => {
    expect(npmPrefixOf(join(root, 'p', 'lib', 'node_modules', 'openplanr'))).toBe(join(root, 'p'));
    expect(npmPrefixOf(join(root, 'checkout', 'packages', 'cli'))).toBeUndefined();
  });
});
