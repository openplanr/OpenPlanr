#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const DEVELOPMENT_PROJECTION_MANIFESTS = Object.freeze([
  'lib/generated/protocol-projection.json',
  'lib/generated/domain-projections/artifact.json',
  'lib/generated/domain-projections/design.json',
  'lib/generated/domain-projections/operate.json',
]);

// A clean development package is assembled from committed source plus this
// explicit Operate development overlay. This keeps private planning and
// unrelated dirty files out of the package without implying a release
// candidate, tag, or publish operation.
export const UNIFIED_DASHBOARD_PROTOCOL_PATHS = Object.freeze([
  'schemas/v1.2.0/dashboard-bootstrap.schema.json',
  'lib/dashboard/server.mjs',
  'lib/protocol/contracts.mjs',
  'lib/protocol/loader.mjs',
]);

const OPERATE_V2_DEVELOPMENT_OVERLAYS = Object.freeze([
  'CHANGELOG.md',
  'README.md',
  'conformance/.npmignore',
  'conformance/fixtures/professional-skills/generated-assets.json',
  'conformance/fixtures/operate-adapter-parity/generated-assets.json',
  'conformance/fixtures/landing-contracts-invalid.json',
  'conformance/fixtures/landing-contracts-valid.json',
  'conformance/fixtures/operating-runtime-v2/live-evidence-contracts-invalid.json',
  'conformance/fixtures/operating-runtime-v2/live-evidence-contracts-valid.json',
  'conformance/fixtures/operating-runtime-v2',
  'conformance/json-schema-validate.mjs',
  'conformance/verify-operate-v2-absence.mjs',
  'conformance/verify-operate-v2-clean-boundary.mjs',
  'conformance/verify-operate-v2-contract-compilation.mjs',
  'conformance/verify-operate-v2-evidence.mjs',
  'conformance/verify-operate-v2-governed-execution.mjs',
  'conformance/verify-operate-v2-operating-intelligence.mjs',
  'conformance/verify-operate-v2-product-experience.mjs',
  'conformance/verify-operate-v2-persistent-work.mjs',
  'conformance/verify-operating-runtime-v2.mjs',
  'docs/compatibility-matrix.md',
  'docs/ecosystem-guide.md',
  'docs/generated/adapters.md',
  'docs/ownership-map.md',
  'docs/protocol/README.md',
  'docs/protocol/operate-runtime-v2.md',
  'docs/protocol/guided-interactions.md',
  'docs/release-checklist.md',
  'docs/runtime-guided-interactions.md',
  'fixtures/diagram',
  'gallery/diagram',
  'input/tech/stack.md',
  'lib/dashboard/resolve-packaged-dashboard-root.mjs',
  'conformance/verify-unified-dashboard-absence.mjs',
  'docs/unified-dashboard-migration.md',
  'lib/dashboard/operate-experience-reader.mjs',
  'lib/dashboard/operate-experience-reader.d.mts',
  'lib/dashboard/closed-json-contract.mjs',
  'lib/dashboard/verified-json.mjs',
  'lib/dashboard/verified-json.d.mts',
  'lib/dashboard/operate-experience-audit-display-contract.d.mts',
  'lib/dashboard/operate-experience-audit-display-contract.mjs',
  'lib/dashboard/operate-experience-display-contract.d.mts',
  'lib/dashboard/operate-experience-display-contract.mjs',
  'lib/dashboard/operate-experience-surface-contract.d.mts',
  'lib/dashboard/operate-experience-surface-contract.mjs',
  'lib/dashboard/generated/operate-experience-surface-schema-data.mjs',
  'lib/dashboard/generated/operate-review-schema-data.mjs',
  'lib/dashboard/generated/operate-schema-token-codec.mjs',
  'lib/dashboard/operate-review-contract.d.mts',
  'lib/dashboard/operate-review-contract.mjs',
  'lib/dashboard/operate-review-display-workspace-contract.d.mts',
  'lib/dashboard/operate-review-display-workspace-contract.mjs',
  'lib/dashboard/operate-review-payload-safety.d.mts',
  'lib/dashboard/operate-review-payload-safety.mjs',
  'lib/dashboard/graph-engine.mjs',
  'lib/dashboard/operate-reader.mjs',
  'lib/dashboard/server.mjs',
  'lib/dashboard/server',
  'lib/ecosystem/packed-workspace-proof.mjs',
  'lib/generated/operate-contract-custody-v1.5.json',
  'lib/generated/protocol-projection.json',
  'lib/artifact/index.mjs',
  'lib/artifact/diagram',
  'lib/artifact/live-room.mjs',
  'lib/artifact/live-room-integrity.mjs',
  'lib/operate/contracts/compiler.mjs',
  'lib/operate/contracts/mandate-appendix-v2.mjs',
  'lib/operate/cycle-closure-v2.d.mts',
  'lib/operate/cycle-closure-v2.mjs',
  'lib/operate/evidence-filesystem-v2.mjs',
  'lib/operate/evidence-git-v2.mjs',
  'lib/operate/evidence-planr-v2.mjs',
  'lib/operate/evidence-artifact-v2.mjs',
  'lib/operate/evidence-registry-v2.d.mts',
  'lib/operate/evidence-registry-v2.mjs',
  'lib/operate/evidence-materialization-v2.d.mts',
  'lib/operate/evidence-materialization-v2.mjs',
  'lib/operate/evidence-projections-v2.d.mts',
  'lib/operate/evidence-projections-v2.mjs',
  'lib/operate/evidence-v2.d.mts',
  'lib/operate/evidence-v2.mjs',
  'lib/operate/extensions-v2.d.mts',
  'lib/operate/extensions-v2.mjs',
  'lib/operate/experience-projection-v2.d.mts',
  'lib/operate/experience-projection-v2.mjs',
  'lib/protocol/generated/contract-catalog-v2.mjs',
  'lib/protocol/generated/contract-package-inventory-v2.json',
  'lib/operate/governed-execution-v2.d.mts',
  'lib/operate/governed-execution-v2.mjs',
  'lib/operate/governed-extensions-v2.d.mts',
  'lib/operate/governed-extensions-v2.mjs',
  'lib/operate/governed-recovery-v2.d.mts',
  'lib/operate/governed-recovery-v2.mjs',
  'lib/operate/action-verification-v2.d.mts',
  'lib/operate/action-verification-v2.mjs',
  'lib/operate/execution-verification-v2.d.mts',
  'lib/operate/execution-verification-v2.mjs',
  'lib/operate/executive-board-compatibility-v2.d.mts',
  'lib/operate/executive-board-compatibility-v2.mjs',
  'lib/operate/executive-board-materialization-v2.d.mts',
  'lib/operate/executive-board-materialization-v2.mjs',
  'lib/operate/executive-board-projection-v2.mjs',
  'lib/operate/authorization-v2.d.mts',
  'lib/operate/authorization-v2.mjs',
  'lib/operate/approvals-v2.d.mts',
  'lib/operate/approvals-v2.mjs',
  'lib/operate/assignment-contract-v2.mjs',
  'lib/operate/intelligence-input-bundle-v2.mjs',
  'lib/operate/intelligence-ledger-v2.mjs',
  'lib/operate/intelligence-output-identities-v2.mjs',
  'lib/operate/intelligence-result-validator-v2.mjs',
  'lib/operate/intelligence-replay-v2.mjs',
  'lib/operate/intelligence-router-v2.d.mts',
  'lib/operate/intelligence-router-v2.mjs',
  'lib/protocol/live-evidence-v2.d.mts',
  'lib/protocol/live-evidence-v2.mjs',
  'lib/operate/operating-delta-v2.d.mts',
  'lib/operate/operating-delta-v2.mjs',
  'lib/operate/operating-domains-v2.d.mts',
  'lib/operate/operating-domains-v2.mjs',
  'lib/operate/operating-intelligence-state-v2.d.mts',
  'lib/operate/operating-intelligence-state-v2.mjs',
  'lib/operate/operating-signal-providers-v2.d.mts',
  'lib/operate/operating-signal-providers-v2.mjs',
  'lib/operate/operating-snapshots-v2.d.mts',
  'lib/operate/operating-snapshots-v2.mjs',
  'lib/operate/operating-state-v2.d.mts',
  'lib/operate/operating-state-v2.mjs',
  'lib/operate/operating-triggers-v2.d.mts',
  'lib/operate/operating-triggers-v2.mjs',
  'lib/operate/persistent-work-projections-v2.d.mts',
  'lib/operate/persistent-work-projections-v2.mjs',
  'lib/operate/persistent-work-v2.d.mts',
  'lib/operate/persistent-work-v2.mjs',
  'lib/operate/policy-v2.d.mts',
  'lib/operate/policy-v2.mjs',
  'lib/operate/planning-bridge-v2.d.mts',
  'lib/operate/planning-bridge-v2.mjs',
  'lib/operate/reference-governed-executors-v2.d.mts',
  'lib/operate/reference-governed-executors-v2.mjs',
  'lib/operate/result-packet-v2.d.mts',
  'lib/operate/result-packet-v2.mjs',
  'lib/operate/review-bound-submission-v2.d.mts',
  'lib/operate/review-bound-submission-v2.mjs',
  'lib/dashboard/operate-review-workspace-projection-v2.d.mts',
  'lib/dashboard/operate-review-workspace-projection-v2.mjs',
  'lib/dashboard/graph-reader.mjs',
  'lib/operate/runtime-event-reducer-v2.mjs',
  'lib/operate/runtime-foundation',
  'lib/operate/runtime-foundation.d.mts',
  'lib/operate/runtime-foundation.mjs',
  'lib/operate/scheduler-v2.d.mts',
  'lib/operate/scheduler-v2.mjs',
  'lib/operate/trace-matrix-v2.d.mts',
  'lib/operate/trace-matrix-v2.mjs',
  'lib/pipeline/ecosystem-saga.mjs',
  'lib/pipeline/browser-qa-custody.d.mts',
  'lib/pipeline/browser-qa-custody.mjs',
  'lib/pipeline/browser-qa.d.mts',
  'lib/pipeline/browser-qa.mjs',
  'lib/pipeline/engine.mjs',
  'lib/pipeline/engine',
  'lib/pipeline/errors.mjs',
  'lib/pipeline/index.d.mts',
  'lib/pipeline/index.mjs',
  'lib/pipeline/investigation-contracts.d.mts',
  'lib/pipeline/investigation-contracts.mjs',
  'lib/pipeline/investigation-identity.d.mts',
  'lib/pipeline/investigation-identity.mjs',
  'lib/pipeline/investigation-reducer.d.mts',
  'lib/pipeline/investigation-reducer.mjs',
  'lib/pipeline/investigation-runtime.d.mts',
  'lib/pipeline/investigation-runtime.mjs',
  'lib/pipeline/landing-contract.d.mts',
  'lib/pipeline/landing-contract.mjs',
  'lib/pipeline/operate-origin.mjs',
  'lib/pipeline/planning-review-identity.mjs',
  'lib/pipeline/planning-review-reducer.mjs',
  'lib/pipeline/planning-review.mjs',
  'lib/pipeline/professional-skills.d.mts',
  'lib/pipeline/professional-skills.mjs',
  'lib/pipeline/provenance.mjs',
  'lib/pipeline/ship-closure-identity.mjs',
  'lib/pipeline/ship-closure-persistence.mjs',
  'lib/pipeline/ship-closure-projections.mjs',
  'lib/pipeline/ship-closure-reducer.mjs',
  'lib/pipeline/ship-closure.mjs',
  'lib/pipeline/ship-risk.d.mts',
  'lib/pipeline/ship-risk.mjs',
  'lib/protocol/contracts.mjs',
  'lib/protocol/canonical-json.mjs',
  'lib/protocol/diagram-contracts.mjs',
  'lib/protocol/errors.mjs',
  'lib/protocol/generated/diagram-registries.mjs',
  'lib/protocol/index.d.ts',
  'lib/protocol/jcs.mjs',
  'lib/protocol/json-schema.mjs',
  'lib/protocol/loader.mjs',
  'lib/protocol/operating-planning-contracts.mjs',
  'lib/protocol/planning-contracts.mjs',
  'lib/protocol/operate-experience-live-patch.mjs',
  'lib/protocol/skill-source-contracts.mjs',
  'package-lock.json',
  'package.json',
  'registry/adapters.json',
  'registry/frozen-commands.json',
  'registry/landing-operations.json',
  'registry/live-evidence-providers.json',
  'registry/operate-v2-contracts.json',
  'registry/professional-skills.json',
  'registry/ship-review-specialists.json',
  'registry/generated-skill-assets.json',
  'registry/v1.5.0',
  'registry/v1.6.0',
  'registry/v1.7.0',
  'references/diagram',
  'schemas/v1.0.0/spec.schema.json',
  'schemas/v1.0.0/task.schema.json',
  'schemas/v1.6.0',
  'schemas/v1.7.0',
  'schemas/v2.0.0',
  'schemas/v1.0.0/pipeline-shipped.schema.json',
  'schemas/v1.0.0/run-manifest.schema.json',
  'schemas/v1.1.0/artifact-room-descriptor.schema.json',
  'schemas/v1.1.0/artifact-room-event.schema.json',
  'schemas/v1.1.0/artifact-room-signed-event.schema.json',
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
  'schemas/v1.1.0/provenance-event.schema.json',
  'schemas/v1.1.0/ship-closure.schema.json',
  'schemas/v1.1.0/ship-review-specialist-registry.schema.json',
  'schemas/v1.1.0/ship-risk-classification.schema.json',
  'schemas/v1.1.0/specialist-review-result.schema.json',
  'schemas/v1.6.0',
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
  'schemas/v1.2.0/dashboard-bootstrap.schema.json',
  'schemas/v1.2.0/landing-confirmation.schema.json',
  'schemas/v1.2.0/landing-event.schema.json',
  'schemas/v1.2.0/landing-operation-registry.schema.json',
  'schemas/v1.2.0/landing-phase-receipt.schema.json',
  'schemas/v1.2.0/landing-plan.schema.json',
  'schemas/v1.2.0/landing-receipt.schema.json',
  'schemas/v1.2.0/operate-action-display-workspace.d.mts',
  'schemas/v1.2.0/operate-action-display-workspace.mjs',
  'schemas/v1.2.0/operate-action-display-workspace.schema.json',
  'schemas/v1.2.0/operate-cycle-display-workspace.d.mts',
  'schemas/v1.2.0/operate-cycle-display-workspace.mjs',
  'schemas/v1.2.0/operate-cycle-display-workspace.schema.json',
  'schemas/v1.2.0/operate-recovery-display-surface.d.mts',
  'schemas/v1.2.0/operate-recovery-display-surface.mjs',
  'schemas/v1.2.0/operate-recovery-display-surface.schema.json',
  'schemas/v1.2.0/operate-experience-display-surface.d.mts',
  'schemas/v1.2.0/operate-experience-display-surface.mjs',
  'schemas/v1.2.0/operate-experience-display-surface.schema.json',
  'schemas/v1.2.0/operate-experience-audit-display-surface.d.mts',
  'schemas/v1.2.0/operate-experience-audit-display-surface.mjs',
  'schemas/v1.2.0/operate-experience-audit-display-surface.schema.json',
  'schemas/v1.2.0/operate-experience-surface.d.mts',
  'schemas/v1.2.0/operate-experience-surface.mjs',
  'schemas/v1.2.0/operate-experience-surface.schema.json',
  'schemas/v1.4.0/adapter-registry.schema.json',
  'scripts/check-operate-runtime-purity.mjs',
  'scripts/generate-guided-adapters.mjs',
  'scripts/generate-operate-contracts.mjs',
  'scripts/discover-verification.mjs',
  'tests/orchestration/operate-live-evidence-v2-property.test.mjs',
  'tests/pipeline/landing-contract.test.mjs',
  'tests/schema/landing-contracts.test.mjs',
  'tests/schema/operate-live-evidence-contracts-v2.test.mjs',
]);

