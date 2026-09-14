#!/usr/bin/env node

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { excludePrivateDecisionRecords } from './private-decision-records.mjs';
import path from 'node:path';

import { DIAGRAM_V16_REGISTRIES, PROTOCOL_V17_REGISTRIES } from '../../packages/protocol/src/skill-source-contracts.mjs';
import {
  BASELINE_PATH,
  DOCUMENTATION_PATH,
  EXPECTED_SOURCES,
  FEATURES,
  INVENTORY_PATH,
  REPOSITORY_ROOT,
  SURFACE_PATH,
  assert,
  documentDigest,
  fileSha256,
  inferFeatureId,
  normalizeRelativePath,
  pathKind,
  prettyJson,
  readJson,
  sealDocument,
  sha256,
  sortedUnique,
} from './preservation-lib.mjs';

const argv = process.argv.slice(2);
const writeMode = argv.includes('--write');
const checkMode = argv.includes('--check');
assert(writeMode !== checkMode, 'Pass exactly one mode: --write or --check.');
const mode = writeMode ? 'write' : 'check';
const evidenceFlag = argv.indexOf('--evidence');
const evidencePath = evidenceFlag >= 0 ? argv[evidenceFlag + 1] : process.env.OPENPLANR_SOURCE_EVIDENCE;
const ROOT_WORKFLOW_CONTRACT_PATHS = new Set([
  'tests/release-workflow.test.ts',
  'tests/unit/pipeline-pin-parity.test.ts',
]);
const EVOLVED_MAPPING_IDS = new Set([
  // Release proofs follow declared package versions across Changesets updates.
  'planr-pipeline:cutoff:tests/ecosystem/operate-v2-product-package.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/doctor-release-changelog.test.mjs',
  // Public docs retain normative rules after private ADR links are removed.
  // The legacy canary is explicitly identified as a manual consumer audit.
  'planr-pipeline:cutoff:docs/artifact-review.md',
  'planr-pipeline:cutoff:scripts/artifact-release-canary.mjs',
  // Review counts now use all durable pins rather than the visible thread subset.
  'planr-pipeline:cutoff:tests/collab-review-board.test.mjs',
  // Snapshot-identity truth caching avoids repeated validation while preserving trust checks.
  'planr-pipeline:cutoff:lib/dashboard/operate-experience-reader.mjs',
  'planr-pipeline:cutoff:tests/dashboard/operate-experience-reader.test.mjs',
  // Public package policies delegate to the maintained monorepo policy.
  'openplanr-cli:cutoff:CONTRIBUTING.md',
  'openplanr-cli:cutoff:SECURITY.md',
  // CLI diagnostics and crash-safe credential persistence evolved after consolidation.
  'openplanr-cli:overlay:src/cli/error-boundary.ts',
  'openplanr-cli:cutoff:src/services/credential-backends.ts',
  'openplanr-cli:cutoff:tests/unit/credential-backends.test.ts',
  // Public snapshot removes internal issue narration; behavior and original cutoffs remain preserved.
  'openplanr-cli:cutoff:src/cli/helpers/bulk-checkbox-update.ts',
  'openplanr-cli:cutoff:src/services/linear/task-status-aggregation.ts',
  'openplanr-cli:cutoff:tests/linear-estimate-sync.test.ts',
  'openplanr-cli:cutoff:tests/linear-push-granular.test.ts',
  'openplanr-cli:cutoff:tests/linear-push-standalone.test.ts',
  'openplanr-cli:cutoff:tests/tasklist-sync-stale-id.test.ts',
  'openplanr-cli:cutoff:tests/unit/apply-all-checkboxes.test.ts',
  'openplanr-cli:cutoff:tests/unit/bulk-checkbox-update.test.ts',
  'openplanr-cli:cutoff:tests/unit/diff.test.ts',
  'openplanr-cli:cutoff:tests/unit/story-template-render.test.ts',
  'openplanr-cli:cutoff:tests/unit/task-status-aggregation.test.ts',
  'openplanr-cli:cutoff:tests/unit/upgrade-service.test.ts',
  'planr-pipeline:cutoff:.env.example',

  'openplanr-cli:cutoff:AGENTS.md',
  'openplanr-cli:cutoff:CLAUDE.md',
  'openplanr-cli:cutoff:docs/CLI.md',
  'openplanr-cli:cutoff:docs/CROSS_RUNTIME_SETUP.md',
  'openplanr-cli:cutoff:input/tech/stack.md',
  'openplanr-cli:cutoff:lib/dashboard-verifier.mjs',
  'openplanr-cli:cutoff:README.md',
  // Professional Design adds a shared-source studio route and its CLI bridge.
  'openplanr-cli:cutoff:src/cli/commands/artifact.ts',
  'openplanr-cli:cutoff:src/services/artifact-pipeline-service.ts',
  'openplanr-cli:overlay:src/cli/commands/operate.ts',
  'openplanr-cli:cutoff:src/cli/commands/backlog.ts',
  'openplanr-cli:cutoff:src/cli/commands/epic.ts',
  'openplanr-cli:cutoff:src/cli/commands/feature.ts',
  'openplanr-cli:cutoff:src/cli/commands/rules.ts',
  'openplanr-cli:cutoff:src/cli/commands/setup.ts',
  'openplanr-cli:cutoff:src/cli/commands/spec.ts',
  'openplanr-cli:cutoff:src/cli/commands/sprint.ts',
  'openplanr-cli:cutoff:src/cli/commands/task.ts',
  'openplanr-cli:cutoff:src/generators/base-generator.ts',
  'openplanr-cli:cutoff:src/generators/claude-generator.ts',
  'openplanr-cli:cutoff:src/generators/codex-generator.ts',
  'openplanr-cli:cutoff:src/generators/cursor-generator.ts',
  'openplanr-cli:cutoff:src/models/schema.ts',
  'openplanr-cli:cutoff:src/models/types.ts',
  'openplanr-cli:cutoff:src/services/claude-plugin-service.ts',
  'openplanr-cli:cutoff:src/services/credentials-service.ts',
  'openplanr-cli:cutoff:src/services/linear-pull-service.ts',
  'openplanr-cli:cutoff:src/services/linear-push-service.ts',
  'openplanr-cli:cutoff:src/services/linear/constants.ts',
  'openplanr-cli:cutoff:src/services/runtime-manager-service.ts',
  'openplanr-cli:overlay:src/services/runtime-manager/doctor.ts',
  'openplanr-cli:overlay:src/services/runtime-manager/inventory.ts',
  'openplanr-cli:overlay:src/services/runtime-manager/global-state.ts',
  'openplanr-cli:overlay:src/services/operate/path-custody.ts',
  'openplanr-cli:overlay:src/services/operate/planning-handoff-service.ts',
  'openplanr-cli:overlay:src/services/operate/spec-operating-origin-service.ts',
  'openplanr-cli:overlay:src/services/operate/store.ts',
  'openplanr-cli:cutoff:src/services/spec-service.ts',
  'openplanr-cli:cutoff:src/services/template-service.ts',
  'openplanr-cli:cutoff:src/templates/rules/claude/CLAUDE.md.hbs',
  'openplanr-cli:cutoff:src/templates/rules/codex/AGENTS.md.hbs',
  'openplanr-cli:cutoff:src/templates/rules/cursor/create-task-list.mdc.hbs',
  'openplanr-cli:cutoff:src/templates/rules/cursor/implement-task-list.mdc.hbs',
  'openplanr-cli:cutoff:src/templates/spec/spec-shaped.md.hbs',
  'openplanr-cli:cutoff:src/templates/spec/spec.md.hbs',
  'openplanr-cli:cutoff:src/templates/spec/story.md.hbs',
  'openplanr-cli:cutoff:src/templates/spec/task.md.hbs',
  'openplanr-cli:cutoff:src/utils/constants.ts',
  'openplanr-cli:cutoff:src/utils/logger.ts',
  'openplanr-cli:overlay:tests/integration/operate-measurement-schedule.test.ts',
  'openplanr-cli:cutoff:tests/e2e/fixtures/dashboard-api-fixture.mjs',
  'openplanr-cli:overlay:tests/e2e/land-sandbox.test.ts',
  'openplanr-cli:overlay:tests/integration/cli-boundary.test.ts',
  'openplanr-cli:cutoff:tests/unit/generator-factory.test.ts',
  'openplanr-cli:overlay:tests/unit/spec-command.test.ts',
  'openplanr-cli:cutoff:tests/unit/spec-service.test.ts',
  'openplanr-cli:cutoff:tests/unit/credentials-service.test.ts',
  'openplanr-cli:cutoff:tests/unit/claude-plugin-service.test.ts',
  'openplanr-cli:cutoff:tests/unit/logger.test.ts',
  'planr-pipeline:cutoff:bin/planr-pipeline.mjs',
  'planr-pipeline:cutoff:tests/dashboard/server.test.mjs',
  // These retained browser tests now support installed Chrome and native keys
  // inside scaled previews while preserving the same capability assertions.
  'planr-pipeline:cutoff:tests/artifact/design-board-integration.test.mjs',
  'planr-pipeline:cutoff:tests/artifact/sandbox-hostile.test.mjs',
  // The review shell now owns fixed, mobile-safe comment composition and compact replies.
  'planr-pipeline:cutoff:templates/artifact-review-shell.html',
  // The review-stage controller now preserves stable pins, focused modes, and smooth transitions.
  'planr-pipeline:cutoff:templates/artifact-review-stage.js',
  'planr-pipeline:cutoff:.cursor/rules/implement-task-list.mdc',
  'planr-pipeline:cutoff:AGENTS.md',
  'planr-pipeline:cutoff:CLAUDE.md',
  'planr-pipeline:cutoff:conformance/fixtures/guided-runtime-parity/generated-assets.json',
  'planr-pipeline:cutoff:conformance/fixtures/landing-workflow/generated-assets.json',
  'planr-pipeline:cutoff:conformance/fixtures/operate-adapter-parity/generated-assets.json',
  'planr-pipeline:cutoff:conformance/fixtures/professional-skills/generated-assets.json',
  'planr-pipeline:cutoff:docs/pipeline-overview.md',
  'planr-pipeline:cutoff:docs/compatibility-matrix.md',
  'planr-pipeline:cutoff:docs/doctor.md',
  'planr-pipeline:cutoff:docs/ecosystem-guide.md',
  'planr-pipeline:cutoff:docs/ownership-map.md',
  'planr-pipeline:cutoff:docs/protocol/commands.md',
  'planr-pipeline:cutoff:docs/protocol/README.md',
  'planr-pipeline:cutoff:docs/protocol/runtime-adapters.md',
  'planr-pipeline:cutoff:docs/protocol/spec-artifacts.md',
  'planr-pipeline:cutoff:docs/rules.md',
  'planr-pipeline:cutoff:docs/runtime-guided-interactions.md',
  'planr-pipeline:cutoff:docs/release-checklist.md',
  'planr-pipeline:cutoff:docs/release-ledger.md',
  'planr-pipeline:cutoff:docs/spec-anatomy.md',
  'planr-pipeline:cutoff:input/tech/stack.md',
  'planr-pipeline:cutoff:lib/dashboard/graph-reader.mjs',
  'planr-pipeline:cutoff:lib/pipeline/context-envelope.mjs',
  'planr-pipeline:cutoff:lib/pipeline/landing.mjs',
  'planr-pipeline:cutoff:lib/ecosystem/workspace-discovery.mjs',
  'planr-pipeline:cutoff:lib/evaluation/parity.mjs',
  'planr-pipeline:cutoff:lib/pipeline/professional-skills.d.mts',
  'planr-pipeline:cutoff:lib/pipeline/professional-skills.mjs',
  'planr-pipeline:cutoff:lib/pipeline/runtime.mjs',
  'planr-pipeline:cutoff:lib/pipeline/ship-context.d.mts',
  'planr-pipeline:cutoff:lib/pipeline/ship-context.mjs',
  'planr-pipeline:cutoff:planr-pipeline.md',
  'planr-pipeline:cutoff:README.md',
  'planr-pipeline:cutoff:scripts/check-workflow-alias-parity.mjs',
  'planr-pipeline:cutoff:scripts/generate-guided-adapters.mjs',
  'planr-pipeline:cutoff:scripts/doctor.mjs',
  'planr-pipeline:cutoff:scripts/verify-release-ledger.mjs',
  'planr-pipeline:cutoff:templates/spec-driven.md.tpl',
  'planr-pipeline:cutoff:templates/spec.md.tpl',
  'planr-pipeline:cutoff:templates/stack.md.tpl',
  'planr-pipeline:cutoff:tests/docs/markdown-contracts.test.mjs',
  'planr-pipeline:cutoff:tests/docs/generated-registry-docs.test.mjs',
  'planr-pipeline:cutoff:tests/ecosystem/operate-v2-adapter-parity.test.mjs',
  'planr-pipeline:cutoff:tests/ecosystem/portable-adapters.test.mjs',
  'planr-pipeline:cutoff:tests/ecosystem/release-ledger-drift.test.mjs',
  'planr-pipeline:cutoff:tests/ecosystem/workspace-discovery.test.mjs',
  'planr-pipeline:cutoff:tests/evaluation/parity.test.mjs',
  'planr-pipeline:cutoff:tests/fixtures/legacy-planning/input/tech/stack.md',
  'planr-pipeline:cutoff:tests/orchestration/context-envelope.test.mjs',
  'planr-pipeline:cutoff:tests/orchestration/guided-runtime-adapters.test.mjs',
  'planr-pipeline:cutoff:tests/orchestration/operate-role-skills-v2.test.mjs',
  'planr-pipeline:cutoff:tests/orchestration/professional-skills.test.mjs',
  'planr-pipeline:cutoff:tests/orchestration/ship-guidance-closure.test.mjs',
  'planr-pipeline:cutoff:tests/orchestration/workflow-alias-parity.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/cli-boundary.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/engine.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/planning-review.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/packaged-doctor.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/runtime.test.mjs',
  'planr-pipeline:cutoff:tests/pipeline/ship-closure.test.mjs',
  'planr-pipeline:cutoff:tests/schema/landing-contracts.test.mjs',
]);

