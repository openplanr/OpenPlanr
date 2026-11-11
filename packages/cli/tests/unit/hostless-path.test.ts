import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hostlessPath } from '../helpers/hostless-path.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tool(directory: string, name: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), `#!/bin/sh\necho ${name}\n`, { mode: 0o755 });
}

function which(name: string, path: string): string {
  return execFileSync('/bin/sh', ['-c', `command -v ${name} || true`], {
    env: { PATH: path },
    encoding: 'utf8',
  }).trim();
}

describe.skipIf(process.platform === 'win32')('hostlessPath', () => {
  it('hides host CLIs but keeps the tools that share their directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'openplanr-hostless-'));
    roots.push(root);
    const system = join(root, 'usr-bin');
    const other = join(root, 'other');
    for (const name of ['git', 'gh', 'claude']) tool(system, name);
    tool(other, 'node');

    const path = hostlessPath([system, other].join(delimiter));

    expect(path.split(delimiter)).toContain(other);
    expect(which('git', path)).not.toBe('');
    expect(execFileSync('git', [], { env: { PATH: path }, encoding: 'utf8' })).toBe('git\n');
    expect(which('gh', path)).toBe('');
    expect(which('claude', path)).toBe('');
    expect(which('node', path)).toBe(join(other, 'node'));
  });
});