const OPERATE_V2_LEGACY_REMOVAL_PATTERNS = Object.freeze([
  /^adapters\/codex\/skills\/planr-operate\/(?!SKILL\.md$)/,
  /^adapters\/cursor\/rules\/openplanr-operate-(?:procedures|roles)\//,
  /^agents\/operating\//,
  /^commands\/operate\.md$/,
  /^conformance\/fixtures\/(?:guided-operate-journeys|operating-board|operating-dashboard)\//,
  /^conformance\/fixtures\/operating-runtime-v2\/legacy-operating-record-v1\.[234]-valid\.json$/,
  /^conformance\/(?:operating-provider-kit|verify-operating-(?:board(?:-amendment|-v1_[34])?|dashboard|mandate-vocabulary|records-migration))\.mjs$/,
  /^docs\/(?:feat-operating-board-agentic-execution\/|generated\/operating-(?:cadence|lens-agents|providers|roles)\.md$|guided-operating-board\.md$|implementation\/(?:guided-)?operating-board\.md$|protocol\/operating-board\.md$)/,
  /^lib\/operate\/(?!runtime-foundation(?:\.(?:mjs|d\.mts)|\/(?:authority|evidence-state|execution|intelligence|protocol)\.mjs)$|runtime-event-reducer-v2\.mjs$|assignment-contract-v2\.mjs$|intelligence-input-bundle-v2\.mjs$|intelligence-output-identities-v2\.mjs$|intelligence-result-validator-v2\.mjs$|intelligence-replay-v2\.mjs$|result-packet-v2\.(?:mjs|d\.mts)$|scheduler-v2\.(?:mjs|d\.mts)$|extensions-v2\.(?:mjs|d\.mts)$|experience-projection-v2\.(?:mjs|d\.mts)$|planning-bridge-v2\.(?:mjs|d\.mts)$|governed-execution-v2\.(?:mjs|d\.mts)$|governed-extensions-v2\.(?:mjs|d\.mts)$|governed-recovery-v2\.(?:mjs|d\.mts)$|reference-governed-executors-v2\.(?:mjs|d\.mts)$|operating-domains-v2\.(?:mjs|d\.mts)$|operating-signal-providers-v2\.(?:mjs|d\.mts)$|operating-state-v2\.(?:mjs|d\.mts)$|operating-snapshots-v2\.(?:mjs|d\.mts)$|operating-delta-v2\.(?:mjs|d\.mts)$|operating-intelligence-state-v2\.(?:mjs|d\.mts)$|intelligence-router-v2\.(?:mjs|d\.mts)$|intelligence-ledger-v2\.mjs$|action-verification-v2\.(?:mjs|d\.mts)$|execution-verification-v2\.(?:mjs|d\.mts)$|executive-board-projection-v2\.mjs$|authorization-v2\.(?:mjs|d\.mts)$|approvals-v2\.(?:mjs|d\.mts)$|policy-v2\.(?:mjs|d\.mts)$|operating-triggers-v2\.(?:mjs|d\.mts)$|persistent-work-v2\.(?:mjs|d\.mts)$|cycle-closure-v2\.(?:mjs|d\.mts)$|persistent-work-projections-v2\.(?:mjs|d\.mts)$|evidence-(?:artifact|filesystem|git|planr)-v2\.mjs$|evidence-registry-v2\.(?:mjs|d\.mts)$|evidence-v2\.(?:mjs|d\.mts)$|evidence-materialization-v2\.(?:mjs|d\.mts)$|evidence-projections-v2\.(?:mjs|d\.mts)$|contracts\/compiler\.mjs$).+$/,
  /^procedures\/operate\//,
  /^registry\/operating-(?:providers|roles)\.json$/,
  /^schemas\/v1\.[234]\.0\/operating-.+\.schema\.json$/,
  /^schemas\/v2\.0\.0\/(?:business-scope-binding|operate-v14-compatibility-transaction)\.schema\.json$/,
  /^scripts\/(?:generate-operating-assets|guided-operate-canary|operate-release-canary)\.mjs$/,
  /^lib\/dashboard\/app(?:\/|$)/,
  /^templates\/(?:operating-dashboard-preview\.html|runtime\/(?:operating-lens-agent|operating-role-instruction|planr-operate-(?:command|cursor|skill))\.(?:md\.tpl|mdc\.tpl))$/,
]);