const HOST_NATIVE_MERGED_MAPPINGS = new Map([
  ...[
    'context-builder.ts',
    'file-reader.ts',
    'index.ts',
    'pattern-rules.ts',
    'rules-reader.ts',
    'stack-detector.ts',
    'tree-generator.ts',
  ].map((file) => [
    `openplanr-cli:cutoff:src/ai/codebase/${file}`,
    ['skills/planr-plan/SKILL.md', 'skills/planr-ship/SKILL.md'],
  ]),
  [
    'openplanr-cli:cutoff:src/ai/prompts/prompt-builder.ts',
    ['skills/planr-spec/SKILL.md', 'skills/planr-plan/SKILL.md'],
  ],
  [
    'openplanr-cli:cutoff:src/ai/prompts/system-prompts.ts',
    ['skills/planr-spec/SKILL.md', 'skills/planr-plan/SKILL.md', 'skills/planr-ship/SKILL.md'],
  ],
  [
    'openplanr-cli:cutoff:src/ai/schemas/ai-response-schemas.ts',
    ['packages/protocol/schemas/v1.8.0/skill-package.schema.json'],
  ],
  [
    'openplanr-cli:cutoff:src/ai/validation/index.ts',
    ['packages/skill-runtime/src/authoring/standard-package.mjs'],
  ],
  [
    'openplanr-cli:cutoff:src/ai/validation/task-validator.ts',
    ['skills/planr-plan/references/artifact-contract.md'],
  ],
  [
    'openplanr-cli:cutoff:src/cli/commands/config.ts',
    ['packages/cli/src/cli/commands/config-deterministic.ts'],
  ],
  [
    'openplanr-cli:cutoff:src/cli/commands/init.ts',
    ['packages/cli/src/cli/commands/init-deterministic.ts'],
  ],
  ...['estimate.ts', 'refine.ts', 'revise.ts'].map((file) => [
    `openplanr-cli:cutoff:src/cli/commands/${file}`,
    ['skills/planr-spec/SKILL.md', 'skills/planr-plan/SKILL.md'],
  ]),
  [
    'openplanr-cli:cutoff:src/cli/commands/plan.ts',
    ['skills/planr-plan/SKILL.md'],
  ],
  [
    'openplanr-cli:cutoff:src/cli/helpers/task-creation.ts',
    ['packages/cli/src/cli/commands/planning-artifacts.ts'],
  ],
  [
    'openplanr-cli:cutoff:src/services/artifact-gathering.ts',
    ['skills/planr-plan/SKILL.md', 'skills/planr-ship/SKILL.md'],
  ],
  [
    'openplanr-cli:cutoff:src/services/revise-service.ts',
    ['skills/planr-spec/SKILL.md'],
  ],
  [
    'openplanr-cli:overlay:src/services/skill-distribution-service.ts',
    ['scripts/skills/generate-v18.mjs', 'packages/cli/src/services/runtime-manager-service.ts'],
  ],
  [
    'openplanr-cli:overlay:tests/unit/pipeline-command.test.ts',
    ['packages/cli/tests/unit/command-registration-parity.test.ts'],
  ],
  [
    'openplanr-cli:overlay:tests/unit/skill-distribution-service.test.ts',
    ['packages/pipeline/tests/ecosystem/host-native-packaging.test.mjs'],
  ],
  [
    'openplanr-cli:cutoff:tests/unit/pattern-rules.test.ts',
    ['packages/pipeline/tests/ecosystem/host-native-packaging.test.mjs'],
  ],
  [
    'openplanr-cli:cutoff:tests/unit/prompt-builder.test.ts',
    ['tests/skill-runtime/generation.test.mjs'],
  ],
  ...[
    'revise-apply-service.test.ts',
    'revise-cache-service.test.ts',
    'revise-plan-service.test.ts',
    'revise-service.test.ts',
  ].map((file) => [
    `openplanr-cli:cutoff:tests/unit/${file}`,
    ['tests/skill-runtime/generation.test.mjs'],
  ]),
  [
    'openplanr-cli:cutoff:tests/unit/rules-reader.test.ts',
    ['packages/pipeline/tests/ecosystem/host-native-packaging.test.mjs'],
  ],
  [
    'openplanr-cli:cutoff:tests/unit/task-creation-helpers.test.ts',
    ['packages/cli/tests/unit/spec-service.test.ts'],
  ],
  [
    'openplanr-cli:cutoff:tests/unit/task-validator.test.ts',
    ['tests/skill-runtime/generation.test.mjs'],
  ],
]);

