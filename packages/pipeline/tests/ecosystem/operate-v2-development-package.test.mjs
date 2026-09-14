import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkOperateRuntimePurity,
  packOperateV2DevelopmentSnapshot,
} from '../../scripts/check-operate-runtime-purity.mjs';
import { PROTECTED_USER_OWNED_PATHS } from '../../scripts/inventory-operate-surfaces.mjs';
import { OPERATE_RUNTIME_CONTRACT_KINDS } from '../../lib/protocol/loader.mjs';
import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-development-'));
const npmCache = join(temporaryRoot, 'npm-cache');

const DASHBOARD_PROTOCOL_CUSTODY = Object.freeze([
  'conformance/verify-unified-dashboard-absence.mjs',
  'docs/unified-dashboard-migration.md',
  'lib/dashboard/resolve-packaged-dashboard-root.mjs',
  'schemas/v1.2.0/dashboard-bootstrap.schema.json',
]);

const PROFESSIONAL_REVIEW_PACKAGE_CUSTODY = Object.freeze([
  'conformance/fixtures/professional-skills/generated-assets.json',
  'lib/pipeline/browser-qa-custody.d.mts',
  'lib/pipeline/browser-qa-custody.mjs',
  'lib/pipeline/browser-qa.d.mts',
  'lib/pipeline/browser-qa.mjs',
  'lib/pipeline/investigation-contracts.d.mts',
  'lib/pipeline/investigation-contracts.mjs',
  'lib/pipeline/investigation-identity.d.mts',
  'lib/pipeline/investigation-identity.mjs',
  'lib/pipeline/investigation-reducer.d.mts',
  'lib/pipeline/investigation-reducer.mjs',
  'lib/pipeline/investigation-runtime.d.mts',
  'lib/pipeline/investigation-runtime.mjs',
  'lib/pipeline/planning-review-identity.mjs',
  'lib/pipeline/planning-review-reducer.mjs',
  'lib/pipeline/planning-review.mjs',
  'lib/pipeline/professional-skills.d.mts',
  'lib/pipeline/professional-skills.mjs',
  'lib/pipeline/ship-risk.d.mts',
  'lib/pipeline/ship-risk.mjs',
  'registry/professional-skills.json',
  'registry/ship-review-specialists.json',
  'schemas/v1.0.0/spec.schema.json',
  'schemas/v1.0.0/task.schema.json',
  'schemas/v1.1.0/browser-qa-gate.schema.json',
  'schemas/v1.1.0/browser-qa-result.schema.json',
  'schemas/v1.1.0/browser-qa-session.schema.json',
  'schemas/v1.1.0/investigation-diagnosis.schema.json',
  'schemas/v1.1.0/investigation-event.schema.json',
  'schemas/v1.1.0/investigation-experiment.schema.json',
  'schemas/v1.1.0/investigation-fix.schema.json',
  'schemas/v1.1.0/investigation-hypothesis.schema.json',
  'schemas/v1.1.0/investigation-observation.schema.json',
  'schemas/v1.1.0/investigation-receipt.schema.json',
  'schemas/v1.1.0/investigation-record.schema.json',
  'schemas/v1.1.0/investigation-request.schema.json',
  'schemas/v1.1.0/planning-review-event.schema.json',
  'schemas/v1.1.0/planning-review-receipt.schema.json',
  'schemas/v1.1.0/planning-review-record.schema.json',
  'schemas/v1.1.0/planning-review-state.schema.json',
  'schemas/v1.1.0/professional-skills.schema.json',
  'schemas/v1.1.0/professional-specification.schema.json',
  'schemas/v1.1.0/ship-review-specialist-registry.schema.json',
  'schemas/v1.1.0/ship-risk-classification.schema.json',
  'schemas/v1.1.0/specialist-review-result.schema.json',
]);

const LIVE_EVIDENCE_LANDING_PACKAGE_CUSTODY = Object.freeze([
  'conformance/fixtures/landing-contracts-invalid.json',
  'conformance/fixtures/landing-contracts-valid.json',
  'conformance/fixtures/operating-runtime-v2/live-evidence-contracts-invalid.json',
  'conformance/fixtures/operating-runtime-v2/live-evidence-contracts-valid.json',
  'lib/protocol/live-evidence-v2.d.mts',
  'lib/protocol/live-evidence-v2.mjs',
  'lib/pipeline/landing-contract.d.mts',
  'lib/pipeline/landing-contract.mjs',
  'registry/landing-operations.json',
  'registry/live-evidence-providers.json',
  'schemas/v1.2.0/landing-confirmation.schema.json',
  'schemas/v1.2.0/landing-event.schema.json',
  'schemas/v1.2.0/landing-operation-registry.schema.json',
  'schemas/v1.2.0/landing-phase-receipt.schema.json',
  'schemas/v1.2.0/landing-plan.schema.json',
  'schemas/v1.2.0/landing-receipt.schema.json',
  'schemas/v2.0.0/operate-live-evidence-provider-registration.schema.json',
  'schemas/v2.0.0/operate-live-evidence-provider-registry.schema.json',
  'schemas/v2.0.0/operating-connector-checkpoint.schema.json',
  'schemas/v2.0.0/operating-evidence-observation.schema.json',
  'schemas/v2.0.0/operating-learning-receipt.schema.json',
  'schemas/v2.0.0/operating-live-evidence-consent-record.schema.json',
  'schemas/v2.0.0/operating-live-evidence-ingestion.schema.json',
  'schemas/v2.0.0/operating-measurement-plan.schema.json',
  'schemas/v2.0.0/operating-measurement-schedule-receipt.schema.json',
  'schemas/v2.0.0/operating-measurement-schedule.schema.json',
  'schemas/v2.0.0/operating-outcome-evaluation.schema.json',
]);