const OPERATE_V2_EXACT_LEGACY_REMOVALS = Object.freeze([
  'adapters/codex/skills/planr-operate/SKILL.md',
  'adapters/cursor/rules/openplanr-operate.mdc',
  'commands/operate.md',
  'lib/operate/saga.mjs',
]);

export const USER_OWNED_EXCLUDED_PATHS = Object.freeze([
  'bin/planr-pipeline.mjs',
  'tests/pipeline/engine.test.mjs',
]);

const textExtensions = new Set([
  '.css',
  '.d.mts',
  '.d.ts',
  '.feature',
  '.html',
  '.js',
  '.json',
  '.jsonl',
  '.md',
  '.mdc',
  '.mjs',
  '.sh',
  '.svg',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);
const privatePathFragments = [
  ['.planr', 'products', 'operate-2.0'].join('/'),
  ['docs', 'operate-2.0'].join('/'),
];
const privateContentPatterns = [
  new RegExp(['PHASE', '[0-9]+', 'PLAN'].join('_'), 'i'),
  new RegExp(['CURRENT', 'ARCHITECTURE', 'AUDIT'].join('_'), 'i'),
  new RegExp(['OPENPLANR', 'IMPLEMENTATION', 'AUDIT'].join('_'), 'i'),
  new RegExp(['TRACEABILITY', 'MATRIX'].join('_'), 'i'),
  new RegExp(['private', 'consumer'].join('[-_ ]'), 'i'),
  new RegExp(['customer', 'credential'].join('[ _-]'), 'i'),
  new RegExp(['tenant', 'secret'].join('[ _-]'), 'i'),
];
const absoluteMachinePatterns = [
  new RegExp('/' + 'Users' + '/[^/\\s]+/'),
  new RegExp('/' + 'home' + '/[^/\\s]+/'),
  new RegExp('[A-Za-z]:' + '\\\\' + 'Users' + '\\\\', 'i'),
];
const modelChoicePattern = new RegExp(
  [
    'claude-(?:opus|sonnet|haiku)',
    '(?:opus|sonnet|haiku)[ -]?[0-9]',
    'gpt-[0-9]',
    'o[134]-mini',
  ].join('|'),
  'i',
);

function fail(message, details = {}) {
  const error = new Error(message);
  error.details = details;
  throw error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed`, {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return result.stdout;
}

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  return npmCli ? run(process.execPath, [npmCli, ...args], options) : run('npm', args, options);
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function isContained(root, path) {
  const child = relative(realpathSync(root), realpathSync(path));
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
}

function copyWithoutSymlinks(source, destination) {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) fail(`Development overlay is a symlink: ${source}`);
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyWithoutSymlinks(join(source, entry), join(destination, entry));
    }
    return;
  }
  if (!stat.isFile()) fail(`Development overlay is not a regular file: ${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

function assertOverlayParents(root, path) {
  let current = root;
  for (const component of path.split('/')) {
    current = join(current, component);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (stat?.isSymbolicLink()) fail(`Development projection contains a symlink: ${path}`);
  }
}

function developmentProjectionEntries(source) {
  const entries = new Map();
  for (const path of DEVELOPMENT_PROJECTION_MANIFESTS) {
    assertOverlayParents(source, path);
    const bytes = readFileSync(join(source, path));
    const manifest = JSON.parse(bytes);
    if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
      fail(`Development projection manifest has no entries: ${path}`);
    }
    entries.set(path, createHash('sha256').update(bytes).digest('hex'));
    for (const { target, sha256 } of manifest.entries) {
      if (
        typeof target !== 'string' ||
        target.includes('\\') ||
        target.includes(':') ||
        target.split('/').some((part) => !part || part === '.' || part === '..') ||
        USER_OWNED_EXCLUDED_PATHS.includes(target) ||
        !/^[a-f0-9]{64}$/.test(sha256)
      ) {
        fail(`Invalid development projection entry in ${path}: ${target}`);
      }
      if (entries.has(target)) fail(`Duplicate development projection target: ${target}`);
      entries.set(target, sha256);
    }
  }
  return entries;
}

function parseStatusPath(line) {
  const body = line.slice(3);
  return body.includes(' -> ') ? body.split(' -> ').at(-1) : body;
}

function gitLocation(root) {
  const topLevel = run('git', ['rev-parse', '--show-toplevel'], { cwd: root }).trim();
  const prefix = run('git', ['rev-parse', '--show-prefix'], { cwd: root }).trim();
  return { topLevel, prefix };
}

function listedDirtyPaths(root) {
  const lines = run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root })
    .split('\n')
    .filter(Boolean);
  return lines.map(parseStatusPath);
}