const HOST_NATIVE_RETIRED_MAPPING_IDS = new Set([
  'openplanr-cli:cutoff:src/ai/errors.ts',
  'openplanr-cli:cutoff:src/ai/index.ts',
  'openplanr-cli:cutoff:src/ai/provider-factory.ts',
  'openplanr-cli:cutoff:src/ai/providers/anthropic-provider.ts',
  'openplanr-cli:cutoff:src/ai/providers/ollama-provider.ts',
  'openplanr-cli:cutoff:src/ai/providers/openai-provider.ts',
  'openplanr-cli:cutoff:src/ai/types.ts',
  'openplanr-cli:cutoff:src/cli/commands/pipeline.ts',
  'openplanr-cli:cutoff:src/templates/rules/claude/planr-pipeline.md.hbs',
  'openplanr-cli:cutoff:src/services/ai-service.ts',
  'openplanr-cli:overlay:src/cli/commands/evidence.ts',
  'openplanr-cli:cutoff:tests/unit/ai-errors.test.ts',
  'openplanr-cli:cutoff:tests/unit/ai-schemas.test.ts',
  'openplanr-cli:cutoff:tests/unit/ai-service-truncation.test.ts',
  'openplanr-cli:cutoff:tests/unit/deprecation-notices.test.ts',
  'openplanr-cli:cutoff:tests/unit/provider-factory.test.ts',
  'openplanr-cli:overlay:tests/unit/live-evidence-cli.test.ts',
]);

const evidence = evidencePath ? JSON.parse(await readFile(path.resolve(evidencePath), 'utf8')) : null;
if (evidence) validateEvidence(evidence);

const privateCustodyFlag = argv.indexOf('--private-decision-custody');
const privateDecisionCustodyRoot = privateCustodyFlag >= 0 ? argv[privateCustodyFlag + 1] : undefined;
const evolvedPathInventory = evidence
  ? await buildPathInventory(evidence)
  : await applyExplicitEvolutionMappings(
      await readAndVerifyCommittedDocument(
        INVENTORY_PATH,
        'openplanr-preservation-path-inventory',
      ),
    );
const pathInventory = await excludePrivateDecisionRecords(evolvedPathInventory, { custodyRoot: privateDecisionCustodyRoot });
const committedSurface = evidence
  ? null
  : await readAndVerifyCommittedDocument(SURFACE_PATH, 'openplanr-preservation-surface-catalog');
const surfaceCatalog = await buildSurfaceCatalog(evidence, pathInventory, committedSurface);
const baseline = sealDocument({
  kind: 'openplanr-preservation-verification-baseline',
  schemaVersion: '1.0.0',
  migrationId: 'openplanr-monorepo',
  inventoryDigest: pathInventory.documentDigest,
  surfaceCatalogDigest: surfaceCatalog.documentDigest,
  coverage: {
    cutoffTrackedPaths: pathInventory.coverage.cutoffTrackedPaths,
    includedOpenPlanrOverlayPaths: pathInventory.coverage.includedOpenPlanrOverlayPaths,
    pathRecords: pathInventory.pathMappings.length,
    unmappedPaths: 0,
    features: surfaceCatalog.features.length,
    rootCommands: surfaceCatalog.commands.root.length,
    pipelineMachineLeaves: surfaceCatalog.commands.pipelineMachine.length,
    frozenAliases: surfaceCatalog.commands.frozenAliases.length,
    canonicalSkills: surfaceCatalog.skills.canonical.length,
    roles: surfaceCatalog.roles.length,
    rules: surfaceCatalog.rules.length,
    originalSchemas: surfaceCatalog.schemas.original.length,
    additiveSchemas: surfaceCatalog.schemas.additive.length,
    legacyRegistries: surfaceCatalog.registries.legacy.length,
    canonicalRegistries: surfaceCatalog.registries.canonical.length,
    baselinePackageExports: surfaceCatalog.packageSurface.baselineExportKeys.length,
    baselineRootSymbols: surfaceCatalog.packageSurface.baselineRootSymbols.length,
    generators: surfaceCatalog.generators.length,
    generatedAssets: surfaceCatalog.generatedAssets.length,
    outputContracts: surfaceCatalog.outputs.length,
    outputClasses: sortedUnique(surfaceCatalog.outputs.map((output) => output.outputClass)),
  },
});
const documentation = renderDocumentation(pathInventory, surfaceCatalog, baseline);

await emitOrCheck(INVENTORY_PATH, pathInventory);
await emitOrCheck(SURFACE_PATH, surfaceCatalog);
await emitOrCheck(BASELINE_PATH, baseline);
if (mode === 'write') await writePrivateReport(DOCUMENTATION_PATH, documentation);

console.log(
  JSON.stringify({
    status: 'PASS',
    mode,
    sourceFloor: evidence ? 'custody-evidence' : 'committed-redacted-inventory',
    files: [INVENTORY_PATH, SURFACE_PATH, BASELINE_PATH],
    privateReport: mode === 'write' ? DOCUMENTATION_PATH : null,
    coverage: baseline.coverage,
  }),
);

function validateEvidence(value) {
  assert(value?.schemaVersion === '1.0.0', `Unexpected evidence schema: ${value?.schemaVersion}`);
  assert(value?.hashAlgorithm === 'sha256', `Unexpected evidence hash algorithm: ${value?.hashAlgorithm}`);
  assert(Array.isArray(value.sources) && value.sources.length === 5, 'Evidence must contain exactly five sources.');
  for (const [evidenceId, expected] of Object.entries(EXPECTED_SOURCES)) {
    const source = value.sources.find((candidate) => candidate.id === evidenceId);
    assert(source, `Missing source evidence: ${evidenceId}`);
    assert(source.pin === expected.cutoffCommit, `${evidenceId} cutoff changed: ${source.pin}`);
    assert(source.head === expected.cutoffCommit, `${evidenceId} HEAD changed: ${source.head}`);
    assert(source.pinMatches === true, `${evidenceId} no longer matches its cutoff.`);
    assert(source.package?.name === expected.packageName, `${evidenceId} package name changed.`);
    assert(source.package?.version === expected.packageVersion, `${evidenceId} package version changed.`);
    assert(source.headTree?.length === expected.cutoffTrackedPaths, `${evidenceId} cutoff path count changed.`);
  }
}

