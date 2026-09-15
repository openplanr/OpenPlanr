import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const temp = mkdtempSync(join(tmpdir(), 'planr-artifact-pack-'));
const npmCli = process.env.npm_execpath;

function resvgPlatformPackage() {
  if (process.platform === 'darwin') return `@resvg/resvg-js-darwin-${process.arch}`;
  if (process.platform === 'linux') {
    const libc = process.report?.getReport()?.header?.glibcVersionRuntime ? 'gnu' : 'musl';
    return `@resvg/resvg-js-linux-${process.arch}-${libc}`;
  }
  throw new Error(`Unsupported packed diagram-renderer test platform: ${process.platform}-${process.arch}`);
}

after(() => rmSync(temp, { recursive: true, force: true }));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_cache: join(temp, 'npm-cache'),
    },
    ...options,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function runNpm(args, options = {}) {
  assert.ok(npmCli, 'npm_execpath must identify npm-cli.js during the npm test run');
  return run(process.execPath, [npmCli, ...args], options);
}

test(`packed ${packageVersion} package contains the portable artifact release boundary`, () => {
  const packed = JSON.parse(runNpm([
    'pack', '--json', '--ignore-scripts', '--pack-destination', temp,
  ]).stdout)[0];
  const files = new Set(packed.files.map(({ path }) => path));
  const required = [
    'conformance/verify-artifact-review.mjs',
    'docs/artifact-review.md',
    'docs/generated/adapters.md',
    'THIRD_PARTY-DIAGRAM-NOTICES.md',
    'fixtures/diagram/grammars/flowchart.planr-diagram.json',
    'lib/artifact/index.mjs',
    'lib/artifact/diagram/index.d.mts',
    'lib/artifact/diagram/index.mjs',
    'lib/artifact/diagram/runtime.mjs',
    'lib/artifact/review-server.mjs',
    'lib/artifact/ui/generated/artifact-shell-assets.json',
    'lib/artifact/ui/generated/artifact-theme.css',
    'lib/artifact/ui/stage-payload.mjs',
    'lib/design-engine/artifact-adapter.mjs',
    'lib/design-engine/board-adapter.mjs',
    'schemas/v1.1.0/artifact-envelope.schema.json',
    'schemas/v1.1.0/artifact-paste.schema.json',
    'schemas/v1.1.0/artifact-room-event.schema.json',
    'schemas/v1.1.0/artifact-review.schema.json',
    'schemas/v1.1.0/artifact-theme.schema.json',
    'schemas/v1.6.0/diagram-manifest.schema.json',
    'registry/v1.6.0/diagram-grammars.json',
    'templates/artifact-review-shell.html',
    'templates/artifact-review-stage.js',
    'templates/design/design-board-adapter.js',
  ];
  for (const path of required) assert.equal(files.has(path), true, `missing ${path}`);
  for (const path of files) {
    assert.doesNotMatch(path, /^docs\/adrs?\//u);
    assert.doesNotMatch(path, /^(?:\.env(?:\.|\/|$)|\.planr\/|tests\/)/);
  }
  assert.equal(packed.version, packageVersion);
  assert.equal(packed.name, 'planr-pipeline');

  const installRoot = join(temp, 'install');
  const dependencyRoot = join(temp, 'dependencies');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(dependencyRoot, { recursive: true });
  const localDependencies = {};
  for (const dependency of [
    '@expo-google-fonts/inter',
    '@noble/hashes',
    '@resvg/resvg-js',
    resvgPlatformPackage(),
    'entities',
    'esbuild',
    'pako',
    'parse5',
  ]) {
    const [dependencyPack] = JSON.parse(runNpm([
      'pack', '--ignore-scripts', '--json', '--pack-destination', dependencyRoot,
    ], { cwd: resolveWorkspaceDependencyRoot(dependency) }).stdout);
    localDependencies[dependency] = `file:${join(dependencyRoot, dependencyPack.filename)}`;
  }
  writeFileSync(join(installRoot, 'package.json'), JSON.stringify({
    name: 'artifact-packed-install-consumer',
    private: true,
    type: 'module',
    dependencies: localDependencies,
  }));
  const tarball = join(temp, packed.filename);
  runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev',
    '--omit=optional', '--no-package-lock', '--offline', tarball,
  ], { cwd: installRoot });

  const packageRoot = join(installRoot, 'node_modules', 'planr-pipeline');
  const installedBin = join(packageRoot, 'bin', 'planr-pipeline.mjs');
  const binSmoke = run(process.execPath, [installedBin, '--help'], { cwd: installRoot });
  assert.match(binSmoke.stdout, /planr-pipeline/);
  const importSmoke = run(process.execPath, [
    '--input-type=module',
    '--eval',
    "import fs from 'node:fs'; import * as p from 'planr-pipeline'; const root=new URL('./node_modules/planr-pipeline/', import.meta.url); const diagram=await import(new URL('lib/artifact/diagram/index.mjs', root)); const names=['bundleArtifact','createArtifactEnvelope','encodeArtifactFragment','decodeArtifactFragment','encryptArtifactPayload','decryptArtifactPayload','startArtifactReview','exportArtifactReviewSession','createReviewLink','createReviewLinkPreview','decodeReviewLink','importArtifactReview','mergeArtifactFeedback','createLiveReviewRoom','appendLiveRoomEvent','hydrateLiveReviewRoom','reduceLiveRoomEvents']; if(names.some((name)=>typeof p[name]!=='function') || typeof diagram.renderDiagramOutputs!=='function') process.exit(2); const document=JSON.parse(fs.readFileSync(new URL('fixtures/diagram/grammars/flowchart.planr-diagram.json', root))); const output=diagram.renderDiagramOutputs(document); const png=diagram.inspectDiagramPng(output.png.bytes); if(!output.svg.startsWith('<svg') || png.width<320 || png.height<320) process.exit(3);",
  ], {
    cwd: installRoot,
    env: {
      ...process.env,
      HOME: join(temp, 'home'),
      USERPROFILE: join(temp, 'home'),
      npm_config_cache: join(temp, 'npm-cache'),
    },
  });
  assert.equal(importSmoke.status, 0);

  const doctor = run(process.execPath, [join(packageRoot, 'scripts', 'doctor.mjs'), '--json'], {
    cwd: installRoot,
    env: {
      ...process.env,
      HOME: join(temp, 'home'),
      USERPROFILE: join(temp, 'home'),
      OPENPLANR_DOCTOR_PACKAGE_MODE: '1',
      npm_config_cache: join(temp, 'npm-cache'),
    },
  });
  const report = JSON.parse(doctor.stdout);
  assert.equal(report.ok, true);
  assert.ok(report.checks.some(({ id }) => id === 'artifact.assets-present'));
  assert.ok(report.checks.some(({ id }) => id === 'artifact.public-exports'));

  for (const promptRoot of ['.claude-plugin', 'adapters', 'agents', 'commands', 'plugins', 'skills']) {
    assert.equal(
      existsSync(join(packageRoot, promptRoot)),
      false,
      `${promptRoot} must not ship in the runtime package`,
    );
  }
});
