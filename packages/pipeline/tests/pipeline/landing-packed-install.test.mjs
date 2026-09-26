import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';
import { runTestFileInOwnerPty } from './helpers/landing-owner-pty.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function entries(root) {
  const found = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      found.push(path);
      if (entry.isDirectory() && !lstatSync(path).isSymbolicLink()) visit(path);
    }
  };
  visit(root);
  return found;
}

test('fresh packed landing install is regular-file, root-API exact, ambient-isolated, and byte-current', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'planr-landing-packed-'));
  const archives = join(temporary, 'archives');
  const extracted = join(temporary, 'extracted');
  const cache = join(temporary, 'npm-cache');
  mkdirSync(archives, { recursive: true });
  mkdirSync(extracted, { recursive: true });
  mkdirSync(cache, { recursive: true });
  const packed = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', archives], {
      cwd: sourceRoot,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: cache },
    }),
  );
  assert.equal(packed.length, 1);
  const archive = join(archives, packed[0].filename);
  execFileSync('tar', ['-xzf', archive, '-C', extracted]);
  const packageRoot = join(extracted, 'package');
  assert.equal(lstatSync(packageRoot).isDirectory(), true);
  const packedEntries = entries(packageRoot);
  assert.deepEqual(
    packedEntries.filter((path) => lstatSync(path).isSymbolicLink()),
    [],
  );
  assert.deepEqual(
    packedEntries.filter((path) => {
      const stat = lstatSync(path);
      return !stat.isDirectory() && !stat.isFile();
    }),
    [],
  );

  for (const dependency of ['@noble/hashes', 'entities', 'esbuild', 'pako', 'parse5']) {
    const target = join(packageRoot, 'node_modules', dependency);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(resolveWorkspaceDependencyRoot(dependency), target, {
      dereference: true,
      recursive: true,
    });
  }

  const publicPipeline = await import(
    pathToFileURL(join(packageRoot, 'lib/pipeline/index.mjs')).href
  );
  for (const name of [
    'advanceLanding',
    'assertLandingWorkflowCatalog',
    'assertLandingWorkflowManifest',
    'bindLandingPlan',
    'createLandingOwnerRuntimeHost',
    'inspectShipClosureForLanding',
    'landingStatus',
    'prepareLanding',
    'previewLandingDocket',
    'readLandingOperationRegistry',
    'readLandingWorkflowCatalog',
    'readLandingWorkflowManifest',
    'showLanding',
  ])
    assert.equal(typeof publicPipeline[name], 'function', `missing packed root API ${name}`);
  for (const name of [
    'createLandingTrustedRuntimeHost',
    'issueLandingOwnerConfirmation',
    'createLandingEvent',
    'createLandingPhaseReceipt',
    'createLandingReceipt',
  ])
    assert.equal(
      Object.hasOwn(publicPipeline, name),
      false,
      `authority API leaked at root: ${name}`,
    );

  const manifestPath = join(
    packageRoot,
    'conformance/fixtures/landing-workflow/generated-assets.json',
  );
  const manifest = publicPipeline.readLandingWorkflowManifest();
  const expectedPaths = [
    'lib/pipeline/landing.mjs',
    'lib/pipeline/landing.d.mts',
    'schemas/v1.2.0/landing-workflow-catalog.schema.json',
    'registry/landing-workflows.json',
  ];
  assert.deepEqual(
    manifest.assets.map(({ path }) => path),
    expectedPaths,
  );
  for (const asset of manifest.assets) {
    const packedBytes = readFileSync(join(packageRoot, asset.path));
    const sourceBytes = readFileSync(join(sourceRoot, asset.path));
    assert.equal(lstatSync(join(packageRoot, asset.path)).isFile(), true, asset.path);
    assert.equal(digest(packedBytes), asset.digest, `${asset.path}: manifest digest`);
    assert.deepEqual(packedBytes, sourceBytes, `${asset.path}: packed bytes`);
  }
  assert.deepEqual(
    publicPipeline.readLandingWorkflowManifest().assets.map(({ path }) => path),
    expectedPaths,
  );

  const landingModuleAsset = manifest.assets.find(
    ({ path }) => path === 'lib/pipeline/landing.mjs',
  );
  assert.ok(landingModuleAsset);
  const landingModulePath = join(packageRoot, landingModuleAsset.path);
  assert.equal(lstatSync(landingModulePath).isFile(), true);
  assert.equal(lstatSync(landingModulePath).isSymbolicLink(), false);
  assert.equal(digest(readFileSync(landingModulePath)), landingModuleAsset.digest);
  const landingFileModule = await import(pathToFileURL(landingModulePath).href);
  assert.equal(Object.hasOwn(landingFileModule, 'createLandingTrustedRuntimeHost'), false);
  assert.equal(typeof landingFileModule.createLandingOwnerRuntimeHost, 'function');
  const rootTypes = readFileSync(join(packageRoot, 'lib/pipeline/index.d.mts'), 'utf8');
  const landingTypes = readFileSync(join(packageRoot, 'lib/pipeline/landing.d.mts'), 'utf8');
  assert.doesNotMatch(rootTypes, /createLandingTrustedRuntimeHost/u);
  assert.doesNotMatch(landingTypes, /createLandingTrustedRuntimeHost/u);
  assert.match(rootTypes, /createLandingOwnerRuntimeHost/u);
  assert.match(landingTypes, /createLandingOwnerRuntimeHost/u);

  let nonTtyCallbackCalls = 0;
  const nonTtyCallbacks = {
    snapshot: async () => {
      nonTtyCallbackCalls += 1;
    },
    commitIntent: async () => {
      nonTtyCallbackCalls += 1;
    },
    dispatch: async () => {
      nonTtyCallbackCalls += 1;
    },
    reconcile: async () => {
      nonTtyCallbackCalls += 1;
    },
    commitOutcome: async () => {
      nonTtyCallbackCalls += 1;
    },
  };
  for (const bridge of [
    publicPipeline.createLandingOwnerRuntimeHost,
    landingFileModule.createLandingOwnerRuntimeHost,
  ]) {
    assert.throws(
      () => bridge(nonTtyCallbacks),
      (error) => error?.code === 'E_LANDING_OWNER_INTERACTIVE_REQUIRED',
    );
  }
  assert.equal(nonTtyCallbackCalls, 0);

  const packedOwnerTest = join(temporary, 'packed-owner-advance.test.mjs');
  const fixtureModuleUrl = pathToFileURL(join(sourceRoot, 'tests/pipeline/landing.test.mjs')).href;
  const packedRootUrl = pathToFileURL(join(packageRoot, 'lib/pipeline/index.mjs')).href;
  writeFileSync(
    packedOwnerTest,
    [
      "import assert from 'node:assert/strict';",
      "import { test } from 'node:test';",
      `import { landingFixture, memoryHost } from ${JSON.stringify(fixtureModuleUrl)};`,
      `const publicPipeline = await import(${JSON.stringify(packedRootUrl)});`,
      "test('packed named-root owner bridge advances once', async () => {",
      '  const fixture = landingFixture(publicPipeline);',
      '  const runtime = memoryHost(fixture.plan, { pipeline: publicPipeline });',
      '  const result = await publicPipeline.advanceLanding({',
      '    host: runtime.host, plan: fixture.plan, operationId: fixture.operation.operationId,',
      "    now: '2026-08-25T10:00:00.000Z',",
      '  });',
      "  assert.equal(result.landingReceipt.status, 'landed');",
      '  assert.equal(runtime.state.dispatches, 1);',
      '  assert.equal(runtime.state.reconciliations, 0);',
      '});',
      '',
    ].join('\n'),
  );
  const packedOwnerResult = await runTestFileInOwnerPty(packedOwnerTest, {
    choices: ['confirm'],
  });
  assert.equal(packedOwnerResult.answeredOwnerPrompts, 1);
  assert.equal(packedOwnerResult.answeredChoicePrompts, 1);

  const exportConsumer = join(temporary, 'export-consumer');
  const installedPackage = join(exportConsumer, 'node_modules', 'planr-pipeline');
  mkdirSync(dirname(installedPackage), { recursive: true });
  cpSync(packageRoot, installedPackage, { dereference: true, recursive: true });
  writeFileSync(
    join(exportConsumer, 'package.json'),
    JSON.stringify({
      name: 'landing-export-boundary-consumer',
      private: true,
      type: 'module',
    }),
  );
  const deepImport = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        "try { await import('planr-pipeline/lib/pipeline/landing.mjs'); process.exit(2); }",
        "catch (error) { if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') process.exit(3); }",
      ].join('\n'),
    ],
    { cwd: exportConsumer, encoding: 'utf8' },
  );
  assert.equal(deepImport.status, 0, deepImport.stderr || deepImport.stdout);

  const typescriptPath = process.env.PLANR_TSC_PATH;
  if (typescriptPath) {
    const rootImportPath = join(exportConsumer, 'root-import.mts');
    writeFileSync(
      rootImportPath,
      [
        "import { createLandingTrustedRuntimeHost } from 'planr-pipeline';",
        'void createLandingTrustedRuntimeHost;',
        '',
      ].join('\n'),
    );
    const typecheck = spawnSync(
      process.execPath,
      [
        typescriptPath,
        '--noEmit',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        rootImportPath,
      ],
      { cwd: exportConsumer, encoding: 'utf8' },
    );
    assert.notEqual(typecheck.status, 0, 'root issuer import must fail TypeScript compilation');
    assert.match(
      `${typecheck.stdout}\n${typecheck.stderr}`,
      /TS(?:2305|2724).*createLandingTrustedRuntimeHost/u,
    );
  }

  const poisonRoot = join(temporary, 'consumer', 'node_modules', 'planr-pipeline');
  mkdirSync(poisonRoot, { recursive: true });
  writeFileSync(
    join(poisonRoot, 'package.json'),
    JSON.stringify({
      name: 'planr-pipeline',
      version: '99.0.0',
      type: 'module',
      exports: './index.mjs',
    }),
  );
  writeFileSync(join(poisonRoot, 'index.mjs'), "throw new Error('ambient poison loaded');\n");
  const child = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      [
        `const value = await import(${JSON.stringify(packedRootUrl)});`,
        "if (value.readLandingWorkflowCatalog().workflow.workflowId !== 'planr-land') process.exit(2);",
        "if (Object.hasOwn(value, 'createLandingTrustedRuntimeHost')) process.exit(3);",
      ].join('\n'),
    ],
    { cwd: dirname(dirname(poisonRoot)), encoding: 'utf8' },
  );
  assert.equal(child, '');

  const packedSources = [
    readFileSync(join(packageRoot, 'lib/pipeline/landing.mjs'), 'utf8'),
    readFileSync(join(packageRoot, 'lib/pipeline/index.mjs'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(
    packedSources,
    /\/Users\/|node_modules\/planr-pipeline|require\.resolve|candidateRoots/u,
  );
  assert.doesNotMatch(
    packedSources,
    /NODE_TEST_CONTEXT|PLANR_LANDING_OWNER_PTY_CHILD|Symbol\.for|landing-owner-pty/u,
  );
  assert.equal(relative(packageRoot, manifestPath).startsWith('..'), false);
  assert.match(digest(readFileSync(archive)), /^sha256:[a-f0-9]{64}$/u);
});
