import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = join(dashboardRoot, 'src');
const importPattern = /^\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gmu;

function source(path) {
  return readFileSync(join(dashboardRoot, path), 'utf8');
}

function imports(path) {
  return [...source(path).matchAll(importPattern)].map((match) => match[1]);
}

function sourceFiles(directory = sourceRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}

test('composition roots depend on bounded domain facades', () => {
  const runtimeImports = imports('src/app/runtime-composition.tsx');
  assert.deepEqual(runtimeImports, [
    'react',
    './runtime/operate/index.js',
    './runtime/planning/index.js',
    './runtime/platform/index.js',
  ]);

  const routeImports = imports('src/features/shell/route-workspace.tsx');
  assert.equal(routeImports.length, 9);
  assert(routeImports.includes('./routes/operate/index.js'));
  assert(routeImports.includes('./routes/planning/index.js'));
  assert.equal(
    routeImports.some((specifier) => /^\.\.\/(?:operate|planning)\//u.test(specifier)),
    false,
    'the shell composition root must not reach through a feature facade',
  );

  const liveImports = imports('src/features/operate/operate-live-routes.tsx');
  assert.deepEqual(liveImports, [
    'react',
    '../../design-system/components/index.js',
    './live/index.js',
  ]);
});

test('dashboard source files keep import fan-in bounded', () => {
  const violations = sourceFiles()
    .map((path) => ({
      path: relative(dashboardRoot, path),
      imports: [...readFileSync(path, 'utf8').matchAll(importPattern)].length,
    }))
    .filter(({ imports: count }) => count > 12);

  assert.deepEqual(violations, []);
});

test('composition facades are explicit registries, not wildcard barrels', () => {
  const facadePaths = [
    'src/app/runtime/operate/index.ts',
    'src/app/runtime/planning/index.ts',
    'src/app/runtime/platform/index.ts',
    'src/features/operate/live/index.ts',
    'src/features/shell/routes/operate/index.ts',
    'src/features/shell/routes/planning/index.ts',
  ];

  for (const path of facadePaths) {
    const contents = source(path);
    assert.equal(contents.includes('export *'), false, `${path} must use explicit exports`);
    assert(
      contents.includes('Object.freeze') || contents.includes('resolvePlanningRoutePage'),
      `${path} must expose an explicit registry or resolver`,
    );
    assert(imports(path).length <= 10, `${path} imports too many owner leaves`);
  }
});
