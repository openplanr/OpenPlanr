#!/usr/bin/env node

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DIAGRAM_V16_REGISTRIES,
  PROTOCOL_V16_CONTRACT_FILES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V17_REGISTRIES,
} from '../../packages/protocol/src/skill-source-contracts.mjs';
import {
  ALLOWED_DISPOSITIONS,
  BASELINE_PATH,
  EXPECTED_SOURCES,
  INVENTORY_PATH,
  REPOSITORY_ROOT,
  SURFACE_PATH,
  assert,
  documentDigest,
  fileSha256,
  normalizeRelativePath,
  pathKind,
  readJson,
  sortedUnique,
} from './preservation-lib.mjs';

export async function verifyPreservationCatalog() {
  const [inventoryText, surfaceText, baselineText] = await Promise.all(
    [INVENTORY_PATH, SURFACE_PATH, BASELINE_PATH].map((relativePath) =>
      readFile(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
    ),
  );
  const inventory = JSON.parse(inventoryText);
  const surface = JSON.parse(surfaceText);
  const baseline = JSON.parse(baselineText);

  verifyRedaction(inventoryText + surfaceText + baselineText);
  verifyDocument(inventory, 'openplanr-preservation-path-inventory');
  verifyDocument(surface, 'openplanr-preservation-surface-catalog');
  verifyDocument(baseline, 'openplanr-preservation-verification-baseline');
  assert(baseline.inventoryDigest === inventory.documentDigest, 'Baseline inventory digest is stale.');
  assert(baseline.surfaceCatalogDigest === surface.documentDigest, 'Baseline surface digest is stale.');

  const pathResults = await verifyPaths(inventory);
  const surfaceResults = await verifySurfaces(surface);
  const coverage = {
    cutoffTrackedPaths: pathResults.cutoffTrackedPaths,
    includedOpenPlanrOverlayPaths: pathResults.includedOpenPlanrOverlayPaths,
    pathRecords: pathResults.pathRecords,
    unmappedPaths: 0,
    ...surfaceResults,
  };
  assert(
    JSON.stringify(coverage) === JSON.stringify(baseline.coverage),
    `Verification coverage differs from baseline.\nexpected=${JSON.stringify(baseline.coverage)}\nactual=${JSON.stringify(coverage)}`,
  );

  return {
    status: 'PASS',
    verifier: 'clean-clone',
    custodyEvidenceRequired: false,
    catalogDigests: {
      pathInventory: inventory.documentDigest,
      surfaceCatalog: surface.documentDigest,
      verificationBaseline: baseline.documentDigest,
    },
    dispositionCounts: inventory.coverage.dispositionCounts,
    coverage,
    checks: {
      redaction: 'PASS',
      sourceCutoffs: 'PASS',
      zeroUnmappedPaths: 'PASS',
      byteBoundDestinations: pathResults.byteBoundDestinations,
      declaredDestinationExistence: pathResults.existenceDestinations,
      externalAndAbsenceDeclarations: pathResults.nonLocalDeclarations,
      protocolAndSurfaceCounts: 'PASS',
      packageExports: 'PASS',
      packageRootSymbols: 'PASS',
      generatorCustody: 'PASS',
      generatedAssetCustody: 'PASS',
      outputClasses: 'PASS',
    },
  };
}

function verifyDocument(document, expectedKind) {
  assert(document.kind === expectedKind, `Unexpected document kind: ${document.kind}`);
  assert(document.schemaVersion === '1.0.0', `${expectedKind} has an unsupported schema version.`);
  assert(document.documentDigest === documentDigest(document), `${expectedKind} document digest mismatch.`);
}

function verifyRedaction(serialized) {
  const forbidden = [
    /\/Users\//,
    /\/private\/tmp\//,
    /file:\/\//,
    /"repo"\s*:/,
    /"remotes"\s*:/,
    /"authors"\s*:/,
    /source-evidence\.json/,
  ];
  for (const pattern of forbidden) assert(!pattern.test(serialized), `Committed preservation data leaks custody-only data (${pattern}).`);
}

async function verifyPaths(inventory) {
  assert(inventory.migrationId === 'openplanr-monorepo', 'Unexpected migration identity.');
  assert(inventory.integrationVersion === '0.1.0', 'Unexpected integration version.');
  assert(inventory.destinationRepository === 'openplanr/OpenPlanr', 'Unexpected destination repository.');
  assert(inventory.coverage.unmappedPaths === 0, 'Inventory declares unmapped paths.');
  assert(inventory.pathMappings.length === inventory.coverage.pathRecords, 'Path record coverage drift.');

  const mappingIds = new Set();
  const perSourceCutoff = new Map();
  const perSourceIncluded = new Map();
  let byteBoundDestinations = 0;
  let existenceDestinations = 0;
  let nonLocalDeclarations = 0;

  for (const mapping of inventory.pathMappings) {
    assert(!mappingIds.has(mapping.mappingId), `Duplicate mapping: ${mapping.mappingId}`);
    mappingIds.add(mapping.mappingId);
    normalizeRelativePath(mapping.sourcePath);
    assert(ALLOWED_DISPOSITIONS.includes(mapping.disposition), `Unmapped disposition for ${mapping.mappingId}: ${mapping.disposition}`);
    assert(mapping.disposition !== 'unmapped', `Unmapped source path: ${mapping.mappingId}`);
    if (mapping.cutoff.present) perSourceCutoff.set(mapping.sourceId, (perSourceCutoff.get(mapping.sourceId) ?? 0) + 1);
    if (mapping.included.state !== 'deleted-overlay') perSourceIncluded.set(mapping.sourceId, (perSourceIncluded.get(mapping.sourceId) ?? 0) + 1);

    if (mapping.verification.policy === 'byte-bound') {
      assert(['exact', 'moved'].includes(mapping.disposition), `Byte-bound mapping has invalid disposition: ${mapping.mappingId}`);
      const matches = [];
      for (const destination of mapping.destinations) {
        normalizeRelativePath(destination.path);
        if ((await pathKind(destination.path)) !== 'file') continue;
        const digestMatches = (await fileSha256(destination.path)) === mapping.verification.sha256;
        const executableMatches = await executableMatchesExpectation(destination.path, mapping.verification.executable);
        if (digestMatches && executableMatches) matches.push(destination.path);
      }
      assert(matches.length > 0, `No byte-identical destination remains for ${mapping.mappingId}.`);
      byteBoundDestinations += 1;
      continue;
    }

    if (mapping.verification.policy === 'destination-exists') {
      assert(['merged', 'regenerated'].includes(mapping.disposition), `Existence-only mapping has invalid disposition: ${mapping.mappingId}`);
      let found = false;
      for (const destination of mapping.destinations) {
        normalizeRelativePath(destination.path);
        if ((await pathKind(destination.path)) !== 'missing') found = true;
      }
      assert(found, `No declared destination exists for ${mapping.mappingId}.`);
      existenceDestinations += 1;
      continue;
    }

    if (mapping.verification.policy === 'external-reference') {
      assert(mapping.disposition === 'external', `External mapping has invalid disposition: ${mapping.mappingId}`);
      assert(mapping.destinations.every((entry) => entry.path.startsWith('external/openplanr-web/')), `Invalid external reference: ${mapping.mappingId}`);
      nonLocalDeclarations += 1;
      continue;
    }

    if (mapping.verification.policy === 'declared-absence') {
      assert(['retired', 'excluded'].includes(mapping.disposition), `Absence mapping has invalid disposition: ${mapping.mappingId}`);
      assert(mapping.destinations.length === 0, `Absence mapping unexpectedly declares a destination: ${mapping.mappingId}`);
      nonLocalDeclarations += 1;
      continue;
    }

    throw new Error(`Unknown verification policy for ${mapping.mappingId}: ${mapping.verification.policy}`);
  }

  for (const [evidenceId, expected] of Object.entries(EXPECTED_SOURCES)) {
    const source = inventory.sources.find((entry) => entry.sourceId === expected.sourceId);
    assert(source, `Missing redacted source ledger: ${expected.sourceId}`);
    assert(source.cutoffCommit === expected.cutoffCommit, `Cutoff drift: ${expected.sourceId}`);
    assert(source.package.name === expected.packageName, `Package identity drift: ${expected.sourceId}`);
    assert(source.package.version === expected.packageVersion, `Package version drift: ${expected.sourceId}`);
    assert(perSourceCutoff.get(expected.sourceId) === expected.cutoffTrackedPaths, `Cutoff path coverage drift: ${expected.sourceId}`);
    assert(perSourceIncluded.get(expected.sourceId) === expected.includedPaths, `Included path coverage drift: ${expected.sourceId}`);
    if (evidenceId === 'web') assert(source.includedState === 'external-reference', 'Web must remain an external reference.');
  }

  const cutoffTrackedPaths = [...perSourceCutoff.values()].reduce((sum, count) => sum + count, 0);
  assert(cutoffTrackedPaths === 2124, `Expected 2,124 cutoff paths, got ${cutoffTrackedPaths}.`);
  assert(inventory.pathMappings.length === 2237, `Expected 2,237 path records, got ${inventory.pathMappings.length}.`);
  assert(perSourceIncluded.get('openplanr-cli') === 618, 'OpenPlanr included overlay must contain 618 paths.');

  return {
    cutoffTrackedPaths,
    includedOpenPlanrOverlayPaths: perSourceIncluded.get('openplanr-cli'),
    pathRecords: inventory.pathMappings.length,
    byteBoundDestinations,
    existenceDestinations,
    nonLocalDeclarations,
  };
}

async function executableMatchesExpectation(relativePath, expectedExecutable) {
  const metadata = await stat(path.join(REPOSITORY_ROOT, relativePath));
  return Boolean(metadata.mode & 0o111) === expectedExecutable;
}

async function verifySurfaces(surface) {
  const [commands, skills, roles, rules, outputs, pipelinePackage] = await Promise.all([
    readJson('packages/protocol/registries/commands.json'),
    readJson('packages/protocol/registries/skills.json'),
    readJson('packages/protocol/registries/roles.json'),
    readJson('packages/protocol/registries/rules.json'),
    readJson('packages/protocol/registries/outputs.json'),
    readJson('packages/pipeline/package.json'),
  ]);

  assert(surface.features.length > 0, 'Feature catalog is empty.');
  const featureIds = uniqueIds(surface.features, 'featureId');
  for (const feature of surface.features) {
    normalizeRelativePath(feature.destinationPath);
    assert((await pathKind(feature.destinationPath)) !== 'missing', `Feature destination is missing: ${feature.featureId}`);
  }

  assert(surface.commands.root.length >= 38, `The 38-command preservation floor regressed to ${surface.commands.root.length}.`);
  assert(surface.commands.pipelineMachine.length === 31, `Expected 31 pipeline machine leaves, got ${surface.commands.pipelineMachine.length}.`);
  assert(surface.commands.frozenAliases.length === 8, `Expected 8 frozen aliases, got ${surface.commands.frozenAliases.length}.`);
  assert(
    JSON.stringify(surface.commands.root.map((entry) => entry.slug).sort()) ===
      JSON.stringify(commands.inventory.rootCommandSlugs.slice().sort()),
    'Root command inventory drift.',
  );
  assert(
    JSON.stringify(surface.commands.pipelineMachine.map((entry) => entry.argv.slice(1)).sort(compareArgv)) ===
      JSON.stringify(commands.inventory.pipelineMachineGrammar.slice().sort(compareArgv)),
    'Pipeline machine grammar drift.',
  );
  assert(
    JSON.stringify(
      surface.commands.frozenAliases
        .map((entry) => entry.argv.at(-1).replace(/^\/planr-pipeline:/, ''))
        .sort(),
    ) ===
      JSON.stringify(commands.inventory.frozenClaudeSlugs.slice().sort()),
    'Frozen alias inventory drift.',
  );
  for (const command of [...surface.commands.root, ...surface.commands.pipelineMachine, ...surface.commands.frozenAliases]) {
    assert(featureIds.has(command.featureId), `Command ${command.commandId} references an unknown feature.`);
  }
  for (const command of surface.commands.root) {
    assert((await pathKind(command.destinationPath)) === 'file', `Root command implementation missing: ${command.destinationPath}`);
  }
  assert(surface.commands.negativeContracts.some((entry) => entry.negativeContractId === 'retired-pipeline-operate'), 'Retired pipeline Operate negative contract is missing.');

  assert(surface.skills.canonical.length >= 23, `The 23-skill preservation floor regressed to ${surface.skills.canonical.length}.`);
  assert(
    JSON.stringify(surface.skills.canonical.map((entry) => entry.skillId).sort()) ===
      JSON.stringify(skills.skills.map((entry) => entry.skillId).sort()),
    'Canonical skill catalog drift.',
  );
  assert(JSON.stringify(surface.skills.compatibilityAliases) === JSON.stringify(skills.compatibilityAliases), 'Skill alias catalog drift.');
  for (const skill of surface.skills.canonical) {
    assert((await pathKind(skill.source)) === 'file', `Canonical skill source missing: ${skill.source}`);
    assert(`sha256:${await fileSha256(skill.source)}` === skill.sourceDigest, `Canonical skill digest drift: ${skill.skillId}`);
  }

  assert(surface.roles.length === 9, `Expected 9 roles, got ${surface.roles.length}.`);
  assert(JSON.stringify(surface.roles.map((entry) => entry.roleId).sort()) === JSON.stringify(roles.roles.map((entry) => entry.roleId).sort()), 'Role catalog drift.');
  const roleAliases = surface.roles.flatMap((entry) => entry.legacyAliases);
  assert(roleAliases.length === 9 && new Set(roleAliases).size === 9, 'Each role must retain one unique legacy alias.');
  for (const role of surface.roles) {
    assert((await pathKind(role.source.path)) === 'file', `Canonical role source missing: ${role.source.path}`);
    assert(`sha256:${await fileSha256(role.source.path)}` === role.source.digest, `Canonical role digest drift: ${role.roleId}`);
  }

  assert(surface.rules.length === 10, `Expected R1-R10, got ${surface.rules.length} rules.`);
  const expectedRules = Array.from({ length: 10 }, (_, index) => `R${index + 1}`).sort();
  assert(JSON.stringify(surface.rules.map((entry) => entry.ruleId).sort()) === JSON.stringify(expectedRules), 'Rule IDs are not exactly R1-R10.');
  assert(JSON.stringify(surface.rules.map((entry) => entry.ruleId).sort()) === JSON.stringify(rules.rules.map((entry) => entry.ruleId).sort()), 'Rule registry drift.');

  assert(surface.schemas.original.length === 180, `Expected 180 original schemas, got ${surface.schemas.original.length}.`);
  assert(JSON.stringify(surface.schemas.originalByVersion) === JSON.stringify({ 'v1.0.0': 12, 'v1.1.0': 34, 'v1.2.0': 25, 'v1.3.0': 5, 'v1.4.0': 15, 'v2.0.0': 89 }), 'Original schema version distribution drift.');
  const protocol16SchemaCount = Object.keys(PROTOCOL_V16_CONTRACT_FILES).length + 1;
  const protocol17SchemaCount = Object.keys(PROTOCOL_V17_CONTRACT_FILES).length + 1;
  const additiveSchemaCount = 13 + protocol16SchemaCount + protocol17SchemaCount;
  assert(surface.schemas.additive.length === additiveSchemaCount, `Expected ${additiveSchemaCount} additive Protocol 1.5/1.6/1.7 schemas, got ${surface.schemas.additive.length}.`);
  assert(
    JSON.stringify(surface.schemas.additiveByVersion) === JSON.stringify({ '1.5.0': 13, '1.6.0': protocol16SchemaCount, '1.7.0': protocol17SchemaCount }),
    'Additive schema version distribution drift.',
  );
  const additiveV16 = surface.schemas.additive.filter((schema) => schema.destinationPath.includes('/schemas/v1.6.0/'));
  assert(additiveV16.length === protocol16SchemaCount, `Expected ${protocol16SchemaCount} additive Protocol 1.6 schemas, got ${additiveV16.length}.`);
  const additiveV17 = surface.schemas.additive.filter((schema) => schema.destinationPath.includes('/schemas/v1.7.0/'));
  assert(additiveV17.length === protocol17SchemaCount, `Expected ${protocol17SchemaCount} additive Protocol 1.7 schemas, got ${additiveV17.length}.`);
  for (const schema of [...surface.schemas.original, ...surface.schemas.additive]) {
    assert((await pathKind(schema.destinationPath)) === 'file', `Schema missing: ${schema.destinationPath}`);
    assert((await fileSha256(schema.destinationPath)) === schema.destinationSha256, `Schema digest drift: ${schema.destinationPath}`);
  }
  for (const schema of surface.schemas.original) assert(schema.sourceSha256 === schema.destinationSha256, `Original schema is not byte-preserved: ${schema.sourcePath}`);

  assert(surface.registries.legacy.length === 12, `Expected 12 legacy registries, got ${surface.registries.legacy.length}.`);
  const protocol16RegistryCount = Object.keys(DIAGRAM_V16_REGISTRIES).length;
  const protocol17RegistryCount = Object.keys(PROTOCOL_V17_REGISTRIES).length;
  assert(surface.registries.canonical.length === 7 + protocol16RegistryCount + protocol17RegistryCount, `Expected ${7 + protocol16RegistryCount + protocol17RegistryCount} canonical registries, got ${surface.registries.canonical.length}.`);
  assert(
    JSON.stringify(surface.registries.canonicalByVersion) === JSON.stringify({ '1.5.0': 7, '1.6.0': protocol16RegistryCount, '1.7.0': protocol17RegistryCount }),
    'Canonical registry version distribution drift.',
  );
  for (const registry of [...surface.registries.legacy, ...surface.registries.canonical]) {
    assert((await pathKind(registry.destinationPath)) === 'file', `Registry missing: ${registry.destinationPath}`);
    assert((await fileSha256(registry.destinationPath)) === registry.destinationSha256, `Registry digest drift: ${registry.destinationPath}`);
  }

  assert(surface.packageSurface.baselineExportKeys.length === 37, 'Expected 37 baseline package export keys.');
  for (const exportKey of surface.packageSurface.baselineExportKeys) assert(exportKey in pipelinePackage.exports, `Baseline export missing: ${exportKey}`);
  assert(surface.packageSurface.baselineRootSymbols.length === 229, 'Expected 229 baseline root symbols.');
  const runtimeModule = await import(
    `${pathToFileURL(path.join(REPOSITORY_ROOT, 'packages/pipeline', pipelinePackage.exports['.'].import)).href}?preservation=${Date.now()}`
  );
  for (const symbol of surface.packageSurface.baselineRootSymbols) assert(symbol in runtimeModule, `Baseline root symbol missing: ${symbol}`);

  const currentGeneratorPaths = await discoverGeneratorPaths();
  assert(
    JSON.stringify(surface.generators.map((entry) => entry.sourcePath).sort()) === JSON.stringify(currentGeneratorPaths),
    'Generator catalog drift; regenerate the preservation catalog.',
  );
  for (const generator of surface.generators) {
    assert((await fileSha256(generator.sourcePath)) === generator.sourceSha256, `Generator digest drift: ${generator.sourcePath}`);
  }

  uniqueIds(surface.generatedAssets, 'path');
  for (const asset of surface.generatedAssets) {
    assert((await pathKind(asset.path)) === 'file', `Generated asset missing: ${asset.path}`);
    assert((await fileSha256(asset.path)) === asset.sha256, `Generated asset digest drift: ${asset.path}`);
  }
  await verifyGeneratedManifestCoverage(surface.generatedAssets);

  assert(JSON.stringify(surface.outputs) === JSON.stringify(outputs.outputs), 'Output catalog drift.');
  const outputClasses = sortedUnique(surface.outputs.map((entry) => entry.outputClass));
  assert(JSON.stringify(outputClasses) === JSON.stringify(['A', 'B', 'C', 'D']), 'Output catalog must cover Classes A-D.');

  return {
    features: surface.features.length,
    rootCommands: surface.commands.root.length,
    pipelineMachineLeaves: surface.commands.pipelineMachine.length,
    frozenAliases: surface.commands.frozenAliases.length,
    canonicalSkills: surface.skills.canonical.length,
    roles: surface.roles.length,
    rules: surface.rules.length,
    originalSchemas: surface.schemas.original.length,
    additiveSchemas: surface.schemas.additive.length,
    legacyRegistries: surface.registries.legacy.length,
    canonicalRegistries: surface.registries.canonical.length,
    baselinePackageExports: surface.packageSurface.baselineExportKeys.length,
    baselineRootSymbols: surface.packageSurface.baselineRootSymbols.length,
    generators: surface.generators.length,
    generatedAssets: surface.generatedAssets.length,
    outputContracts: surface.outputs.length,
    outputClasses,
  };
}

function uniqueIds(records, key) {
  const values = records.map((record) => record[key]);
  assert(new Set(values).size === values.length, `Duplicate ${key} in preservation catalog.`);
  return new Set(values);
}

function compareArgv(left, right) {
  return left.join('\0').localeCompare(right.join('\0'));
}

async function discoverGeneratorPaths() {
  const candidates = [];
  for (const root of ['scripts', 'packages']) {
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
  return sortedUnique(candidates);
}

async function verifyGeneratedManifestCoverage(assets) {
  const catalogPaths = new Set(assets.map((asset) => asset.path));
  const adapterManifest = await readJson('adapters/manifests/generated-assets.json');
  for (const asset of adapterManifest.assets) assert(catalogPaths.has(asset.path), `Adapter generated asset is uncataloged: ${asset.path}`);

  if ((await pathKind('adapters/manifests/ecosystem-assets.json')) === 'file') {
    const ecosystemManifest = await readJson('adapters/manifests/ecosystem-assets.json');
    assert(catalogPaths.has('adapters/manifests/ecosystem-assets.json'), 'Ecosystem asset manifest is uncataloged.');
    for (const asset of ecosystemManifest.outputs) assert(catalogPaths.has(asset.path), `Ecosystem generated asset is uncataloged: ${asset.path}`);
  }

  const guidedManifestPath = 'packages/pipeline/conformance/fixtures/guided-runtime-parity/generated-assets.json';
  if ((await pathKind(guidedManifestPath)) === 'file') {
    const manifest = await readJson(guidedManifestPath);
    assert(catalogPaths.has(guidedManifestPath), 'Guided adapter manifest is uncataloged.');
    for (const asset of manifest.assets) assert(catalogPaths.has(`packages/pipeline/${asset.path}`), `Guided adapter asset is uncataloged: ${asset.path}`);
  }

  const operateAdapterManifestPath = 'packages/pipeline/conformance/fixtures/operate-adapter-parity/generated-assets.json';
  if ((await pathKind(operateAdapterManifestPath)) === 'file') {
    const manifest = await readJson(operateAdapterManifestPath);
    assert(catalogPaths.has(operateAdapterManifestPath), 'Operate adapter manifest is uncataloged.');
    for (const asset of [
      ...(manifest.skillDistribution?.assets ?? []),
      ...manifest.adapters.flatMap((adapter) => adapter.assets ?? []),
    ]) {
      assert(catalogPaths.has(`packages/pipeline/${asset.path}`), `Operate adapter asset is uncataloged: ${asset.path}`);
    }
  }

  for (const manifestPath of [
    'packages/pipeline/lib/generated/protocol-projection.json',
    'packages/pipeline/lib/generated/domain-projections/artifact.json',
    'packages/pipeline/lib/generated/domain-projections/design.json',
    'packages/pipeline/lib/generated/domain-projections/operate.json',
  ]) {
    if ((await pathKind(manifestPath)) !== 'file') continue;
    const manifest = await readJson(manifestPath);
    assert(catalogPaths.has(manifestPath), `Projection manifest is uncataloged: ${manifestPath}`);
    for (const entry of manifest.entries) {
      const assetPath = `packages/pipeline/${entry.target}`;
      assert(catalogPaths.has(assetPath), `Projected generated asset is uncataloged: ${assetPath}`);
    }
  }

  for (const generatedRoot of [
    'packages/protocol/src/generated',
    'packages/protocol/projections/pipeline',
    'packages/protocol/schemas/v1.5.0',
    'packages/protocol/schemas/v1.6.0',
    'packages/protocol/schemas/v1.7.0',
    'packages/protocol/registries',
  ]) {
    for (const assetPath of await walkFiles(generatedRoot)) assert(catalogPaths.has(assetPath), `Protocol generated asset is uncataloged: ${assetPath}`);
  }

  for (const generatedRoot of ['packages/pipeline/lib/dashboard/generated']) {
    for (const assetPath of await walkFiles(generatedRoot)) {
      if (assetPath.endsWith('.json') || generatedRoot.endsWith('/generated')) {
        assert(catalogPaths.has(assetPath), `Generated asset is uncataloged: ${assetPath}`);
      }
    }
  }
}

async function walkFiles(relativeDirectory) {
  const results = [];
  for (const entry of await readdir(path.join(REPOSITORY_ROOT, relativeDirectory), { withFileTypes: true })) {
    const child = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) results.push(...(await walkFiles(child)));
    else if (entry.isFile()) results.push(child);
  }
  return results;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.join(REPOSITORY_ROOT, 'scripts/migration/verify-preservation-catalog.mjs');
if (isMain) {
  try {
    console.log(JSON.stringify(await verifyPreservationCatalog()));
  } catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