async function buildPathInventory(value) {
  const mappings = [];
  const sources = [];
  for (const source of value.sources) {
    const expected = EXPECTED_SOURCES[source.id];
    const currentByPath = new Map(source.trackedCurrent.map((entry) => [entry.path, entry]));
    const statusByPath = new Map(source.statusEntries.map((entry) => [entry.path, entry.xy]));
    let includedCount = 0;

    for (const cutoff of source.headTree) {
      const current = currentByPath.get(cutoff.path);
      const status = statusByPath.get(cutoff.path) ?? '  ';
      const included = current?.state === 'present';
      if (included) includedCount += 1;
      mappings.push(
        await createMapping({
          evidenceId: source.id,
          sourceId: expected.sourceId,
          sourcePath: cutoff.path,
          cutoff,
          included: included
            ? {
                state: status.trim() ? 'tracked-overlay' : 'cutoff',
                mode: current.mode,
                sha256: current.sha256OrGitlink,
              }
            : { state: 'deleted-overlay', mode: null, sha256: null },
        }),
      );
    }

    for (const untracked of source.untracked) {
      includedCount += 1;
      mappings.push(
        await createMapping({
          evidenceId: source.id,
          sourceId: expected.sourceId,
          sourcePath: untracked.path,
          cutoff: null,
          included: {
            state: 'untracked-overlay',
            mode: untracked.mode,
            sha256: untracked.sha256,
          },
        }),
      );
    }

    assert(includedCount === expected.includedPaths, `${source.id} included path count changed: ${includedCount}`);
    sources.push({
      sourceId: expected.sourceId,
      cutoffCommit: expected.cutoffCommit,
      includedState:
        source.id === 'web'
          ? 'external-reference'
          : source.counts.untracked > 0
            ? 'tracked-and-untracked-dirty'
            : source.counts.modified > 0
              ? 'tracked-dirty'
              : 'clean',
      package: { name: expected.packageName, version: expected.packageVersion },
      cutoffTrackedPaths: source.headTree.length,
      includedPaths: includedCount,
      fingerprints: {
        cutoffTreeSha256: source.fingerprints.headTreeSha256,
        trackedCurrentSha256: source.fingerprints.trackedCurrentSha256,
        trackedPatchSha256: source.fingerprints.binaryDiffSha256,
        untrackedInventorySha256: source.fingerprints.untrackedSha256,
        statusSha256: source.fingerprints.statusSha256,
      },
      licenses: source.licenseFiles.map(({ path: licensePath, sha256: digest, bytes }) => ({
        path: licensePath,
        sha256: digest,
        bytes,
      })),
    });
  }

  mappings.sort((left, right) =>
    `${left.sourceId}\0${left.sourcePath}\0${left.included.state}`.localeCompare(
      `${right.sourceId}\0${right.sourcePath}\0${right.included.state}`,
    ),
  );

  const dispositionCounts = Object.create(null);
  for (const mapping of mappings) dispositionCounts[mapping.disposition] = (dispositionCounts[mapping.disposition] ?? 0) + 1;

  return sealDocument({
    kind: 'openplanr-preservation-path-inventory',
    schemaVersion: '1.0.0',
    protocolVersion: '1.5.0',
    migrationId: 'openplanr-monorepo',
    integrationVersion: '0.1.0',
    destinationRepository: 'openplanr/OpenPlanr',
    digestAlgorithm: 'sha256',
    sourceEvidencePolicy: 'redacted-custody-projection',
    allowedDispositions: ['exact', 'moved', 'merged', 'regenerated', 'retired', 'external', 'excluded'],
    sources,
    coverage: {
      cutoffTrackedPaths: sources.reduce((sum, source) => sum + source.cutoffTrackedPaths, 0),
      includedOpenPlanrOverlayPaths: sources.find((source) => source.sourceId === 'openplanr-cli').includedPaths,
      pathRecords: mappings.length,
      dispositionCounts,
      unmappedPaths: 0,
    },
    pathMappings: mappings,
  });
}

/**
 * The redacted inventory is the no-source-evidence generation floor. These
 * exact mapping IDs are the reviewed files deliberately evolved after the
 * untouched integration checkpoint. No unlisted mismatch is reclassified.
 */
async function applyExplicitEvolutionMappings(committed) {
  const inventory = structuredClone(committed);
  const mappings = new Map(
    inventory.pathMappings.map((mapping) => [mapping.mappingId, mapping]),
  );
  let changed = false;

  for (const [mappingId, destinationPaths] of HOST_NATIVE_MERGED_MAPPINGS) {
    const mapping = mappings.get(mappingId);
    assert(mapping, `Host-native workflow merged mapping is missing: ${mappingId}`);
    const destinations = destinationPaths.map((destinationPath) =>
      destination(destinationPath, 'spec-012-successor'),
    );
    for (const successor of destinations) {
      assert(
        (await pathKind(successor.path)) !== 'missing',
        `Host-native workflow successor is missing for ${mappingId}: ${successor.path}`,
      );
    }
    mapping.disposition = 'merged';
    mapping.reasonCode = 'spec-012-host-native-or-deterministic-successor';
    mapping.destinations = destinations;
    mapping.verification = { policy: 'destination-exists', requirement: 'any' };
    changed = true;
  }

  for (const mappingId of HOST_NATIVE_RETIRED_MAPPING_IDS) {
    const mapping = mappings.get(mappingId);
    assert(mapping, `Host-native workflow retired mapping is missing: ${mappingId}`);
    mapping.disposition = 'retired';
    mapping.reasonCode = 'spec-012-model-provider-or-obsolete-governance-retirement';
    mapping.destinations = [];
    mapping.verification = { policy: 'declared-absence' };
    changed = true;
  }

  for (const mappingId of EVOLVED_MAPPING_IDS) {
    const mapping = mappings.get(mappingId);
    assert(mapping, `Explicit evolved mapping is missing: ${mappingId}`);
    if (
      mapping.disposition === 'merged' &&
      mapping.reasonCode === 'post-integration-destination-evolution'
    ) {
      continue;
    }
    assert(
      mapping.verification?.policy === 'byte-bound',
      `Explicit evolved mapping has an unexpected policy: ${mappingId}`,
    );
    let hasExistingDestination = false;
    let hasExactDestination = false;
    for (const destination of mapping.destinations) {
      const kind = await pathKind(destination.path);
      if (kind === 'missing') continue;
      hasExistingDestination = true;
      if (
        kind === 'file' &&
        (await fileSha256(destination.path)) === mapping.verification.sha256
      ) {
        hasExactDestination = true;
      }
    }
    assert(hasExistingDestination, `Explicit evolved destination is missing: ${mappingId}`);
    assert(!hasExactDestination, `Explicit evolved destination is still byte-identical: ${mappingId}`);
    mapping.disposition = 'merged';
    mapping.reasonCode = 'post-integration-destination-evolution';
    mapping.verification = { policy: 'destination-exists', requirement: 'any' };
    changed = true;
  }

  if (!changed) return committed;
  inventory.coverage.dispositionCounts = Object.create(null);
  for (const mapping of inventory.pathMappings) {
    inventory.coverage.dispositionCounts[mapping.disposition] =
      (inventory.coverage.dispositionCounts[mapping.disposition] ?? 0) + 1;
  }
  delete inventory.documentDigest;
  return sealDocument(inventory);
}