function legacyRemovalPaths(root) {
  const worktreeRemovals = run(
    'git',
    ['diff', '--relative', '--name-only', '--diff-filter=D', 'HEAD', '--', '.'],
    { cwd: root },
  )
    .split('\n')
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => OPERATE_V2_LEGACY_REMOVAL_PATTERNS.some((pattern) => pattern.test(path)));
  return [...new Set([...OPERATE_V2_EXACT_LEGACY_REMOVALS, ...worktreeRemovals])].sort();
}

function removeLegacySnapshotPaths(destination, paths) {
  for (const path of paths) {
    const target = join(destination, path);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }
}

export function createOperateV2DevelopmentSnapshot(
  destinationRoot,
  { sourceRoot = repositoryRoot } = {},
) {
  const source = realpathSync(sourceRoot);
  const sourceGit = gitLocation(source);
  const projectionEntries = developmentProjectionEntries(source);
  mkdirSync(destinationRoot, { recursive: true });
  const destination = realpathSync(destinationRoot);
  const dirtyPaths = listedDirtyPaths(source);
  const archiveRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-archive-'));
  const archivePath = join(archiveRoot, 'head.tar');
  try {
    const archiveTree = sourceGit.prefix ? `HEAD:${sourceGit.prefix.replace(/\/$/, '')}` : 'HEAD';
    run('git', ['archive', '--format=tar', '--output', archivePath, archiveTree], {
      cwd: sourceGit.topLevel,
    });
    run('tar', ['-xf', archivePath, '-C', destination]);
  } finally {
    rmSync(archiveRoot, { recursive: true, force: true });
  }

  const legacyRemovals = legacyRemovalPaths(source);
  removeLegacySnapshotPaths(destination, legacyRemovals);

  for (const path of OPERATE_V2_DEVELOPMENT_OVERLAYS) {
    const packagePath = join(source, path);
    const sourcePath =
      path === 'package-lock.json' && !existsSync(packagePath)
        ? join(sourceGit.topLevel, path)
        : packagePath;
    copyWithoutSymlinks(sourcePath, join(destination, path));
  }

  // Git archives exclude regenerated package surfaces. Copy only the exact
  // manifest-owned files, keeping the manifest and packaged bytes consistent.
  for (const [path, sha256] of projectionEntries) {
    assertOverlayParents(source, path);
    assertOverlayParents(destination, path);
    const sourcePath = join(source, path);
    if (!lstatSync(sourcePath).isFile())
      fail(`Development projection is not a regular file: ${path}`);
    const destinationPath = join(destination, path);
    copyWithoutSymlinks(sourcePath, destinationPath);
    if (sha256File(destinationPath) !== sha256) {
      fail(
        `Development projection digest mismatch: ${path}. Run npm run generate at the repository root.`,
      );
    }
  }

  const excludedProof = USER_OWNED_EXCLUDED_PATHS.map((path) => {
    const snapshotPath = join(destination, path);
    const worktreePath = join(source, path);
    const headBytes = run('git', ['show', `HEAD:${sourceGit.prefix}${path}`], {
      cwd: sourceGit.topLevel,
    });
    const headSha256 = createHash('sha256').update(headBytes).digest('hex');
    const snapshotSha256 = sha256File(snapshotPath);
    if (snapshotSha256 !== headSha256) {
      fail(`Clean snapshot did not retain committed HEAD bytes for excluded path ${path}.`);
    }
    return {
      path,
      excludedFromOverlay: true,
      worktreeSha256: sha256File(worktreePath),
      headSha256,
      snapshotSha256,
    };
  });

  return {
    source,
    destination,
    dirtyPaths,
    overlays: [...new Set([...OPERATE_V2_DEVELOPMENT_OVERLAYS, ...projectionEntries.keys()])],
    legacyRemovals,
    excludedProof,
  };
}

