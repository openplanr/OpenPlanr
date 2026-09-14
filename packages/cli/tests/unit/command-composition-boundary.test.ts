import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/cli');
const entrypoint = readFileSync(join(cliRoot, 'index.ts'), 'utf8');
const groupsRoot = join(cliRoot, 'commands/groups');

describe('CLI command composition boundary', () => {
  it('keeps the CLI entrypoint dependent on one command-domain facade', () => {
    expect(entrypoint).toContain("from './commands/index.js'");
    expect(entrypoint).not.toMatch(/from ['"]\.\/commands\/(?!index\.js)[^'"]+['"]/u);
  });

  it('splits registration into bounded named command groups', () => {
    const groupFiles = readdirSync(groupsRoot)
      .filter((name) => name.endsWith('.ts'))
      .sort();
    expect(groupFiles).toEqual([
      'delivery.ts',
      'foundation.ts',
      'intelligence.ts',
      'operations.ts',
      'planning.ts',
    ]);
    for (const filename of groupFiles) {
      const source = readFileSync(join(groupsRoot, filename), 'utf8');
      const imports = source.match(/^import .*$/gmu) ?? [];
      expect(
        imports.length,
        `${filename} has become another oversized composition root`,
      ).toBeLessThanOrEqual(12);
    }
  });
});
