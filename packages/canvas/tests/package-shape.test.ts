import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const requireCanvas = createRequire(new URL('../package.json', import.meta.url));

const entries = [
  ['@openplanr/canvas', './src/index'],
  ['@openplanr/canvas/react', './src/react/index'],
  ['@openplanr/canvas/testing', './src/testing/index'],
] as const;

describe('package shape', () => {
  it('creates and uses a detached controller without a browser', async () => {
    const { createCanvas } = await import('@openplanr/canvas');
    const controller = createCanvas({ label: 'Server canvas' });
    controller.setCamera({ x: 5, y: 10, zoom: 2 });
    expect(controller.worldToScreen({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(controller.getCamera()).toEqual({ x: 5, y: 10, zoom: 2 });
    controller.detach();
    controller.destroy();
  });
  it('stays private and includes a README', () => {
    expect(manifest.private).toBe(true);
    expect(existsSync(new URL('../README.md', import.meta.url))).toBe(true);
  });

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
      const values =
        specifier === '@openplanr/canvas'
          ? [
              'cameraFromScreenTranslate',
              'cameraToScreenTranslate',
              'createCanvas',
              'drawCameraOverview',
              'drawMinimap',
              'minimapToWorld',
            ]
          : specifier === '@openplanr/canvas/testing'
            ? ['generateLayeredGraph', 'generateSvgDiagram', 'percentile95', 'rendererFrameWork']
            : [];
      expect(Object.keys(entry).sort()).toEqual(values);
      const types =
        specifier === '@openplanr/canvas'
          ? [
              'Breakpoint',
              'Camera',
              'CanvasEdge',
              'CanvasController',
              'CanvasElements',
              'CanvasEvents',
              'CanvasLevel',
              'CanvasNode',
              'CanvasOptions',
              'ChromeSurface',
              'Diagnostic',
              'NodeId',
              'MinimapTransform',
              'OverviewMetrics',
              'OverviewStyle',
              'Point',
              'Rect',
              'WorldElement',
            ]
          : specifier === '@openplanr/canvas/testing'
            ? [
                'CanvasFixture',
                'FixtureEdge',
                'FixtureNode',
                'RendererTraceEvent',
                'RendererTraceMarks',
              ]
            : [];
      const path = resolve(packageRoot, `${target}.d.mts`);
      const program = ts.createProgram([path], { module: ts.ModuleKind.NodeNext });
      const source = program.getSourceFile(path);
      if (!source) throw new Error(`Missing declaration ${path}`);
      const checker = program.getTypeChecker();
      const symbol = checker.getSymbolAtLocation(source);
      const names = symbol
        ? checker
            .getExportsOfModule(symbol)
            .map((entry) => entry.name)
            .sort()
        : [];
      expect(names).toEqual([...values, ...types].sort());
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