function packageManifest(root) {
  const cacheRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-npm-cache-'));
  try {
    const output = runNpm(['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: root,
      env: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_fund: 'false',
        npm_config_cache: cacheRoot,
      },
    });
    const [manifest] = JSON.parse(output);
    return manifest;
  } finally {
    rmSync(cacheRoot, { recursive: true, force: true });
  }
}

function extensionOf(path) {
  if (path.endsWith('.d.mts')) return '.d.mts';
  if (path.endsWith('.d.ts')) return '.d.ts';
  const index = path.lastIndexOf('.');
  return index === -1 ? '' : path.slice(index);
}

function readText(path) {
  if (!textExtensions.has(extensionOf(path))) return null;
  const bytes = readFileSync(path);
  if (bytes.includes(0)) return null;
  return bytes.toString('utf8');
}

function assertDependencyPurity(packageJson, lockJson) {
  const declarations = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
    lockJson?.packages?.['']?.dependencies,
    lockJson?.packages?.['']?.devDependencies,
  ];
  for (const declaration of declarations) {
    for (const [name, value] of Object.entries(declaration ?? {})) {
      if (
        /^(?:file|link|workspace):/i.test(value) ||
        isAbsolute(value) ||
        value.startsWith('../')
      ) {
        fail(`Forbidden non-registry dependency edge ${name}: ${value}`);
      }
    }
  }
}

