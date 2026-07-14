import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = mkdtempSync(join(tmpdir(), 'planr-artifact-pack-'));
const npmCli = process.env.npm_execpath;

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

test('packed 0.26.2 package contains the portable artifact release boundary', () => {
  const packed = JSON.parse(runNpm([
    'pack', '--json', '--ignore-scripts', '--pack-destination', temp,
  ]).stdout)[0];
  const files = new Set(packed.files.map(({ path }) => path));
  const required = [
    'adapters/codex/skills/planr-artifact/SKILL.md',
    'conformance/verify-artifact-review.mjs',
    'docs/adrs/ADR-005-artifact-review-sharing-security.md',
    'docs/artifact-review.md',
    'docs/generated/adapters.md',
    'lib/artifact/index.mjs',
    'lib/artifact/review-server.mjs',
    'lib/artifact/ui/generated/artifact-shell-assets.json',
    'lib/artifact/ui/generated/artifact-theme.css',
    'lib/design-engine/artifact-adapter.mjs',
    'lib/design-engine/board-adapter.mjs',
    'schemas/v1.1.0/artifact-envelope.schema.json',
    'schemas/v1.1.0/artifact-paste.schema.json',
    'schemas/v1.1.0/artifact-review.schema.json',
    'schemas/v1.1.0/artifact-theme.schema.json',
    'templates/artifact-review-shell.html',
    'templates/artifact-review-stage.js',
    'templates/design/design-board-adapter.js',
  ];
  for (const path of required) assert.equal(files.has(path), true, `missing ${path}`);
  for (const path of files) {
    assert.doesNotMatch(path, /^(?:\.env(?:\.|\/|$)|\.planr\/|tests\/)/);
  }
  assert.equal(packed.version, '0.26.2');
  assert.equal(packed.name, 'planr-pipeline');

  const installRoot = join(temp, 'install');
  mkdirSync(installRoot, { recursive: true });
  const tarball = join(temp, packed.filename);
  runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev',
    '--no-package-lock', '--prefer-offline', tarball,
  ], { cwd: installRoot });

  const packageRoot = join(installRoot, 'node_modules', 'planr-pipeline');
  const installedBin = join(packageRoot, 'bin', 'planr-pipeline.mjs');
  const binSmoke = run(process.execPath, [installedBin, '--help'], { cwd: installRoot });
  assert.match(binSmoke.stdout, /planr-pipeline/);
  const importSmoke = run(process.execPath, [
    '--input-type=module',
    '--eval',
    "import * as p from 'planr-pipeline'; const names=['bundleArtifact','createArtifactEnvelope','encodeArtifactFragment','decodeArtifactFragment','encryptArtifactPayload','decryptArtifactPayload','startArtifactReview','exportArtifactReviewSession','createReviewLink','createReviewLinkPreview','decodeReviewLink','importArtifactReview','mergeArtifactFeedback']; if(names.some((name)=>typeof p[name]!=='function')) process.exit(2);",
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

  const portableText = [
    readFileSync(join(packageRoot, 'adapters', 'codex', 'skills', 'planr-artifact', 'SKILL.md'), 'utf8'),
    readFileSync(join(packageRoot, 'registry', 'adapters.json'), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(portableText, /CLAUDE_PLUGIN_ROOT|\b(?:Sonnet|Opus)\b|\bplanr-pipeline\s+(?:artifact|plan|ship)\b/);
});