async function createMapping({ evidenceId, sourceId, sourcePath, cutoff, included }) {
  normalizeRelativePath(sourcePath);
  const mappingId = `${sourceId}:${included.state === 'untracked-overlay' ? 'overlay' : 'cutoff'}:${sourcePath}`;

  if (evidenceId === 'web') {
    return {
      mappingId,
      sourceId,
      sourcePath,
      cutoff: cutoffRecord(cutoff),
      included,
      disposition: 'external',
      reasonCode: 'external-web-repository-and-deployments',
      destinations: [{ path: `external/openplanr-web/${sourcePath}`, custody: 'external-reference', kind: 'external' }],
      verification: { policy: 'external-reference' },
    };
  }

  if (included.state === 'deleted-overlay') {
    return {
      mappingId,
      sourceId,
      sourcePath,
      cutoff: cutoffRecord(cutoff),
      included,
      disposition: 'retired',
      reasonCode: 'included-source-overlay-deletion',
      destinations: [],
      verification: { policy: 'declared-absence' },
    };
  }

  if (sourcePath === 'package-lock.json') {
    return mergedMapping(mappingId, sourceId, sourcePath, cutoff, included, 'root-lockfile-custody', [
      destination('package-lock.json', 'root-workspace-lockfile'),
      destination('package.json', 'workspace-contract'),
    ]);
  }

  const candidates = destinationCandidates(evidenceId, sourcePath);
  const existing = [];
  for (const candidate of candidates) {
    const kind = await pathKind(candidate.path);
    if (kind !== 'missing') existing.push({ ...candidate, kind });
  }

  const byteMatch = [];
  if (included.sha256) {
    for (const candidate of existing.filter((entry) => entry.kind === 'file')) {
      if ((await fileSha256(candidate.path)) === included.sha256) byteMatch.push(candidate);
    }
  }

  const generated = generatedSourcePath(evidenceId, sourcePath);
  const merged = mergedSourcePath(evidenceId, sourcePath);
  if (generated) {
    return {
      mappingId,
      sourceId,
      sourcePath,
      cutoff: cutoffRecord(cutoff),
      included,
      disposition: 'regenerated',
      reasonCode: generated,
      destinations: candidates,
      verification: { policy: 'destination-exists', requirement: 'any' },
    };
  }
  if (merged || byteMatch.length === 0) {
    const fallback = dedupeDestinations([...candidates, fallbackDestination(evidenceId, sourcePath)]);
    return mergedMapping(
      mappingId,
      sourceId,
      sourcePath,
      cutoff,
      included,
      merged ?? 'destination-content-integrated',
      fallback,
    );
  }

  return {
    mappingId,
    sourceId,
    sourcePath,
    cutoff: cutoffRecord(cutoff),
    included,
    disposition: evidenceId === 'openplanr' && !sourcePath.startsWith('src/dashboard/') ? 'moved' : 'exact',
    reasonCode: 'byte-preserved-destination',
    destinations: byteMatch,
    verification: {
      policy: 'byte-bound',
      requirement: 'any',
      sha256: included.sha256,
      executable: included.mode === '100755',
    },
  };
}

function cutoffRecord(cutoff) {
  return cutoff
    ? { present: true, mode: cutoff.mode, gitObject: cutoff.object, gitType: cutoff.type }
    : { present: false, mode: null, gitObject: null, gitType: null };
}

function destination(destinationPath, custody = 'compatibility') {
  return { path: normalizeRelativePath(destinationPath), custody, kind: 'file' };
}

function dedupeDestinations(destinations) {
  return [...new Map(destinations.map((entry) => [entry.path, entry])).values()];
}

function mergedMapping(mappingId, sourceId, sourcePath, cutoff, included, reasonCode, destinations) {
  return {
    mappingId,
    sourceId,
    sourcePath,
    cutoff: cutoffRecord(cutoff),
    included,
    disposition: 'merged',
    reasonCode,
    destinations,
    verification: { policy: 'destination-exists', requirement: 'any' },
  };
}

function destinationCandidates(evidenceId, sourcePath) {
  if (evidenceId === 'openplanr') {
    if (sourcePath.startsWith('.github/')) {
      return [destination(sourcePath, 'root-workflow'), destination(`packages/cli/${sourcePath}`, 'source-workflow-custody')];
    }
    if (sourcePath.startsWith('.changeset/')) {
      return [destination(sourcePath, 'root-release-metadata'), destination(`packages/cli/${sourcePath}`, 'source-release-custody')];
    }
    if (sourcePath === 'components.json') return [destination('apps/dashboard/components.json', 'canonical')];
    if (sourcePath === 'tsconfig.dashboard.json') return [destination('apps/dashboard/tsconfig.json', 'canonical')];
    if (sourcePath === 'vite.dashboard.config.ts') return [destination('apps/dashboard/vite.config.ts', 'canonical')];
    if (sourcePath.startsWith('src/dashboard/')) {
      return [destination(`apps/dashboard/src/${sourcePath.slice('src/dashboard/'.length)}`, 'canonical')];
    }
    return [destination(`packages/cli/${sourcePath}`, 'public-package')];
  }

  if (evidenceId === 'pipeline') {
    const compatibility = destination(`packages/pipeline/${sourcePath}`, 'public-package-projection');
    if (sourcePath.startsWith('.github/')) return [destination(sourcePath, 'root-workflow'), compatibility];
    if (/^(evaluation|templates|conformance)\//.test(sourcePath)) {
      return [destination(sourcePath, 'root-workspace-domain'), compatibility];
    }
    if (sourcePath.startsWith('schemas/')) {
      return [destination(`packages/protocol/${sourcePath}`, 'canonical'), compatibility];
    }
    if (sourcePath.startsWith('registry/')) {
      return [destination(`packages/protocol/${sourcePath}`, 'canonical'), compatibility];
    }
    if (sourcePath.startsWith('lib/operate/')) {
      return [destination(`packages/operate/${sourcePath}`, 'canonical'), compatibility];
    }
    if (sourcePath.startsWith('lib/artifact/')) {
      return [destination(`packages/artifact/${sourcePath}`, 'canonical'), compatibility];
    }
    if (sourcePath.startsWith('lib/design/') || sourcePath.startsWith('lib/design-engine/')) {
      return [destination(`packages/design/${sourcePath}`, 'canonical'), compatibility];
    }
    if (sourcePath.startsWith('skills/')) {
      return [destination(sourcePath, 'canonical'), compatibility];
    }
    if (sourcePath.startsWith('commands/')) {
      return [destination(`adapters/claude-code/${sourcePath}`, 'generated-host-alias'), compatibility];
    }
    if (sourcePath.startsWith('adapters/')) {
      return [destination(sourcePath, 'generated-host-asset'), compatibility];
    }
    if (sourcePath.startsWith('agents/modes/')) {
      return [destination(`agents/shared/${sourcePath.slice('agents/'.length)}`, 'canonical-shared-role-source'), compatibility];
    }
    if (/^agents\/[a-z-]+-agent\.md$/.test(sourcePath)) {
      return [destination(`adapters/claude-code/${sourcePath}`, 'generated-role-alias'), compatibility];
    }
    return [compatibility];
  }

  if (evidenceId === 'skills') {
    if (sourcePath.startsWith('.github/')) {
      return [destination(sourcePath, 'root-workflow'), { path: 'packages/skill-runtime', custody: 'canonical-runtime', kind: 'directory' }];
    }
    if (sourcePath.startsWith('skills/')) return [destination(sourcePath, 'canonical')];
    return [destination('packages/skill-runtime', 'canonical-runtime')];
  }

  if (evidenceId === 'marketplace') {
    if (sourcePath.startsWith('.github/')) {
      return [destination(sourcePath, 'root-workflow'), { path: 'adapters/manifests', custody: 'generated-marketplace-metadata', kind: 'directory' }];
    }
    if (sourcePath === 'ecosystem.json' || sourcePath.startsWith('.claude-plugin/')) {
      return [destination('adapters/manifests', 'generated-marketplace-metadata')];
    }
    return [destination('packages/skill-runtime', 'canonical-runtime')];
  }

  throw new Error(`No mapping policy for ${evidenceId}:${sourcePath}`);
}