function assertImportPurity(root, relativePath, text) {
  const importPattern = /(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (/^(?:file|link):/i.test(specifier)) {
      fail(`Forbidden file/link import in ${relativePath}: ${specifier}`);
    }
    if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/.test(specifier)) {
      fail(`Forbidden absolute import in ${relativePath}: ${specifier}`);
    }
    if (specifier.startsWith('.')) {
      const target = resolve(root, dirname(relativePath), specifier);
      const rel = relative(root, target);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        fail(`Sibling escape import in ${relativePath}: ${specifier}`);
      }
    }
  }
}

function assertPortableRuntimePurity(relativePath, text) {
  const portableV2 =
    relativePath.startsWith('schemas/v2.0.0/') ||
    relativePath.startsWith('conformance/fixtures/operating-runtime-v2/') ||
    relativePath === 'conformance/verify-operate-v2-contract-compilation.mjs' ||
    relativePath === 'conformance/verify-operate-v2-evidence.mjs' ||
    relativePath === 'conformance/verify-operate-v2-governed-execution.mjs' ||
    relativePath === 'conformance/verify-operate-v2-operating-intelligence.mjs' ||
    relativePath === 'conformance/verify-operate-v2-persistent-work.mjs' ||
    relativePath === 'conformance/verify-operating-runtime-v2.mjs' ||
    relativePath === 'lib/operate/evidence-filesystem-v2.mjs' ||
    relativePath === 'lib/operate/evidence-git-v2.mjs' ||
    relativePath === 'lib/operate/evidence-planr-v2.mjs' ||
    relativePath === 'lib/operate/evidence-artifact-v2.mjs' ||
    relativePath === 'lib/operate/evidence-materialization-v2.mjs' ||
    relativePath === 'lib/operate/evidence-projections-v2.mjs' ||
    relativePath === 'lib/operate/evidence-registry-v2.mjs' ||
    relativePath === 'lib/operate/evidence-v2.mjs' ||
    relativePath === 'lib/operate/extensions-v2.mjs' ||
    relativePath === 'lib/operate/governed-extensions-v2.mjs' ||
    relativePath === 'lib/operate/governed-recovery-v2.mjs' ||
    relativePath === 'lib/operate/reference-governed-executors-v2.mjs' ||
    relativePath === 'lib/operate/operating-domains-v2.mjs' ||
    relativePath === 'lib/operate/operating-state-v2.mjs' ||
    relativePath === 'lib/operate/operating-snapshots-v2.mjs' ||
    relativePath === 'lib/operate/operating-delta-v2.mjs' ||
    relativePath === 'lib/operate/operating-intelligence-state-v2.mjs' ||
    relativePath === 'lib/operate/intelligence-router-v2.mjs' ||
    relativePath === 'lib/operate/intelligence-ledger-v2.mjs' ||
    relativePath === 'lib/operate/intelligence-input-bundle-v2.mjs' ||
    relativePath === 'lib/operate/intelligence-output-identities-v2.mjs' ||
    relativePath === 'lib/operate/intelligence-result-validator-v2.mjs' ||
    relativePath === 'lib/operate/intelligence-replay-v2.mjs' ||
    relativePath === 'lib/operate/live-evidence-v2.mjs' ||
    relativePath === 'lib/operate/result-packet-v2.mjs' ||
    relativePath === 'lib/operate/assignment-contract-v2.mjs' ||
    relativePath === 'lib/operate/action-verification-v2.mjs' ||
    relativePath === 'lib/operate/execution-verification-v2.mjs' ||
    relativePath === 'lib/operate/authorization-v2.mjs' ||
    relativePath === 'lib/operate/operating-triggers-v2.mjs' ||
    relativePath === 'lib/operate/operating-signal-providers-v2.mjs' ||
    relativePath === 'lib/operate/persistent-work-v2.mjs' ||
    relativePath === 'lib/operate/cycle-closure-v2.mjs' ||
    relativePath === 'lib/operate/persistent-work-projections-v2.mjs' ||
    relativePath === 'lib/operate/runtime-foundation.mjs' ||
    /^lib\/operate\/runtime-foundation\/(?:authority|evidence-state|execution|intelligence|protocol)\.mjs$/.test(
      relativePath,
    ) ||
    relativePath === 'lib/operate/runtime-event-reducer-v2.mjs' ||
    relativePath === 'lib/operate/scheduler-v2.mjs' ||
    relativePath === 'lib/pipeline/landing-contract.mjs' ||
    relativePath === 'docs/protocol/operate-runtime-v2.md';
  const portableAdapter =
    relativePath.startsWith('adapters/codex/') || relativePath.startsWith('adapters/cursor/');
  if ((portableV2 || portableAdapter) && modelChoicePattern.test(text)) {
    fail(`Vendor model choice leaked into portable asset ${relativePath}.`);
  }
  if (portableAdapter) {
    const claudeRoot = ['CLAUDE', 'PLUGIN', 'ROOT'].join('_');
    const claudeCommand = '/' + ['planr-pipeline', 'operate'].join(':');
    if (text.includes(claudeRoot) || text.includes(claudeCommand)) {
      fail(`Foreign-runtime command/path leaked into ${relativePath}.`);
    }
  }
}

