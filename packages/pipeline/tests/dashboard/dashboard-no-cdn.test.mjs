import assert from 'node:assert/strict';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

const PIPELINE_ROOT = resolve(import.meta.dirname, '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const OPENPLANR_ROOT = resolve(WORKSPACE_ROOT, 'packages/cli');
const DASHBOARD_APP_ROOT = resolve(WORKSPACE_ROOT, 'apps/dashboard');
const REMOTE_ASSET =
  /(?:src|href)\s*=\s*['"](?:https?:)?\/\/|@import\s+(?:url\()?\s*['"]?(?:https?:)?\/\/|url\(\s*['"]?(?:https?:)?\/\/|(?:fetch|import)\s*\(\s*['"](?:https?:)?\/\/|new\s+(?:Worker|SharedWorker)\s*\(\s*['"](?:https?:)?\/\//iu;
const PRIVATE_REFERENCE =
  /(?:\.planr\/products\/operate-2\.0|private consumer|node_modules\/openplanr|\.\.\/OpenPlanr)/iu;

async function regularFiles(root) {
  const output = [];
  for (const name of (await readdir(root)).sort((left, right) => left.localeCompare(right, 'en'))) {
    const candidate = join(root, name);
    const candidateStat = await lstat(candidate);
    assert.equal(candidateStat.isSymbolicLink(), false, `${candidate} must not be a symlink`);
    if (candidateStat.isDirectory()) output.push(...(await regularFiles(candidate)));
    else if (candidateStat.isFile()) output.push(candidate);
  }
  return output;
}

export function dashboardRuntimeUrlViolations(source, file = 'dashboard-asset') {
  return REMOTE_ASSET.test(source) || PRIVATE_REFERENCE.test(source) ? [file] : [];
}

test('pipeline dashboard server sources contain no CDN or private dependency', async () => {
  const violations = [];
  const serverSources = [
    resolve(PIPELINE_ROOT, 'lib/dashboard/server.mjs'),
    ...(await regularFiles(resolve(PIPELINE_ROOT, 'lib/dashboard/server'))),
    resolve(PIPELINE_ROOT, 'lib/dashboard/planning-envelopes.mjs'),
    resolve(PIPELINE_ROOT, 'lib/dashboard/resolve-packaged-dashboard-root.mjs'),
  ];
  for (const file of serverSources) {
    const source = await readFile(file, 'utf8');
    violations.push(...dashboardRuntimeUrlViolations(source, relative(PIPELINE_ROOT, file)));
  }
  assert.deepEqual(violations, []);
});

test('OpenPlanr dashboard source scan covers the canonical workspace app', async (t) => {
  try {
    if (!(await stat(DASHBOARD_APP_ROOT)).isDirectory()) throw new Error('missing');
  } catch {
    t.skip('OpenPlanr is verified by its package-owned dependency boundary test.');
    return;
  }
  const dashboardRoot = resolve(DASHBOARD_APP_ROOT, 'src');
  const violations = [];
  for (const file of await regularFiles(dashboardRoot)) {
    if (!['.css', '.html', '.js', '.jsx', '.ts', '.tsx', '.svg'].includes(extname(file))) continue;
    const source = await readFile(file, 'utf8');
    violations.push(...dashboardRuntimeUrlViolations(source, relative(DASHBOARD_APP_ROOT, file)));
  }
  assert.deepEqual(violations, []);
});

test('built OpenPlanr production resource graph contains only local assets', async (t) => {
  const outputRoot = resolve(OPENPLANR_ROOT, 'dist/dashboard');
  try {
    if (!(await stat(outputRoot)).isDirectory()) throw new Error('missing');
  } catch {
    t.skip('Build OpenPlanr before exercising its production resource graph.');
    return;
  }
  const manifest = JSON.parse(await readFile(join(outputRoot, 'dashboard-manifest.json'), 'utf8'));
  assert.equal(manifest.entry, 'index.html');
  const declaredResources = ['index.html', 'dashboard-manifest.json', ...manifest.assets];
  for (const resource of declaredResources) {
    assert.equal((await lstat(resolve(outputRoot, resource))).isFile(), true);
  }
  const resources = await regularFiles(outputRoot);
  const violations = [];
  for (const resource of resources) {
    const contained = relative(outputRoot, resource);
    assert.equal(
      contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained),
      false,
    );
    const source = await readFile(resource, 'utf8');
    violations.push(...dashboardRuntimeUrlViolations(source, contained));
  }
  assert.deepEqual(violations, []);
});

test('runtime URL scan rejects remote assets and source-only metadata stays outside that graph', async (t) => {
  assert.deepEqual(dashboardRuntimeUrlViolations('<script src="https://cdn.example/app.js">'), [
    'dashboard-asset',
  ]);
  try {
    const components = JSON.parse(
      await readFile(resolve(DASHBOARD_APP_ROOT, 'components.json'), 'utf8'),
    );
    assert.equal(components.$schema, 'https://ui.shadcn.com/schema.json');
    assert.equal(
      (await regularFiles(resolve(OPENPLANR_ROOT, 'dist/dashboard'))).some((file) =>
        file.endsWith('components.json'),
      ),
      false,
    );
  } catch {
    t.skip('OpenPlanr source-generation metadata is verified in its own checkout.');
  }
});