function generatedSourcePath(evidenceId, sourcePath) {
  if (evidenceId === 'pipeline') {
    if (sourcePath.startsWith('lib/protocol/')) return 'protocol-compatibility-projection';
    if (/^lib\/(operate|artifact|design|design-engine)\//.test(sourcePath)) return 'private-domain-compatibility-projection';
    if (sourcePath.startsWith('commands/')) return 'frozen-command-generated-alias';
    if (sourcePath.startsWith('adapters/')) return 'host-adapter-regeneration';
    if (/^agents\/[a-z-]+-agent\.md$/.test(sourcePath)) return 'role-adapter-regeneration';
  }
  if (evidenceId === 'marketplace' && (sourcePath === 'ecosystem.json' || sourcePath.startsWith('.claude-plugin/'))) {
    return 'marketplace-metadata-regeneration';
  }
  return null;
}

function mergedSourcePath(evidenceId, sourcePath) {
  if (evidenceId === 'openplanr') {
    if (ROOT_WORKFLOW_CONTRACT_PATHS.has(sourcePath)) {
      return 'root-workflow-contract-reconciliation';
    }
    if (sourcePath.startsWith('src/dashboard/') || ['components.json', 'tsconfig.dashboard.json', 'vite.dashboard.config.ts'].includes(sourcePath)) return 'dashboard-browser-app-extraction';
    if (sourcePath === 'package.json' || sourcePath.startsWith('.github/') || sourcePath.startsWith('.changeset/')) return 'root-workspace-integration';
  }
  if (evidenceId === 'pipeline') {
    if (sourcePath.startsWith('skills/')) return 'canonical-skill-source-reconciliation';
    if (sourcePath.startsWith('agents/modes/')) return 'phase-based-agent-source-reconciliation';
    if (sourcePath === 'package.json' || sourcePath.startsWith('.github/')) return 'root-workspace-integration';
  }
  if (evidenceId === 'skills') return 'canonical-skill-source-reconciliation';
  if (evidenceId === 'marketplace') return 'marketplace-workflow-reconciliation';
  return null;
}

function fallbackDestination(evidenceId, sourcePath) {
  if (evidenceId === 'openplanr') return { path: 'packages/cli', custody: 'public-package', kind: 'directory' };
  if (evidenceId === 'pipeline') return { path: 'packages/pipeline', custody: 'public-package', kind: 'directory' };
  if (evidenceId === 'skills') return { path: 'packages/skill-runtime', custody: 'canonical-runtime', kind: 'directory' };
  if (evidenceId === 'marketplace') return { path: 'adapters/manifests', custody: 'generated-marketplace-metadata', kind: 'directory' };
  throw new Error(`No fallback destination for ${evidenceId}:${sourcePath}`);
}

async function buildSurfaceCatalog(value, inventory, committedSurface = null) {
  const pipelineEvidence = value?.sources.find((source) => source.id === 'pipeline') ?? null;
  const cliEvidence = value?.sources.find((source) => source.id === 'openplanr') ?? null;
  const commandsRegistry = await readJson('packages/protocol/registries/commands.json');
  const skillsRegistry = await readJson('packages/protocol/registries/skills.json');
  const rolesRegistry = await readJson('packages/protocol/registries/roles.json');
  const rulesRegistry = await readJson('packages/protocol/registries/rules.json');
  const outputsRegistry = await readJson('packages/protocol/registries/outputs.json');

  const includedBySourcePath = new Map(
    inventory.pathMappings.map((mapping) => [`${mapping.sourceId}:${mapping.sourcePath}`, mapping]),
  );
  const schemaFloor = pipelineEvidence
    ? pipelineEvidence.surfaces.schemas
    : committedSurface.schemas.original.map((schema) => `${schema.version ? `v${schema.version}` : schema.sourcePath.split('/')[1]}/${path.basename(schema.destinationPath)}`);
  const originalSchemas = await Promise.all(
    schemaFloor.map(async (schemaPath) => {
      const destinationPath = `packages/protocol/schemas/${schemaPath}`;
      const source = includedBySourcePath.get(`planr-pipeline:schemas/${schemaPath}`);
      return {
        schemaId: schemaPath.replace(/^v[^/]+\//, '').replace(/\.schema\.json$/, ''),
        version: schemaPath.split('/')[0].slice(1),
        sourcePath: `schemas/${schemaPath}`,
        sourceSha256: source.included.sha256,
        destinationPath,
        destinationSha256: await fileSha256(destinationPath),
      };
    }),
  );
  const additiveV15Schemas = await catalogJsonFiles('packages/protocol/schemas/v1.5.0', 'schema');
  const additiveV16Schemas = await catalogJsonFiles('packages/protocol/schemas/v1.6.0', 'schema');
  const additiveV17Schemas = await catalogJsonFiles('packages/protocol/schemas/v1.7.0', 'schema');
  const additiveSchemas = [...additiveV15Schemas, ...additiveV16Schemas, ...additiveV17Schemas];
  const legacyRegistryFloor = pipelineEvidence
    ? pipelineEvidence.surfaces.registries
    : committedSurface.registries.legacy.map((registry) => path.basename(registry.destinationPath));
  const legacyRegistries = await Promise.all(
    legacyRegistryFloor.map(async (registryFile) => ({
      registryId: registryFile.replace(/\.json$/, ''),
      sourcePath: `registry/${registryFile}`,
      destinationPath: `packages/protocol/registry/${registryFile}`,
      destinationSha256: await fileSha256(`packages/protocol/registry/${registryFile}`),
    })),
  );
  const canonicalRegistries = await catalogJsonFiles('packages/protocol/registries', 'registry');
  const v16RegistryIds = new Set(Object.keys(DIAGRAM_V16_REGISTRIES).map((file) => file.replace(/\.json$/u, '')));
  const v17RegistryIds = new Set(Object.keys(PROTOCOL_V17_REGISTRIES).map((file) => file.replace(/\.json$/u, '')));
  const canonicalByVersion = {
    '1.5.0': canonicalRegistries.filter((entry) => !v16RegistryIds.has(entry.registryId) && !v17RegistryIds.has(entry.registryId)).length,
    '1.6.0': canonicalRegistries.filter((entry) => v16RegistryIds.has(entry.registryId)).length,
    '1.7.0': canonicalRegistries.filter((entry) => v17RegistryIds.has(entry.registryId)).length,
  };

  const commandRecords = commandsRegistry.commands;
  const roots = commandRecords.filter((command) => command.surface === 'cli-root');
  const machine = commandRecords.filter((command) => command.surface === 'pipeline-machine');
  const frozen = commandRecords.filter((command) => command.surface === 'frozen-host-alias');
  const rootCommands = cliEvidence
    ? cliEvidence.surfaces.topLevelCommandImplementationFiles.map((file) => {
        const slug = file.replace(/\.ts$/, '');
        const registered = roots.find((command) => command.argv.join(' ') === slug);
        return {
          commandId: registered?.commandId ?? `cli-${slug}`,
          slug,
          sourcePath: `src/cli/commands/${file}`,
          destinationPath: registered?.source?.path ?? `packages/cli/src/cli/commands/${file}`,
          registration: cliEvidence.surfaces.unregisteredImplementationFiles.includes(file)
            ? 'implementation-only'
            : 'registered',
          lifecycle: registered?.lifecycle ?? 'compatibility-implementation',
          featureId: inferFeatureId('cli-root', [slug]),
        };
      })
    : roots.map((command) => ({
        commandId: command.commandId,
        slug: command.argv[0],
        sourcePath: command.source.path.replace(/^packages\/cli\//u, ''),
        destinationPath: command.source.path,
        registration: 'registered',
        lifecycle: command.lifecycle,
        featureId: inferFeatureId(command.surface, command.argv),
      }));

  const generators = await catalogGenerators();
  const generatedAssets = await catalogGeneratedAssets(generators);

  return sealDocument({
    kind: 'openplanr-preservation-surface-catalog',
    schemaVersion: '1.0.0',
    protocolVersion: '1.5.0',
    migrationId: 'openplanr-monorepo',
    features: FEATURES,
    commands: {
      root: rootCommands,
      pipelineMachine: machine.map((command) => ({
        commandId: command.commandId,
        argv: command.argv,
        lifecycle: command.lifecycle,
        ownerPackage: command.ownerPackage,
        featureId: inferFeatureId(command.surface, command.argv),
      })),
      frozenAliases: frozen.map((command) => ({
        commandId: command.commandId,
        argv: command.argv,
        lifecycle: command.lifecycle,
        generatedPaths: command.generatedPaths ?? [],
        featureId: inferFeatureId(command.surface, command.argv),
      })),
      negativeContracts: commandsRegistry.negativeContracts,
    },
    skills: {
      canonical: skillsRegistry.skills.map((skill) => ({
        skillId: skill.skillId,
        skillVersion: skill.skillVersion,
        lifecycle: skill.lifecycle,
        source: skill.source,
        sourceDigest: skill.sourceDigest,
        ruleIds: skill.ruleIds,
      })),
      compatibilityAliases: skillsRegistry.compatibilityAliases,
    },
    roles: rolesRegistry.roles.map((role) => ({
      roleId: role.roleId,
      roleVersion: role.roleVersion,
      legacyAliases: role.legacyAliases.map((alias) => alias.id),
      phase: role.phase,
      activation: role.activation,
      capabilityTier: role.capabilityTier,
      writeBoundary: role.writeBoundary,
      source: role.source,
      taskKinds: role.taskKinds,
    })),
    rules: rulesRegistry.rules.map((rule) => ({
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      title: rule.title,
      status: rule.status,
      normativeText: rule.normativeText,
      enforcementPoints: rule.enforcementPoints,
      testRefs: rule.testRefs,
    })),
    schemas: {
      originalByVersion: pipelineEvidence?.surfaces.schemasByVersion ?? committedSurface.schemas.originalByVersion,
      original: originalSchemas,
      additiveVersions: ['1.5.0', '1.6.0', '1.7.0'],
      additiveByVersion: { '1.5.0': additiveV15Schemas.length, '1.6.0': additiveV16Schemas.length, '1.7.0': additiveV17Schemas.length },
      additive: additiveSchemas,
    },
    registries: {
      legacy: legacyRegistries,
      canonical: canonicalRegistries,
      canonicalByVersion,
    },
    packageSurface: {
      package: 'planr-pipeline',
      baselineVersion: '0.44.0',
      baselineExportKeys: pipelineEvidence?.surfaces.packageExportKeys ?? committedSurface.packageSurface.baselineExportKeys,
      baselineRootSymbols: pipelineEvidence?.surfaces.rootRuntimeSymbols ?? committedSurface.packageSurface.baselineRootSymbols,
    },
    generators,
    generatedAssets,
    outputs: outputsRegistry.outputs,
  });
}

async function catalogJsonFiles(directory, idKind) {
  const files = (await readdir(path.join(REPOSITORY_ROOT, directory)))
    .filter((file) => file.endsWith('.json'))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      [`${idKind}Id`]: file.replace(/\.schema\.json$/, '').replace(/\.json$/, ''),
      destinationPath: `${directory}/${file}`,
      destinationSha256: await fileSha256(`${directory}/${file}`),
    })),
  );
}