export function checkOperateRuntimePurity(root = repositoryRoot) {
  const packageRoot = realpathSync(root);
  const manifest = packageManifest(packageRoot);
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const lockPath = join(packageRoot, 'package-lock.json');
  let lockJson = null;
  try {
    lockJson = JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  assertDependencyPurity(packageJson, lockJson);

  const violations = [];
  for (const entry of manifest.files) {
    const relativePath = entry.path.replaceAll('\\', '/');
    try {
      if (
        relativePath.startsWith('.planr/') ||
        relativePath.startsWith('tests/') ||
        relativePath.startsWith('node_modules/') ||
        relativePath.startsWith('.env') ||
        privatePathFragments.some((fragment) => relativePath.includes(fragment))
      )
        fail(`Forbidden package path: ${relativePath}`);

      const absolutePath = join(packageRoot, relativePath);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) fail(`Packed development path is a symlink: ${relativePath}`);
      if (!stat.isFile()) fail(`Packed development path is not a regular file: ${relativePath}`);
      if (!isContained(packageRoot, absolutePath))
        fail(`Packed development path escapes package root: ${relativePath}`);
      const text = readText(absolutePath);
      if (text === null) continue;
      const machinePathInput = text
        .replaceAll('/' + 'Users' + '/user/', '/portable-user/')
        .replaceAll('/' + 'home' + '/user/', '/portable-user/');
      for (const pattern of absoluteMachinePatterns) {
        if (pattern.test(machinePathInput))
          fail(`Absolute machine path leaked into ${relativePath}.`);
      }
      for (const pattern of privateContentPatterns) {
        if (pattern.test(text))
          fail(`Private Operate planning material leaked into ${relativePath}.`);
      }
      assertImportPurity(packageRoot, relativePath, text);
      assertPortableRuntimePurity(relativePath, text);
    } catch (error) {
      violations.push({ path: relativePath, message: error.message });
    }
  }
  if (violations.length > 0) fail('Operate runtime purity check failed.', { violations });
  for (const path of UNIFIED_DASHBOARD_PROTOCOL_PATHS) {
    if (!manifest.files.some((entry) => entry.path.replaceAll('\\', '/') === path)) {
      fail(`Packed development package is missing unified dashboard protocol custody: ${path}`);
    }
  }
  return {
    ok: true,
    packageName: manifest.name,
    packageVersion: manifest.version,
    fileCount: manifest.files.length,
    unpackedSize: manifest.unpackedSize,
  };
}

