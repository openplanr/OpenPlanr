import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function installedCli(): string {
  const directory = mkdtempSync(join(tmpdir(), 'openplanr-planr-alias-'));
  directories.push(directory);
  mkdirSync(join(directory, 'bin'));
  mkdirSync(join(directory, 'lib'));
  mkdirSync(join(directory, 'dist/cli'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}\n');
  for (const file of [
    'bin/openplanr.js',
    'bin/planr.js',
    'lib/node-runtime.mjs',
    'lib/names.mjs',
  ]) {
    copyFileSync(resolve(file), join(directory, file));
  }
  writeFileSync(
    join(directory, 'dist/cli/index.js'),
    [
      'process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\\n`);',
      'process.stderr.write("entry diagnostics\\n");',
      'process.exitCode = 3;',
      '',
    ].join('\n'),
  );
  return directory;
}

describe('the planr alias', () => {
  it('prints one notice on stderr and otherwise behaves like openplanr', () => {
    const directory = installedCli();
    const run = (bin: string) =>
      spawnSync(process.execPath, [join(directory, 'bin', bin), 'status', '--json'], {
        encoding: 'utf8',
      });
    const current = run('openplanr.js');
    const alias = run('planr.js');
    expect(current.status).toBe(3);
    expect(alias.status).toBe(current.status);
    expect(alias.stdout).toBe(current.stdout);
    expect(alias.stdout).toBe('["status","--json"]\n');
    expect(alias.stderr).toBe(
      'planr is now openplanr (short alias: opr). The planr command will be removed in the next release.\n' +
        current.stderr,
    );
  });
});