async function catalogGenerators() {
  const roots = ['scripts', 'packages'];
  const candidates = [];
  for (const root of roots) {
    if ((await pathKind(root)) === 'missing') continue;
    for (const relativePath of await walkFiles(root)) {
      if (relativePath.includes('/node_modules/') || relativePath.includes('/dist/') || relativePath.startsWith('imports/')) continue;
      const name = path.basename(relativePath);
      const underScripts = relativePath.startsWith('scripts/') || relativePath.includes('/scripts/');
      if (!underScripts || !/\.(?:mjs|js|ts)$/.test(name)) continue;
      if (!/(?:^|[-.])(generate|project|build|copy)(?:[-.]|$)/.test(name) && name !== 'generate.mjs') continue;
      candidates.push(relativePath);
    }
  }
  return Promise.all(
    sortedUnique(candidates).map(async (sourcePath) => ({
      generatorId: sourcePath
        .replace(/\.(?:mjs|js|ts)$/, '')
        .replaceAll('/', '-')
        .replace(/[^a-zA-Z0-9-]/g, '-'),
      sourcePath,
      sourceSha256: await fileSha256(sourcePath),
    })),
  );
}

async function catalogGeneratedAssets(generators) {
  const assets = new Map();
  const generatorByPath = new Map(generators.map((generator) => [generator.sourcePath, generator.generatorId]));
  const add = async (assetPath, generatorPath, declaredDigest = null, custody = 'generated') => {
    if ((await pathKind(assetPath)) !== 'file') return;
    const actualDigest = await fileSha256(assetPath);
    if (declaredDigest) assert(declaredDigest.replace(/^sha256:/, '') === actualDigest, `Generated asset manifest drift: ${assetPath}`);
    assets.set(assetPath, {
      path: assetPath,
      generatorId: generatorByPath.get(generatorPath) ?? generatorPath,
      custody,
      sha256: actualDigest,
    });
  };

  if ((await pathKind('adapters/manifests/generated-assets.json')) === 'file') {
    const manifest = await readJson('adapters/manifests/generated-assets.json');
    for (const asset of manifest.assets) await add(asset.path, manifest.generator, asset.digest, asset.custody);
    await add('adapters/manifests/generated-assets.json', manifest.generator, null, 'manifest');
  }

  if ((await pathKind('adapters/manifests/ecosystem-assets.json')) === 'file') {
    const manifest = await readJson('adapters/manifests/ecosystem-assets.json');
    for (const asset of manifest.outputs) await add(asset.path, manifest.generator, asset.digest, 'ecosystem-generated');
    await add('adapters/manifests/ecosystem-assets.json', manifest.generator, null, 'manifest');
  }

  const guidedManifestPath = 'packages/pipeline/conformance/fixtures/guided-runtime-parity/generated-assets.json';
  if ((await pathKind(guidedManifestPath)) === 'file') {
    const manifest = await readJson(guidedManifestPath);
    for (const asset of manifest.assets) {
      await add(`packages/pipeline/${asset.path}`, 'packages/pipeline/scripts/generate-guided-adapters.mjs', asset.digest, 'guided-adapter');
    }
    await add(guidedManifestPath, 'packages/pipeline/scripts/generate-guided-adapters.mjs', null, 'manifest');
  }

  const operateAdapterManifestPath = 'packages/pipeline/conformance/fixtures/operate-adapter-parity/generated-assets.json';
  if ((await pathKind(operateAdapterManifestPath)) === 'file') {
    const manifest = await readJson(operateAdapterManifestPath);
    const adapterAssets = manifest.adapters.flatMap((adapter) => adapter.assets ?? []);
    const skillAssets = manifest.skillDistribution?.assets ?? [];
    for (const asset of [...adapterAssets, ...skillAssets]) {
      await add(`packages/pipeline/${asset.path}`, 'packages/pipeline/scripts/generate-guided-adapters.mjs', asset.digest, 'guided-operate-adapter');
    }
    await add(operateAdapterManifestPath, 'packages/pipeline/scripts/generate-guided-adapters.mjs', null, 'manifest');
  }

  const projectionManifests = [
    'packages/pipeline/lib/generated/protocol-projection.json',
    'packages/pipeline/lib/generated/domain-projections/artifact.json',
    'packages/pipeline/lib/generated/domain-projections/design.json',
    'packages/pipeline/lib/generated/domain-projections/operate.json',
  ];
  for (const manifestPath of projectionManifests) {
    if ((await pathKind(manifestPath)) !== 'file') continue;
    const manifest = await readJson(manifestPath);
    for (const entry of manifest.entries) {
      await add(`packages/pipeline/${entry.target}`, manifest.generator, entry.sha256, 'public-package-projection');
    }
    await add(manifestPath, manifest.generator, null, 'manifest');
  }

  const protocolGeneratedRoots = [
    'packages/protocol/src/generated',
    'packages/protocol/projections/pipeline',
    'packages/protocol/schemas/v1.5.0',
    'packages/protocol/schemas/v1.6.0',
    'packages/protocol/schemas/v1.7.0',
    'packages/protocol/registries',
  ];
  for (const generatedRoot of protocolGeneratedRoots) {
    if ((await pathKind(generatedRoot)) === 'missing') continue;
    for (const assetPath of await walkFiles(generatedRoot)) {
      await add(assetPath, 'packages/protocol/scripts/generate-protocol-assets.mjs', null, 'protocol-generated');
    }
  }

  for (const assetPath of await walkFiles('packages/pipeline/lib/dashboard/generated')) {
    await add(assetPath, 'packages/pipeline/scripts/generate-dashboard-surface-schema-data.mjs', null, 'dashboard-contract-data');
  }

  await add(
    'packages/artifact/lib/artifact/ui/generated/artifact-shell-assets.json',
    'packages/artifact/scripts/generate-artifact-shell.mjs',
    null,
    'embedded-bundle',
  );

  return [...assets.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function walkFiles(relativeDirectory) {
  const results = [];
  const absoluteDirectory = path.join(REPOSITORY_ROOT, relativeDirectory);
  for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
    const child = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) results.push(...(await walkFiles(child)));
    else if (entry.isFile()) results.push(child);
  }
  return results;
}