export function packOperateV2DevelopmentSnapshot(
  destinationRoot,
  { sourceRoot = repositoryRoot } = {},
) {
  mkdirSync(destinationRoot, { recursive: true });
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-snapshot-'));
  const snapshotRoot = join(temporaryRoot, 'snapshot');
  mkdirSync(snapshotRoot);
  try {
    const snapshot = createOperateV2DevelopmentSnapshot(snapshotRoot, { sourceRoot });
    const sourcePurity = checkOperateRuntimePurity(snapshotRoot);
    const packedOutput = runNpm(
      ['pack', '--ignore-scripts', '--json', '--pack-destination', resolve(destinationRoot)],
      {
        cwd: snapshotRoot,
        env: {
          ...process.env,
          npm_config_audit: 'false',
          npm_config_fund: 'false',
          npm_config_cache: join(temporaryRoot, 'npm-cache'),
        },
      },
    );
    const [packed] = JSON.parse(packedOutput);
    const tarballPath = resolve(destinationRoot, packed.filename);
    const extractedRoot = join(temporaryRoot, 'extracted');
    mkdirSync(extractedRoot);
    run('tar', ['-xzf', tarballPath, '-C', extractedRoot, '--strip-components=1']);
    const tarballPurity = checkOperateRuntimePurity(extractedRoot);
    return {
      ok: true,
      packageName: packed.name,
      version: packed.version,
      filename: packed.filename,
      tarballPath,
      sha256: createHash('sha256').update(readFileSync(tarballPath)).digest('hex'),
      shasum: packed.shasum,
      integrity: packed.integrity,
      fileCount: packed.entryCount,
      unpackedSize: packed.unpackedSize,
      files: packed.files,
      sourcePurity,
      tarballPurity,
      cleanSnapshot: snapshot,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  try {
    const packDestination = optionValue('--pack-clean');
    const root = optionValue('--root');
    const result = packDestination
      ? packOperateV2DevelopmentSnapshot(packDestination, { sourceRoot: root ?? repositoryRoot })
      : checkOperateRuntimePurity(root ?? repositoryRoot);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          error: error.message,
          details: error.details ?? null,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}
