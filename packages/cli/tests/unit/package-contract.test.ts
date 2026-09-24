import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInstalledExportProbePlan,
  enumerateExportTargets,
  inventoryTree,
  payloadBytesEqual,
  payloadDigest,
  validateExportTargets,
  validatePackagedMarkdownLinks,
  verifyPackedSourceParity,
} from '../../scripts/package-contract.mjs';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'openplanr-package-contract-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('packed package contract', () => {
  it('enumerates every conditional export and rejects any omitted target', () => {
    const exportsField = {
      '.': { import: './dist/index.js', types: './dist/index.d.ts' },
      './dashboard': './dist/dashboard/dashboard-manifest.json',
    };

    expect(enumerateExportTargets(exportsField)).toHaveLength(3);
    expect(
      validateExportTargets(exportsField, [
        'dist/index.js',
        'dist/index.d.ts',
        'dist/dashboard/dashboard-manifest.json',
      ]).violations,
    ).toEqual([]);
    expect(validateExportTargets(exportsField, ['dist/index.js']).violations).toEqual([
      'missing export target: . types',
      'missing export target: ./dashboard default',
    ]);
  });

  it('materializes runtime, stylesheet, wildcard JSON, and type-only exports', () => {
    const probes = createInstalledExportProbePlan(
      'fixture-package',
      {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        },
        './schemas/*': './schemas/*',
        './editor.css': './dist/editor.css',
      },
      [
        'dist/index.d.ts',
        'dist/index.js',
        'schemas/v1/example.schema.json',
        'schemas/v2/example.schema.json',
        'dist/editor.css',
      ],
    );

    expect(probes).toHaveLength(6);
    expect(probes.filter(({ kind }) => kind === 'import')).toHaveLength(2);
    expect(probes.filter(({ kind }) => kind === 'type-only')).toHaveLength(1);
    expect(probes.filter(({ kind }) => kind === 'asset').map(({ specifier }) => specifier)).toEqual(
      ['fixture-package/editor.css'],
    );
    expect(probes.filter(({ kind }) => kind === 'json').map(({ specifier }) => specifier)).toEqual([
      'fixture-package/schemas/v1/example.schema.json',
      'fixture-package/schemas/v2/example.schema.json',
    ]);
  });

  it('checks only shipped documentation and rejects unresolved local links', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'docs'));
    writeFileSync(
      join(root, 'README.md'),
      '[guide](docs/GUIDE.md)\n[site](https://openplanr.dev)\n',
    );
    writeFileSync(join(root, 'docs', 'GUIDE.md'), '[missing](MISSING.md)\n');

    expect(validatePackagedMarkdownLinks(root, ['README.md', 'docs/GUIDE.md']).violations).toEqual([
      'docs/GUIDE.md: unresolved local link MISSING.md',
    ]);
    expect(validatePackagedMarkdownLinks(root, ['README.md']).violations).toEqual([
      'README.md: unresolved local link docs/GUIDE.md',
    ]);
  });

  it('creates deterministic byte inventories and rejects package symlinks', () => {
    const left = temporaryRoot();
    const right = temporaryRoot();
    writeFileSync(join(left, 'asset.txt'), 'same bytes');
    writeFileSync(join(right, 'asset.txt'), 'same bytes');

    const leftInventory = inventoryTree(left);
    const rightInventory = inventoryTree(right);
    expect(payloadDigest(leftInventory)).toBe(payloadDigest(rightInventory));
    expect(payloadBytesEqual(leftInventory, rightInventory)).toBe(true);

    symlinkSync(join(left, 'asset.txt'), join(left, 'linked.txt'));
    expect(() => inventoryTree(left)).toThrow(
      'package payload contains a symbolic link: linked.txt',
    );
  });

  it('binds packed payload bytes to a real source candidate and rejects drift', () => {
    const source = temporaryRoot();
    const packed = temporaryRoot();
    mkdirSync(join(source, 'lib'));
    mkdirSync(join(packed, 'lib'));
    writeFileSync(join(source, 'lib', 'index.mjs'), 'export const value = 1;\n');
    writeFileSync(join(packed, 'lib', 'index.mjs'), 'export const value = 1;\n');

    const proof = verifyPackedSourceParity(source, packed, ['lib/index.mjs']);
    expect(proof.count).toBe(1);
    expect(proof.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);

    writeFileSync(join(packed, 'lib', 'index.mjs'), 'export const value = 2;\n');
    expect(() => verifyPackedSourceParity(source, packed, ['lib/index.mjs'])).toThrow(
      'packed bytes differ from source candidate: lib/index.mjs',
    );
  });
});