async function readAndVerifyCommittedDocument(relativePath, expectedKind) {
  const document = await readJson(relativePath);
  assert(document.kind === expectedKind, `${relativePath} has an unexpected kind.`);
  assert(document.documentDigest === documentDigest(document), `${relativePath} has an invalid document digest.`);
  return document;
}

function renderDocumentation(inventory, surface, baseline) {
  const dispositions = inventory.coverage.dispositionCounts;
  const sourceRows = inventory.sources
    .map(
      (source) =>
        `| \`${source.sourceId}\` | \`${source.cutoffCommit}\` | ${source.cutoffTrackedPaths} | ${source.includedPaths} | ${source.includedState} |`,
    )
    .join('\n');
  const dispositionRows = inventory.allowedDispositions
    .map((name) => `| \`${name}\` | ${dispositions[name] ?? 0} | ${dispositionMeaning(name)} |`)
    .join('\n');
  const classCounts = Object.fromEntries(
    ['A', 'B', 'C', 'D'].map((outputClass) => [
      outputClass,
      surface.outputs.filter((output) => output.outputClass === outputClass).length,
    ]),
  );

  return `<!-- Generated by scripts/migration/generate-preservation-catalog.mjs; edit the generator or canonical registries. -->
# Monorepo compatibility preservation catalog

This catalog is the redacted, repository-local custody contract for the OpenPlanr 0.1 integration. It proves that every pinned cutoff path and every included OpenPlanr overlay path has an explicit disposition, while keeping absolute source locations, remotes, authors, and the raw custody capture out of Git.

The raw evidence is required only when the source path inventory must be created or reclassified. Normal generation and verification use the committed redacted floor, so a clean clone has no sibling-repository, private report, or custody-directory dependency.

## Committed contract files

- \`${INVENTORY_PATH}\` — ${baseline.coverage.pathRecords.toLocaleString('en-US')} source path mappings and redacted source fingerprints.
- \`${SURFACE_PATH}\` — feature, command, skill, role, rule, schema, registry, export, symbol, generator, generated-asset, and output custody.
- \`${BASELINE_PATH}\` — sealed expected counts and catalog digests.
- \`${DOCUMENTATION_PATH}\` — this generated view.

All JSON documents are sealed with SHA-256 over deterministic key-sorted JSON. The clean-clone verifier recomputes those seals before inspecting the filesystem.

## Source coverage

| Source | Cutoff | Cutoff paths | Included paths | Included state |
|---|---:|---:|---:|---|
${sourceRows}

The five cutoffs contain **${baseline.coverage.cutoffTrackedPaths.toLocaleString('en-US')} tracked paths**. OpenPlanr contributes **${baseline.coverage.includedOpenPlanrOverlayPaths} included overlay paths** (505 tracked-present plus 113 included untracked files). The catalog has **${baseline.coverage.pathRecords.toLocaleString('en-US')} unique records** and **zero unmapped paths**.

## Dispositions and verification

| Disposition | Paths | Verification contract |
|---|---:|---|
${dispositionRows}

\`exact\` and \`moved\` records are byte-bound: at least one declared destination must retain the captured SHA-256 and executable bit. \`merged\` and \`regenerated\` records require a declared destination but intentionally tolerate changed bytes. \`retired\` and \`excluded\` are explicit absence decisions. The 137 web paths are external references and never imply that the web repository, Vercel project, or Cloudflare deployment moved into this workspace.

Nested source workflows and package metadata are classified as merged into root workspace custody. Protocol, Operate, artifact, and design compatibility files are regenerated into the public pipeline package without symlinks. Dashboard browser files map to \`apps/dashboard\`; CLI/server readers remain in their public package custody.

## Compatibility floor

| Surface | Preserved count |
|---|---:|
| Product feature families | ${baseline.coverage.features} |
| OpenPlanr root command modules | ${baseline.coverage.rootCommands} |
| Pipeline machine leaves | ${baseline.coverage.pipelineMachineLeaves} |
| Frozen Claude aliases | ${baseline.coverage.frozenAliases} |
| Canonical \`planr-*\` skills | ${baseline.coverage.canonicalSkills} |
| Canonical roles (plus one legacy alias each) | ${baseline.coverage.roles} |
| Rules | ${baseline.coverage.rules} (R1-R10) |
| Original Protocol schemas | ${baseline.coverage.originalSchemas} (12/34/25/5/15/89) |
| Additive Protocol 1.5/1.6 schemas | ${baseline.coverage.additiveSchemas} |
| Legacy / canonical registries | ${baseline.coverage.legacyRegistries} / ${baseline.coverage.canonicalRegistries} |
| Baseline pipeline exports / root symbols | ${baseline.coverage.baselinePackageExports} / ${baseline.coverage.baselineRootSymbols} |
| Active generators / generated assets | ${baseline.coverage.generators} / ${baseline.coverage.generatedAssets} |
| Output contracts | ${baseline.coverage.outputContracts} |

The command catalog also carries the negative contract that retired pipeline-owned Operate grammar and plugin assets remain absent while \`planr operate\` stays CLI-owned.

## Output convention

The Protocol output registry covers all four custody classes:

- **Class A (${classCounts.A})** — human-reviewable planning and canonical Markdown sources.
- **Class B (${classCounts.B})** — closed, versioned machine JSON contracts and receipts.
- **Class C (${classCounts.C})** — source/configuration results bound by task output manifests.
- **Class D (${classCounts.D})** — visual, binary, packed, and generated bundles with byte custody.

Each output record names its owner, path function/template, schema or manifest, generator, validator, compatibility reader, retention rule, cleanup rule, and media types.

## Commands

From custody evidence (only when creating or reclassifying mappings):

\`\`\`sh
node scripts/migration/generate-preservation-catalog.mjs --write --evidence "$CUSTODY_EVIDENCE"
node scripts/migration/generate-preservation-catalog.mjs --check --evidence "$CUSTODY_EVIDENCE"
\`\`\`

From a clean clone (the normal workspace path):

\`\`\`sh
node scripts/migration/generate-preservation-catalog.mjs --write
node scripts/migration/generate-preservation-catalog.mjs --check
node scripts/migration/verify-preservation-catalog.mjs
node --test conformance/migration/preservation-catalog.test.mjs
\`\`\`

\`--check\` is mutation-free. Clean-clone \`--write\` refreshes derived surfaces, generator/asset custody, the sealed baseline, and this documentation while retaining the committed source path floor. Reclassifying a source path still requires the original custody evidence.

Private decision-record exclusion is an explicit reviewed classification. Its first application requires \`--private-decision-custody <restored-snapshot>\` and compares each original source hash before recording the public exclusion. Subsequent clean-clone checks use the sealed redacted inventory. This Markdown report is private and is produced only in write mode.

Current seals: path inventory \`${inventory.documentDigest}\`; surface catalog \`${surface.documentDigest}\`; baseline \`${baseline.documentDigest}\`.
`;
}

function dispositionMeaning(name) {
  return {
    exact: 'Destination retains captured bytes at the same logical custody.',
    moved: 'Destination retains captured bytes at a new package/workspace path.',
    merged: 'Content is reconciled into an existing canonical source or root contract.',
    regenerated: 'Canonical source owns behavior; compatibility bytes are generated.',
    retired: 'Removal is intentional and verified as an absence contract.',
    external: 'Source remains in the separately deployed web repository.',
    excluded: 'Private decision records remain in verified custody and are excluded from public source.',
  }[name];
}

async function emitOrCheck(relativePath, document) {
  const absolutePath = path.join(REPOSITORY_ROOT, relativePath);
  const expected = prettyJson(document);
  if (mode === 'write') {
    await writeFile(absolutePath, expected, { mode: 0o644 });
    return;
  }
  const current = await readFile(absolutePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  assert(current === expected, `${relativePath} is stale; rerun with --write.`);
  assert(document.documentDigest === documentDigest(document), `${relativePath} digest is invalid.`);
}

async function writePrivateReport(relativePath, expected) {
  const absolutePath = path.join(REPOSITORY_ROOT, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, expected, { mode: 0o600 });
}