const LIVE_EVIDENCE_LANDING_SNAPSHOT_TESTS = Object.freeze([
  'tests/orchestration/operate-live-evidence-v2-property.test.mjs',
  'tests/pipeline/landing-contract.test.mjs',
  'tests/schema/landing-contracts.test.mjs',
  'tests/schema/operate-live-evidence-contracts-v2.test.mjs',
]);

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  const env = {
    ...process.env,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_cache: npmCache,
  };
  return npmCli
    ? run(process.execPath, [npmCli, ...args], { ...options, env: { ...env, ...options.env } })
    : run('npm', args, { ...options, env: { ...env, ...options.env } });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listMarkdownFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listMarkdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

function withoutMarkdownCode(markdown) {
  let fence = null;
  const visible = [];
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) {
      if (fence === null) fence = marker[0];
      else if (fence === marker[0]) fence = null;
      visible.push('');
      continue;
    }
    if (fence !== null || /^(?: {4}|\t)/.test(line)) {
      visible.push('');
      continue;
    }
    visible.push(line.replace(/(`+)(.*?)\1/g, ''));
  }
  return visible.join('\n');
}

function markdownDestinations(markdown) {
  const visible = withoutMarkdownCode(markdown);
  const destinations = [];
  for (let cursor = 0; cursor < visible.length - 1; cursor += 1) {
    if (visible[cursor] !== ']' || visible[cursor + 1] !== '(') continue;
    let escaped = false;
    let depth = 1;
    let end = cursor + 2;
    for (; end < visible.length; end += 1) {
      const character = visible[end];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\') {
        escaped = true;
        continue;
      }
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      if (depth === 0) break;
    }
    if (depth === 0) {
      destinations.push(visible.slice(cursor + 2, end));
      cursor = end;
    }
  }
  for (const match of visible.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>\n]+>|\S+)/gm)) {
    destinations.push(match[1]);
  }
  return destinations;
}

function localMarkdownTarget(rawDestination) {
  const raw = rawDestination.trim();
  if (!raw) return null;
  let destination;
  if (raw.startsWith('<')) {
    const close = raw.indexOf('>');
    destination = close === -1 ? raw.slice(1) : raw.slice(1, close);
  } else {
    let escaped = false;
    let end = raw.length;
    for (let index = 0; index < raw.length; index += 1) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (raw[index] === '\\') {
        escaped = true;
        continue;
      }
      if (/\s/.test(raw[index])) {
        end = index;
        break;
      }
    }
    destination = raw.slice(0, end);
  }
  destination = destination.replace(/\\([\\`*{}\[\]()#+.!_> -])/g, '$1');
  if (
    destination.startsWith('#')
    || destination.startsWith('//')
    || isAbsolute(destination)
    || /^[a-z][a-z0-9+.-]*:/i.test(destination)
  ) return null;
  const path = destination.split(/[?#]/, 1)[0];
  if (!path) return null;
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function assertPackagedMarkdownLinks(packageRoot) {
  const missing = [];
  const packageMarkdown = listMarkdownFiles(packageRoot);
  for (const document of packageMarkdown) {
    const documentPath = relative(packageRoot, document);
    for (const destination of markdownDestinations(readFileSync(document, 'utf8'))) {
      const localTarget = localMarkdownTarget(destination);
      if (localTarget === null) continue;
      const target = resolve(dirname(document), localTarget);
      const packageRelativeTarget = relative(packageRoot, target);
      const outsidePackage = packageRelativeTarget === '..'
        || packageRelativeTarget.startsWith(`..${sep}`)
        || isAbsolute(packageRelativeTarget);
      if (outsidePackage || !existsSync(target)) {
        missing.push(`${documentPath} -> ${localTarget}`);
      }
    }
  }
  assert.ok(packageMarkdown.length > 0, 'installed package must contain Markdown documents');
  assert.deepEqual(missing, [], `missing packaged Markdown link targets:\n${missing.join('\n')}`);
}

test('Operate 2.0 development package installs the clean typed contract without release semantics', { timeout: 180_000 }, async () => {
  const packageDestination = join(temporaryRoot, 'package');
  const packed = packOperateV2DevelopmentSnapshot(packageDestination, { sourceRoot: root });
  assert.equal(packed.ok, true);
  assert.equal(packed.packageName, 'planr-pipeline');
  assert.equal(packed.version, packageVersion);
  assert.match(packed.integrity, /^sha512-/);
  assert.match(packed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(packed.sourcePurity.ok, true);
  assert.equal(packed.tarballPurity.ok, true);

  const packedFiles = new Set(packed.files.map(({ path }) => path));
  const required = [
    'conformance/verify-operating-runtime-v2.mjs',
    'conformance/verify-operate-v2-contract-compilation.mjs',
    'conformance/verify-operate-v2-evidence.mjs',
    'conformance/verify-operate-v2-governed-execution.mjs',
    'conformance/verify-operate-v2-operating-intelligence.mjs',
    'conformance/verify-operate-v2-persistent-work.mjs',
    'docs/compatibility-matrix.md',
    'docs/protocol/operate-runtime-v2.md',
    ...DASHBOARD_PROTOCOL_CUSTODY,
    ...PROFESSIONAL_REVIEW_PACKAGE_CUSTODY,
    ...LIVE_EVIDENCE_LANDING_PACKAGE_CUSTODY,
    'lib/artifact/index.mjs',
    'lib/artifact/live-room.mjs',
    'lib/artifact/live-room-integrity.mjs',
    'lib/dashboard/closed-json-contract.mjs',
    'lib/dashboard/verified-json.d.mts',
    'lib/dashboard/verified-json.mjs',
    'lib/dashboard/operate-experience-reader.mjs',
    'lib/dashboard/operate-experience-reader.d.mts',
    'lib/dashboard/operate-experience-audit-display-contract.d.mts',
    'lib/dashboard/operate-experience-audit-display-contract.mjs',
    'lib/dashboard/operate-experience-display-contract.d.mts',
    'lib/dashboard/operate-experience-display-contract.mjs',
    'lib/dashboard/operate-experience-surface-contract.d.mts',
    'lib/dashboard/operate-experience-surface-contract.mjs',
    'lib/dashboard/generated/operate-experience-surface-schema-data.mjs',
    'lib/dashboard/graph-engine.mjs',
    'lib/dashboard/server.mjs',
    'lib/operate/runtime-foundation.d.mts',
    'lib/operate/runtime-foundation.mjs',
    'lib/operate/intelligence-input-bundle-v2.mjs',
    'lib/operate/intelligence-result-validator-v2.mjs',
    'lib/operate/result-packet-v2.d.mts',
    'lib/operate/result-packet-v2.mjs',
    'lib/protocol/generated/contract-package-inventory-v2.json',
    'lib/protocol/skill-source-contracts.mjs',
    'lib/operate/scheduler-v2.d.mts',
    'lib/operate/scheduler-v2.mjs',
    'lib/operate/extensions-v2.d.mts',
    'lib/operate/extensions-v2.mjs',
    'lib/operate/experience-projection-v2.d.mts',
    'lib/operate/experience-projection-v2.mjs',
    'lib/operate/governed-execution-v2.d.mts',
    'lib/operate/governed-execution-v2.mjs',
    'lib/operate/governed-recovery-v2.d.mts',
    'lib/operate/governed-recovery-v2.mjs',
    'lib/operate/execution-verification-v2.d.mts',
    'lib/operate/execution-verification-v2.mjs',
    'lib/operate/persistent-work-v2.d.mts',
    'lib/operate/persistent-work-v2.mjs',
    'lib/operate/planning-bridge-v2.d.mts',
    'lib/operate/planning-bridge-v2.mjs',
    'lib/operate/cycle-closure-v2.d.mts',
    'lib/operate/cycle-closure-v2.mjs',
    'lib/operate/evidence-artifact-v2.mjs',
    'lib/operate/evidence-filesystem-v2.mjs',
    'lib/operate/evidence-git-v2.mjs',
    'lib/operate/evidence-materialization-v2.d.mts',
    'lib/operate/evidence-materialization-v2.mjs',
    'lib/operate/evidence-planr-v2.mjs',
    'lib/operate/evidence-projections-v2.d.mts',
    'lib/operate/evidence-projections-v2.mjs',
    'lib/operate/evidence-registry-v2.d.mts',
    'lib/operate/evidence-registry-v2.mjs',
    'lib/operate/evidence-v2.d.mts',
    'lib/operate/evidence-v2.mjs',
    'lib/operate/persistent-work-projections-v2.d.mts',
    'lib/operate/persistent-work-projections-v2.mjs',
    'lib/pipeline/engine.mjs',
    'lib/pipeline/errors.mjs',
    'lib/pipeline/index.d.mts',
    'lib/pipeline/index.mjs',
    'lib/pipeline/operate-origin.mjs',
    'lib/pipeline/provenance.mjs',
    'schemas/v1.0.0/pipeline-shipped.schema.json',
    'schemas/v1.0.0/run-manifest.schema.json',
    'schemas/v1.1.0/artifact-room-descriptor.schema.json',
    'schemas/v1.1.0/artifact-room-event.schema.json',
    'schemas/v1.1.0/artifact-room-signed-event.schema.json',
    'schemas/v1.1.0/provenance-event.schema.json',
    'schemas/v1.2.0/dashboard-bootstrap.schema.json',
    'schemas/v1.2.0/operate-action-display-workspace.d.mts',
    'schemas/v1.2.0/operate-action-display-workspace.mjs',
    'schemas/v1.2.0/operate-action-display-workspace.schema.json',
    'schemas/v1.2.0/operate-cycle-display-workspace.d.mts',
    'schemas/v1.2.0/operate-cycle-display-workspace.mjs',
    'schemas/v1.2.0/operate-cycle-display-workspace.schema.json',
    'schemas/v1.2.0/operate-experience-display-surface.d.mts',
    'schemas/v1.2.0/operate-experience-display-surface.mjs',
    'schemas/v1.2.0/operate-experience-display-surface.schema.json',
    'schemas/v1.2.0/operate-experience-audit-display-surface.d.mts',
    'schemas/v1.2.0/operate-experience-audit-display-surface.mjs',
    'schemas/v1.2.0/operate-experience-audit-display-surface.schema.json',
    'schemas/v1.2.0/operate-experience-surface.d.mts',
    'schemas/v1.2.0/operate-experience-surface.mjs',
    'schemas/v1.2.0/operate-experience-surface.schema.json',
    'schemas/v1.2.0/operate-recovery-display-surface.d.mts',
    'schemas/v1.2.0/operate-recovery-display-surface.mjs',
    'schemas/v1.2.0/operate-recovery-display-surface.schema.json',
    'scripts/check-operate-runtime-purity.mjs',
  ];
  for (const kind of [
    'operating-cycle',
    'operating-cycle-input-binding',
    'operating-assignment',
    'operating-review',
    'operating-submission',
    'operating-artifact',
    'operating-event',
    'operating-runtime-state',
    'operating-checkpoint',
    'operate-allowed-action',
    'operate-api-envelope',
    'operate-tool-call',
    'operating-finding',
    'operating-decision',
    'operating-action',
    'operating-work-change-set',
    'operating-work-ledger',
    'operating-evidence-candidate',
    'operating-evidence-ref',
    'operating-evidence-resolution',
    'operate-evidence-provider-registration',
    'operate-evidence-resolver-registration',
    'operating-evidence-edge',
    'operating-evidence-graph',
    'operating-intelligence-input-bundle',
    'operating-review-read',
    'operating-review-receipt',
  ]) required.push(`schemas/v2.0.0/${kind}.schema.json`);
  for (const fixture of [
    'all-contracts-valid.json',
    'all-contracts-invalid.json',
    'binding-field-tamper-invalid.json',
    'deferred-assignment-kinds-invalid.json',
    'deferred-cycle-states-invalid.json',
    'deferred-triggers-invalid.json',
    'exact-bytes-valid.json',
    'persistent-work-valid.json',
    'persistent-work-invalid.json',
    'carry-forward-valid.json',
    'carry-forward-invalid.json',
    'persistent-work-cross-cycle.json',
    'evidence-artifact-valid.json',
    'evidence-artifact-invalid.json',
    'evidence-contracts-valid.json',
    'evidence-contracts-invalid.json',
    'evidence-filesystem-valid.json',
    'evidence-filesystem-invalid.json',
    'evidence-git-valid.json',
    'evidence-git-invalid.json',
    'evidence-graph-valid.json',
    'evidence-graph-invalid.json',
    'evidence-planr-valid.json',
    'evidence-planr-invalid.json',
    'evidence-registry-valid.json',
    'evidence-registry-invalid.json',
    'evidence-resolution-valid.json',
    'evidence-resolution-invalid.json',
  ]) required.push(`conformance/fixtures/operating-runtime-v2/${fixture}`);
  for (const path of required) assert.equal(packedFiles.has(path), true, `missing ${path}`);
  for (const path of LIVE_EVIDENCE_LANDING_SNAPSHOT_TESTS) {
    assert.equal(packed.cleanSnapshot.overlays.includes(path), true, `missing development snapshot overlay ${path}`);
  }
  for (const path of packedFiles) {
    assert.doesNotMatch(path, /^(?:\.planr\/|tests\/|node_modules\/|\.env(?:\.|\/|$))/);
    assert.doesNotMatch(path, /operate-2\.0\/(?:phases|audits|decisions)/i);
  }

  const installRoot = join(temporaryRoot, 'consumer');
  const dependencyRoot = join(temporaryRoot, 'dependencies');
  mkdirSync(installRoot, { recursive: true });
  mkdirSync(dependencyRoot, { recursive: true });
  const localDependencies = {};
  for (const dependency of ['@noble/hashes', 'entities', 'esbuild', 'pako', 'parse5']) {
    const [dependencyPack] = JSON.parse(runNpm([
      'pack', '--ignore-scripts', '--json', '--pack-destination', dependencyRoot,
    ], { cwd: resolveWorkspaceDependencyRoot(dependency) }).stdout);
    localDependencies[dependency] = `file:${join(dependencyRoot, dependencyPack.filename)}`;
  }
  writeFileSync(join(installRoot, 'package.json'), JSON.stringify({
    name: 'operate-v2-development-consumer',
    private: true,
    type: 'module',
    dependencies: localDependencies,
  }));
  runNpm([
    'install', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=dev',
    '--omit=optional', '--no-package-lock', '--offline', packed.tarballPath,
  ], { cwd: installRoot });

  const installedPackage = join(installRoot, 'node_modules', 'planr-pipeline');
  const installedMetadata = JSON.parse(readFileSync(join(installedPackage, 'package.json'), 'utf8'));
  assert.equal(installedMetadata.version, packageVersion);
  assert.equal(installedMetadata.exports['./schemas/*'], './schemas/*');
  for (const retiredPromptRoot of ['.claude-plugin', 'adapters', 'agents', 'commands', 'skills']) {
    assert.equal(
      existsSync(join(installedPackage, retiredPromptRoot)),
      false,
      `${retiredPromptRoot} must remain in host plugin packages, not planr-pipeline`,
    );
  }
  const rootDeclarations = readFileSync(join(installedPackage, 'lib/pipeline/index.d.mts'), 'utf8');
  assert.match(rootDeclarations, /export \* from '\.\.\/protocol\/live-evidence-v2\.d\.mts';/u);
  assert.match(rootDeclarations, /export \* from '\.\/landing-contract\.d\.mts';/u);
  const currentRuntimeCustody = [
    ...DASHBOARD_PROTOCOL_CUSTODY,
    ...PROFESSIONAL_REVIEW_PACKAGE_CUSTODY,
    ...LIVE_EVIDENCE_LANDING_PACKAGE_CUSTODY,
    'lib/artifact/index.mjs',
    'lib/artifact/live-room.mjs',
    'lib/artifact/live-room-integrity.mjs',
    'lib/dashboard/operate-experience-reader.mjs',
    'lib/dashboard/operate-experience-reader.d.mts',
    'lib/dashboard/operate-experience-audit-display-contract.d.mts',
    'lib/dashboard/operate-experience-audit-display-contract.mjs',
    'lib/dashboard/operate-experience-display-contract.d.mts',
    'lib/dashboard/operate-experience-display-contract.mjs',
    'lib/dashboard/operate-experience-surface-contract.d.mts',
    'lib/dashboard/operate-experience-surface-contract.mjs',
    'lib/dashboard/generated/operate-experience-surface-schema-data.mjs',
    'lib/dashboard/graph-engine.mjs',
    'lib/dashboard/server.mjs',
    'lib/operate/runtime-foundation.d.mts',
    'lib/operate/runtime-foundation.mjs',
    'lib/pipeline/engine.mjs',
    'lib/pipeline/errors.mjs',
    'lib/pipeline/index.d.mts',
    'lib/pipeline/index.mjs',
    'lib/pipeline/operate-origin.mjs',
    'lib/pipeline/provenance.mjs',
    'schemas/v1.0.0/pipeline-shipped.schema.json',
    'schemas/v1.0.0/run-manifest.schema.json',
    'schemas/v1.1.0/artifact-room-descriptor.schema.json',
    'schemas/v1.1.0/artifact-room-event.schema.json',
    'schemas/v1.1.0/artifact-room-signed-event.schema.json',
    'schemas/v1.1.0/provenance-event.schema.json',
    'schemas/v1.2.0/dashboard-bootstrap.schema.json',
    'schemas/v1.2.0/operate-action-display-workspace.d.mts',
    'schemas/v1.2.0/operate-action-display-workspace.mjs',
    'schemas/v1.2.0/operate-action-display-workspace.schema.json',
    'schemas/v1.2.0/operate-cycle-display-workspace.d.mts',
    'schemas/v1.2.0/operate-cycle-display-workspace.mjs',
    'schemas/v1.2.0/operate-cycle-display-workspace.schema.json',
    'schemas/v1.2.0/operate-experience-display-surface.d.mts',
    'schemas/v1.2.0/operate-experience-display-surface.mjs',
    'schemas/v1.2.0/operate-experience-display-surface.schema.json',
    'schemas/v1.2.0/operate-experience-audit-display-surface.d.mts',
    'schemas/v1.2.0/operate-experience-audit-display-surface.mjs',
    'schemas/v1.2.0/operate-experience-audit-display-surface.schema.json',
    'schemas/v1.2.0/operate-experience-surface.d.mts',
    'schemas/v1.2.0/operate-experience-surface.mjs',
    'schemas/v1.2.0/operate-experience-surface.schema.json',
    'schemas/v1.2.0/operate-recovery-display-surface.d.mts',
    'schemas/v1.2.0/operate-recovery-display-surface.mjs',
    'schemas/v1.2.0/operate-recovery-display-surface.schema.json',
  ];
  for (const path of currentRuntimeCustody) {
    assert.equal(
      sha256File(join(installedPackage, path)),
      sha256File(join(root, path)),
      `${path}: installed package must retain the reviewed current runtime bytes`,
    );
  }
  assert.equal(
    sha256File(join(installedPackage, 'lib/pipeline/engine.mjs')),
    PROTECTED_USER_OWNED_PATHS['lib/pipeline/engine.mjs'],
    'installed engine must match its reviewed custody pin',
  );
  assert.deepEqual(installedMetadata.exports['./operate/runtime-v2'], {
    types: './lib/operate/runtime-foundation.d.mts',
    import: './lib/operate/runtime-foundation.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/result-packet-v2'], {
    types: './lib/operate/result-packet-v2.d.mts',
    import: './lib/operate/result-packet-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/scheduler-v2'], {
    types: './lib/operate/scheduler-v2.d.mts',
    import: './lib/operate/scheduler-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/extensions-v2'], {
    types: './lib/operate/extensions-v2.d.mts',
    import: './lib/operate/extensions-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/experience-projection-v2'], {
    types: './lib/operate/experience-projection-v2.d.mts',
    import: './lib/operate/experience-projection-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/planning-bridge-v2'], {
    types: './lib/operate/planning-bridge-v2.d.mts',
    import: './lib/operate/planning-bridge-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/governed-execution-v2'], {
    types: './lib/operate/governed-execution-v2.d.mts',
    import: './lib/operate/governed-execution-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/governed-recovery-v2'], {
    types: './lib/operate/governed-recovery-v2.d.mts',
    import: './lib/operate/governed-recovery-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/execution-verification-v2'], {
    types: './lib/operate/execution-verification-v2.d.mts',
    import: './lib/operate/execution-verification-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/persistent-work-v2'], {
    types: './lib/operate/persistent-work-v2.d.mts',
    import: './lib/operate/persistent-work-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/persistent-work-projections-v2'], {
    types: './lib/operate/persistent-work-projections-v2.d.mts',
    import: './lib/operate/persistent-work-projections-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/evidence-v2'], {
    types: './lib/operate/evidence-v2.d.mts',
    import: './lib/operate/evidence-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/evidence-materialization-v2'], {
    types: './lib/operate/evidence-materialization-v2.d.mts',
    import: './lib/operate/evidence-materialization-v2.mjs',
  });
  assert.deepEqual(installedMetadata.exports['./operate/evidence-projections-v2'], {
    types: './lib/operate/evidence-projections-v2.d.mts',
    import: './lib/operate/evidence-projections-v2.mjs',
  });
  assert.equal(installedMetadata.exports['./operate/compatibility-v1_4'], undefined);
  assertPackagedMarkdownLinks(installedPackage);

  for (const subpath of [
    './operate/runtime-v2',
    './operate/result-packet-v2',
    './operate/scheduler-v2',
    './operate/extensions-v2',
    './operate/experience-projection-v2',
    './operate/planning-bridge-v2',
    './operate/governed-execution-v2',
    './operate/governed-recovery-v2',
    './operate/execution-verification-v2',
    './operate/persistent-work-v2',
    './operate/persistent-work-projections-v2',
    './operate/evidence-v2',
    './operate/evidence-materialization-v2',
    './operate/evidence-projections-v2',
  ]) {
    const target = installedMetadata.exports[subpath];
    assert.equal(existsSync(join(installedPackage, target.import)), true, `${subpath} runtime target`);
    assert.equal(existsSync(join(installedPackage, target.types)), true, `${subpath} types target`);
    const declarations = readFileSync(join(installedPackage, target.types), 'utf8');
    assert.doesNotMatch(declarations, /\.\.\/protocol\/index\.d\.ts/);
    if (subpath.endsWith('runtime-v2')) {
      assert.match(declarations, /from 'planr-pipeline\/protocol'/);
      for (const symbol of [
        'OPERATING_ASSIGNMENT_TRANSITIONS_V2',
        'evaluateOperateGuardV2',
        'reduceOperatingRuntimeEventsV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
      assert.doesNotMatch(declarations, /prepareOperatingV14CompatibilityV2/);
    }
    if (subpath.endsWith('result-packet-v2')) {
      for (const symbol of [
        'createOperatingResultTemplateV2',
        'operatingResultSchemaDependenciesV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('scheduler-v2')) {
      for (const symbol of [
        'validateOperatingAssignmentGraphV2',
        'deriveOperatingAssignmentReleaseIntentsV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('extensions-v2')) {
      for (const symbol of [
        'createOperateExtensionRegistryV2',
        'selectAgentRuntimeManifestV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('experience-projection-v2')) {
      for (const symbol of [
        'buildOperateExperienceViewV2',
        'createOperateExperiencePreviewV1',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('planning-bridge-v2')) {
      for (const symbol of [
        'createOperatingDeliveryRouteV1',
        'buildOperatingPlanningProposalV1',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('governed-execution-v2')) {
      for (const symbol of [
        'createOperatingGovernedExecutionRuntimeV2',
        'executeOperatingGovernedActionV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('governed-recovery-v2')) {
      for (const symbol of [
        'createOperatingGovernedRecoveryRuntimeV2',
        'rollbackOperatingGovernedActionV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('execution-verification-v2')) {
      for (const symbol of [
        'buildOperatingExecutionLifecycleV2',
        'deriveOperatingVerificationFeedbackV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('persistent-work-v2')) {
      assert.match(declarations, /buildPersistentWorkMaterializationPayloadV2/);
    }
    if (subpath.endsWith('persistent-work-projections-v2')) {
      for (const symbol of [
        'buildOperatingWorkLedgerV2',
        'buildOperatingCycleWorkViewV2',
      ]) assert.match(declarations, new RegExp(`\\b${symbol}\\b`));
    }
    if (subpath.endsWith('evidence-v2')) {
      assert.match(declarations, /export \* from '\.\/evidence-registry-v2\.mjs'/);
      assert.match(declarations, /dispatchOperateEvidenceResolverV2/);
    }
    if (subpath.endsWith('evidence-materialization-v2')) {
      assert.match(declarations, /buildOperatingEvidenceMaterializationV2/);
    }
    if (subpath.endsWith('evidence-projections-v2')) {
      assert.match(declarations, /buildOperatingEvidenceGraphV2/);
    }
  }

  const importSmoke = String.raw`
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import {
      LANDING_CONTRACT_KINDS_V1,
      OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2,
      OPERATE_RUNTIME_CONTRACT_KINDS,
      loadLandingContract,
      loadOperateLiveEvidenceContract,
      loadProtocolContract,
      loadOperateRuntimeContract,
    } from 'planr-pipeline/protocol';
    import {
      OPERATING_ASSIGNMENT_TRANSITIONS_V2,
      createEmptyOperatingRuntimeStateV2,
    } from 'planr-pipeline/operate/runtime-v2';
    import {
      createOperatingResultTemplateV2,
      operatingResultSchemaDependenciesV2,
    } from 'planr-pipeline/operate/result-packet-v2';
    import { deriveOperatingAssignmentReleaseIntentsV2 } from 'planr-pipeline/operate/scheduler-v2';
    import { OPEN_REFERENCE_OPERATE_EXTENSIONS_V2 } from 'planr-pipeline/operate/extensions-v2';
    import { buildOperateExperienceViewV2 } from 'planr-pipeline/operate/experience-projection-v2';
    import { createOperatingDeliveryRouteV1 } from 'planr-pipeline/operate/planning-bridge-v2';
    import {
      OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2,
      createOperatingGovernedExecutionRuntimeV2,
    } from 'planr-pipeline/operate/governed-execution-v2';
    import {
      OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
      createOperatingGovernedRecoveryRuntimeV2,
    } from 'planr-pipeline/operate/governed-recovery-v2';
    import {
      OPERATING_EXECUTION_VERIFICATION_STATUSES_V2,
      deriveOperatingVerificationFeedbackV2,
    } from 'planr-pipeline/operate/execution-verification-v2';
    import { buildPersistentWorkMaterializationPayloadV2 } from 'planr-pipeline/operate/persistent-work-v2';
    import { buildOperatingWorkLedgerV2 } from 'planr-pipeline/operate/persistent-work-projections-v2';
    import {
      OPEN_REFERENCE_EVIDENCE_REGISTRY_V2,
      createOperateEvidenceRegistryV2,
      dispatchOperateEvidenceResolverV2,
    } from 'planr-pipeline/operate/evidence-v2';
    import { buildOperatingEvidenceMaterializationV2 } from 'planr-pipeline/operate/evidence-materialization-v2';
    import { buildOperatingEvidenceGraphV2 } from 'planr-pipeline/operate/evidence-projections-v2';
    import { assertOperateExperienceSurfaceV1 } from 'planr-pipeline/schemas/v1.2.0/operate-experience-surface.mjs';
    import {
      ARTIFACT_ERROR_CODES,
      createLiveRoomDescriptor,
      createLiveRoomEventFromReviewChange,
      createLiveRoomSigner,
      assertLandingPlan,
      assertLiveEvidenceProviderRegistrationV2,
      projectPipelineOperatingOriginCorrelation,
    } from 'planr-pipeline';
    const require = createRequire(import.meta.url);
    assert.equal(new Set(OPERATE_RUNTIME_CONTRACT_KINDS).size, OPERATE_RUNTIME_CONTRACT_KINDS.length);
    assert.equal(OPERATING_ASSIGNMENT_TRANSITIONS_V2.pending[0], 'available');
    assert.equal(createEmptyOperatingRuntimeStateV2().protocolVersion, '2.0.0');
    assert.equal(typeof createOperatingResultTemplateV2, 'function');
    assert.equal(typeof operatingResultSchemaDependenciesV2, 'function');
    assert.equal(deriveOperatingAssignmentReleaseIntentsV2({ assignments: [] }).length, 0);
    assert.equal(OPEN_REFERENCE_OPERATE_EXTENSIONS_V2.domains.length, 2);
    assert.equal(typeof buildOperateExperienceViewV2, 'function');
    assert.equal(typeof createOperatingDeliveryRouteV1, 'function');
    assert.equal(OPERATING_GOVERNED_EXECUTION_TERMINAL_STATES_V2.includes('succeeded'), true);
    assert.equal(typeof createOperatingGovernedExecutionRuntimeV2, 'function');
    assert.deepEqual(OPERATING_GOVERNED_RECOVERY_CLASSIFICATIONS_V2,
      ['applied', 'not-applied', 'partial', 'unknown']);
    assert.equal(typeof createOperatingGovernedRecoveryRuntimeV2, 'function');
    assert.equal(OPERATING_EXECUTION_VERIFICATION_STATUSES_V2.includes('rolled-back'), true);
    assert.equal(typeof deriveOperatingVerificationFeedbackV2, 'function');
    assert.equal(typeof buildPersistentWorkMaterializationPayloadV2, 'function');
    assert.equal(typeof buildOperatingWorkLedgerV2, 'function');
    assert.equal(createOperateEvidenceRegistryV2().providers.length, 4);
    assert.equal(OPEN_REFERENCE_EVIDENCE_REGISTRY_V2.resolvers.length, 4);
    assert.equal(typeof dispatchOperateEvidenceResolverV2, 'function');
    assert.equal(typeof buildOperatingEvidenceMaterializationV2, 'function');
    assert.equal(typeof buildOperatingEvidenceGraphV2, 'function');
    assert.equal(typeof assertOperateExperienceSurfaceV1, 'function');
    assert.equal(typeof createLiveRoomDescriptor, 'function');
    assert.equal(typeof createLiveRoomEventFromReviewChange, 'function');
    assert.equal(typeof createLiveRoomSigner, 'function');
    assert.equal(typeof assertLandingPlan, 'function');
    assert.equal(typeof assertLiveEvidenceProviderRegistrationV2, 'function');
    assert.equal(ARTIFACT_ERROR_CODES.ROOM_LEGACY_READ_ONLY, 'E_ARTIFACT_ROOM_LEGACY_READ_ONLY');
    for (const kind of ['artifact-room-descriptor', 'artifact-room-event', 'artifact-room-signed-event']) {
      const contract = loadProtocolContract(kind, { protocolVersion: '1.1.0' });
      assert.equal(contract.kind, kind);
      require.resolve('planr-pipeline/' + contract.path);
    }
    assert.deepEqual(projectPipelineOperatingOriginCorrelation({
      correlationId: 'corr_1234567890abcdef',
      proposalId: 'oprop_1234567890abcdef',
      proposalHash: 'sha256:${'1'.repeat(64)}',
      transactionId: 'optrx_1234567890abcdef',
      receiptHash: 'sha256:${'2'.repeat(64)}',
    }), {
      correlation_id: 'corr_1234567890abcdef',
      proposal_id: 'oprop_1234567890abcdef',
      proposal_hash: 'sha256:${'1'.repeat(64)}',
      transaction_id: 'optrx_1234567890abcdef',
      receipt_hash: 'sha256:${'2'.repeat(64)}',
    });
    for (const kind of OPERATE_RUNTIME_CONTRACT_KINDS) {
      const contract = loadOperateRuntimeContract(kind, { protocolVersion: '2.0.0' });
      require.resolve('planr-pipeline/schemas/v2.0.0/' + contract.path.split('/').at(-1));
    }
    for (const kind of OPERATE_LIVE_EVIDENCE_CONTRACT_KINDS_V2) {
      const contract = loadOperateLiveEvidenceContract(kind, { protocolVersion: '2.0.0' });
      require.resolve('planr-pipeline/' + contract.path);
    }
    for (const kind of LANDING_CONTRACT_KINDS_V1) {
      const contract = loadLandingContract(kind, { protocolVersion: '1.2.0' });
      require.resolve('planr-pipeline/' + contract.path);
    }
  `;
  run(process.execPath, ['--input-type=module', '--eval', importSmoke], { cwd: installRoot });

  const conformance = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operating-runtime-v2.mjs'),
  ], { cwd: installRoot });
  const report = JSON.parse(conformance.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.protocolVersion, '2.0.0');
  assert.ok(report.checks > 100);

  const persistentWork = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operate-v2-persistent-work.mjs'),
  ], { cwd: installRoot });
  const persistentWorkReport = JSON.parse(persistentWork.stdout);
  assert.equal(persistentWorkReport.ok, true);
  assert.equal(persistentWorkReport.protocolVersion, '2.0.0');
  assert.ok(persistentWorkReport.checks >= 7);

  const compilation = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operate-v2-contract-compilation.mjs'),
  ], { cwd: installRoot });
  const compilationReport = JSON.parse(compilation.stdout);
  assert.equal(compilationReport.ok, true);
  assert.equal(compilationReport.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);

  const evidence = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operate-v2-evidence.mjs'),
  ], { cwd: installRoot });
  const evidenceReport = JSON.parse(evidence.stdout);
  assert.equal(evidenceReport.ok, true);
  assert.equal(evidenceReport.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.equal(evidenceReport.evidenceContracts, 7);

  const boundary = run(process.execPath, [
    join(installedPackage, 'conformance', 'verify-operate-v2-clean-boundary.mjs'),
  ], { cwd: installRoot });
  const boundaryReport = JSON.parse(boundary.stdout);
  assert.equal(boundaryReport.status, 'NOT_APPLICABLE');
  assert.equal(boundaryReport.local.status, 'PASS');
  assert.equal(boundaryReport.local.operatingIntelligence.ok, true);
  assert.equal(boundaryReport.local.governedExecution.ok, true);
  assert.equal(boundaryReport.local.governedExecution.contracts, OPERATE_RUNTIME_CONTRACT_KINDS.length);
  assert.equal(boundaryReport.local.governedExecution.networkAttempts, 0);

  assert.equal(checkOperateRuntimePurity(installedPackage).ok, true);

  assert.deepEqual(
    packed.cleanSnapshot.excludedProof.map(({ path }) => path),
    ['bin/planr-pipeline.mjs', 'tests/pipeline/engine.test.mjs'],
    'only the unrelated user-owned executable and engine test remain excluded',
  );

  for (const proof of packed.cleanSnapshot.excludedProof) {
    const installedPath = join(installedPackage, proof.path);
    if (!existsSync(installedPath)) continue;
    assert.equal(sha256File(installedPath), proof.headSha256, `${proof.path}: committed release bytes`);
    assert.equal(proof.snapshotSha256, proof.headSha256, `${proof.path}: clean snapshot proof`);
    if (proof.worktreeSha256 !== proof.headSha256) {
      assert.notEqual(sha256File(installedPath), proof.worktreeSha256, `${proof.path}: dirty user bytes excluded`);
    }
  }
});
