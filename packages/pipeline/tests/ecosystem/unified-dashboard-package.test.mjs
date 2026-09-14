import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(
  typeof process.env.PLANR_OPENPLANR_ROOT,
  'string',
  'run this paired test through npm run test:unified-dashboard:paired',
);
const openPlanrRoot = resolve(process.env.PLANR_OPENPLANR_ROOT);
const sourceDashboardRoot = join(openPlanrRoot, 'dist/dashboard');
let packageFixtureRoot;
let dashboardRoot;
let installedOpenPlanrRoot;
let installedPipelineRoot;
let installedVerifierPath;

function runNpm(args, cwd, npmCache) {
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(process.execPath, [npmCli, ...args], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_cache: npmCache,
      },
    })
    : spawnSync('npm', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_cache: npmCache,
      },
    });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function packTo(sourceRoot, packDir, npmCache) {
  const report = JSON.parse(
    runNpm(
      ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
      sourceRoot,
      npmCache,
    ),
  );
  const filename = report[0]?.filename;
  assert.equal(typeof filename, 'string', `npm pack did not report an archive for ${sourceRoot}`);
  return join(packDir, filename);
}

before(() => {
  assert.equal(
    existsSync(join(sourceDashboardRoot, 'dashboard-manifest.json')),
    true,
    'OpenPlanr dist/dashboard must exist; run npm run build:dashboard in OpenPlanr',
  );
  packageFixtureRoot = mkdtempSync(join(tmpdir(), 'planr-unified-dashboard-products-'));
  const packDir = join(packageFixtureRoot, 'pack');
  const consumerDir = join(packageFixtureRoot, 'consumer');
  const npmCache = join(packageFixtureRoot, 'npm-cache');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });
  const openPlanrTarball = packTo(openPlanrRoot, packDir, npmCache);
  const pipelineTarball = packTo(root, packDir, npmCache);
  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'unified-dashboard-package-custody',
        private: true,
        type: 'module',
        dependencies: {
          openplanr: `file:${openPlanrTarball}`,
          'planr-pipeline': `file:${pipelineTarball}`,
        },
      },
      null,
      2,
    ),
  );
  runNpm(
    ['install', '--ignore-scripts', '--no-package-lock', '--prefer-offline'],
    consumerDir,
    npmCache,
  );
  installedOpenPlanrRoot = realpathSync(join(consumerDir, 'node_modules', 'openplanr'));
  installedPipelineRoot = realpathSync(join(consumerDir, 'node_modules', 'planr-pipeline'));
  assert.notEqual(installedOpenPlanrRoot, realpathSync(openPlanrRoot));
  assert.notEqual(installedPipelineRoot, realpathSync(root));
  installedVerifierPath = realpathSync(
    createRequire(join(consumerDir, 'package.json')).resolve('openplanr/dashboard-verifier'),
  );
  assert.equal(
    installedVerifierPath.startsWith(`${installedOpenPlanrRoot}${sep}`),
    true,
    'dashboard verifier must resolve from the installed OpenPlanr package',
  );
  dashboardRoot = join(installedOpenPlanrRoot, 'dist', 'dashboard');
});

after(() => {
  if (packageFixtureRoot) rmSync(packageFixtureRoot, { recursive: true, force: true });
});

function httpGet(port, path, headers = {}) {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolveRequest({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', rejectRequest);
    req.end();
  });
}

test('unified dashboard package serves every packed asset with a compatible bootstrap', {
  timeout: 120_000,
}, async () => {
  assert.equal(existsSync(dashboardRoot), true, 'packed OpenPlanr dashboard is missing');
  const verifyModule = await import(pathToFileURL(installedVerifierPath).href);
  const report = verifyModule.verifyDashboardAssets(dashboardRoot);
  assert.equal(report.ok, true, report.violations.join('; '));

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-unified-dashboard-package-'));
  const planrDir = join(temporaryRoot, 'project', '.planr');
  mkdirSync(planrDir, { recursive: true });
  writeFileSync(join(planrDir, 'config.json'), JSON.stringify({ projectName: 'Unified dashboard dogfood' }));

  const { createDashboardServer } = await import(
    pathToFileURL(join(installedPipelineRoot, 'lib/dashboard/server.mjs')).href
  );
  const dashboard = createDashboardServer({
    staticRoot: dashboardRoot,
    dashboardBuildId: report.buildId,
    planrDir,
    watch: false,
    getOperatingCommandGateway: () => null,
  });

  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
    });
    const bootstrap = await httpGet(port, '/api/bootstrap', { accept: 'application/json' });
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.includes(temporaryRoot), false);
    const body = JSON.parse(bootstrap.body);
    assert.equal(body.compatibility.status, 'compatible');
    assert.equal(body.ui.buildId, report.buildId);
    assert.equal(body.capabilities.diagnostics.available, true);
    assert.equal(body.capabilities.operateCommands.available, false);

    for (const asset of report.assets) {
      const response = await httpGet(port, `/${asset.path}`);
      assert.equal(response.status, 200, asset.path);
    }
  } finally {
    await dashboard.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('unified dashboard bootstrap and asset reads stay within product budgets', {
  timeout: 120_000,
}, async () => {
  assert.equal(existsSync(dashboardRoot), true, 'packed OpenPlanr dashboard is missing');
  const manifest = JSON.parse(readFileSync(join(dashboardRoot, 'dashboard-manifest.json'), 'utf8'));
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-unified-dashboard-performance-'));
  const planrDir = join(temporaryRoot, 'project', '.planr');
  mkdirSync(planrDir, { recursive: true });
  writeFileSync(join(planrDir, 'config.json'), JSON.stringify({ projectName: 'Unified dashboard performance' }));

  const { createDashboardServer } = await import(
    pathToFileURL(join(installedPipelineRoot, 'lib/dashboard/server.mjs')).href
  );
  const dashboard = createDashboardServer({
    staticRoot: dashboardRoot,
    dashboardBuildId: manifest.buildId,
    planrDir,
    watch: false,
  });

  try {
    const port = await dashboard.listen(0, {
      env: { ...process.env, PLANR_HOME: join(temporaryRoot, 'home') },
    });

    const bootstrapSamples = [];
    for (let index = 0; index < 25; index += 1) {
      const started = performance.now();
      const response = await httpGet(port, '/api/bootstrap', { accept: 'application/json' });
      bootstrapSamples.push(performance.now() - started);
      assert.equal(response.status, 200);
    }
    bootstrapSamples.sort((left, right) => left - right);
    const bootstrapMedian = bootstrapSamples[Math.floor(bootstrapSamples.length / 2)];
    assert.ok(bootstrapMedian <= 200, `bootstrap median ${bootstrapMedian.toFixed(1)}ms exceeds 200ms`);

    const assetSamples = [];
    for (const asset of manifest.assets) {
      const started = performance.now();
      const response = await httpGet(port, `/${asset}`);
      assetSamples.push(performance.now() - started);
      assert.equal(response.status, 200, asset);
    }
    assetSamples.sort((left, right) => left - right);
    const assetMedian = assetSamples[Math.floor(assetSamples.length / 2)];
    assert.ok(assetMedian <= 200, `asset median ${assetMedian.toFixed(1)}ms exceeds 200ms`);
  } finally {
    await dashboard.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
