import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const requireCanvas = createRequire(new URL('../package.json', import.meta.url));

const entries = [
  ['@openplanr/canvas', './src/index'],
  ['@openplanr/canvas/react', './src/react/index'],
  ['@openplanr/canvas/testing', './src/testing/index'],
] as const;

describe('public package shape', () => {
  it('exposes compiled modules and the structural stylesheet', async () => {
    expect(manifest.exports).toEqual({
      '.': { types: './src/index.d.mts', import: './src/index.mjs' },
      './react': { types: './src/react/index.d.mts', import: './src/react/index.mjs' },
      './testing': { types: './src/testing/index.d.mts', import: './src/testing/index.mjs' },
      './styles.css': './src/styles.css',
    });
    for (const [specifier, target] of entries) {
      expect(fileURLToPath(import.meta.resolve(specifier))).toBe(
        resolve(packageRoot, `${target}.mjs`),
      );
      const entry = await import(specifier);
      expect(Object.keys(entry)).toEqual([]);
      expect(readFileSync(resolve(packageRoot, `${target}.d.mts`), 'utf8')).toContain('export {}');
    }
    expect(fileURLToPath(import.meta.resolve('@openplanr/canvas/styles.css'))).toBe(
      resolve(packageRoot, 'src/styles.css'),
    );
  });

  it('keeps React optional and declares no runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.optionalDependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies).toEqual({ react: '^19.2.0', 'react-dom': '^19.2.0' });
    expect(manifest.peerDependenciesMeta).toEqual({
      react: { optional: true },
      'react-dom': { optional: true },
    });
    expect(manifest.sideEffects).toEqual(['**/*.css']);
    expect(manifest.publishConfig).toEqual({ access: 'public' });
  });

  it('keeps the entire compiled core import graph inside the package', async () => {
    const { build }: typeof import('esbuild') = requireCanvas('esbuild');
    const result = await build({
      absWorkingDir: packageRoot,
      entryPoints: [fileURLToPath(import.meta.resolve('@openplanr/canvas'))],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      treeShaking: false,
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    expect(Object.keys(result.metafile.inputs).length).toBeGreaterThan(0);
    for (const [path, input] of Object.entries(result.metafile.inputs)) {
      expect(resolve(packageRoot, path).startsWith(`${resolve(packageRoot, 'src')}${sep}`)).toBe(
        true,
      );
      expect(path).not.toMatch(/(?:^|[/\\])(?:react|react-dom)(?:[/\\]|$)/u);
      for (const dependency of input.imports) expect(dependency.external).not.toBe(true);
    }
  });
});
