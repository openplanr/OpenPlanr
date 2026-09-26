#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DIAGRAM_AUTHORING_CONTRACT_FILES } from '../../packages/protocol/src/diagram-authoring-contracts.mjs';
import { validateJson } from '../../packages/protocol/src/json-schema.mjs';

import {
  DIAGRAM_V16_REGISTRIES,
  PROTOCOL_V16_CONTRACT_FILES,
  PROTOCOL_V17_CONTRACT_FILES,
  PROTOCOL_V17_REGISTRIES,
  PROTOCOL_V18_CONTRACT_FILES,
} from '../../packages/protocol/src/skill-source-contracts.mjs';
import { validateWorkspaceManifests } from '../lib/workspace-release-policy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arguments_ = process.argv.slice(2);
const ecosystemSchemaPath = 'scripts/marketplace/openplanr-ecosystem.schema.json';

class EcosystemGenerationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'EcosystemGenerationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new EcosystemGenerationError(code, message, details);
}

function parseMode(argv) {
  if (argv.length !== 1 || !['--write', '--check'].includes(argv[0])) {
    fail('E_ECOSYSTEM_ARGUMENT', 'Use exactly one of --write or --check.');
  }
  return argv[0].slice(2);
}

function canonicalText(bytes) {
  return bytes.replace(/\r\n/gu, '\n');
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function absolutePath(path) {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.startsWith('/') ||
    path.split(/[\\/]/u).some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail('E_ECOSYSTEM_PATH', 'Ecosystem paths must be safe repository-relative paths.', { path });
  }
  const absolute = resolve(repoRoot, path);
  if (!absolute.startsWith(`${repoRoot}${sep}`))
    fail('E_ECOSYSTEM_PATH_ESCAPE', 'Ecosystem path escapes the repository.', { path });
  return absolute;
}

function read(path) {
  const absolute = absolutePath(path);
  if (!existsSync(absolute))
    fail('E_ECOSYSTEM_INPUT_MISSING', `Required ecosystem input is missing: ${path}`, { path });
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile())
    fail('E_ECOSYSTEM_INPUT_TYPE', `Required ecosystem input must be a regular file: ${path}`, {
      path,
    });
  return readFileSync(absolute);
}

function readText(path) {
  return canonicalText(read(path).toString('utf8'));
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    fail('E_ECOSYSTEM_JSON', `Cannot parse ecosystem input ${path}.`, {
      path,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function digestRef(path) {
  return { path, digest: sha256(read(path)) };
}

function assertEqual(actual, expected, code, message, details = {}) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    fail(code, message, { ...details, expected, actual });
}

function listFiles(path) {
  const base = absolutePath(path);
  if (!existsSync(base)) return [];
  if (lstatSync(base).isSymbolicLink() || !lstatSync(base).isDirectory())
    fail('E_ECOSYSTEM_DIRECTORY_TYPE', `${path} must be a regular directory.`);
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const target = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        fail(
          'E_ECOSYSTEM_SYMLINK',
          `Ecosystem custody does not accept symlinks: ${relative(repoRoot, target)}`,
        );
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(relative(repoRoot, target).split(sep).join('/'));
      else
        fail(
          'E_ECOSYSTEM_FILE_TYPE',
          `Unsupported file type in ecosystem custody: ${relative(repoRoot, target)}`,
        );
    }
  };
  visit(base);
  return files.sort();
}

function component(path, publication) {
  const manifest = readJson(`${path}/package.json`);
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string')
    fail('E_ECOSYSTEM_PACKAGE', `${path}/package.json does not declare name and version.`);
  return {
    package: manifest.name,
    version: manifest.version,
    path,
    publication,
    manifestDigest: sha256(read(`${path}/package.json`)),
  };
}

function verifyGeneratedAssets(manifestPath) {
  const manifest = readJson(manifestPath);
  if (!Array.isArray(manifest.assets))
    fail('E_ECOSYSTEM_ASSET_MANIFEST', `${manifestPath} does not expose an assets array.`);
  for (const asset of manifest.assets) {
    if (typeof asset?.path !== 'string' || typeof asset?.digest !== 'string')
      fail('E_ECOSYSTEM_ASSET_ROW', `${manifestPath} has an invalid asset row.`, { asset });
    const actual = sha256(read(asset.path));
    if (actual !== asset.digest)
      fail('E_ECOSYSTEM_ASSET_DIGEST', `${asset.path} differs from ${manifestPath}.`, {
        expected: asset.digest,
        actual,
      });
  }
  return manifest;
}

function renderAdapterDoc(ecosystem) {
  const hosts = ecosystem.adapters.hosts
    .map((host) => `| \`${host.id}\` | ${host.version} | ${host.capabilityLevel} |`)
    .join('\n');
  return `<!-- Generated by scripts/marketplace/generate-ecosystem.mjs. -->
# OpenPlanr adapter projections

All host packages are generated from the Protocol ${ecosystem.protocol.current} standard skill packages under \`skills/\`. They are not independent workflows and are never checked in.

| Host | Adapter version | Capability level |
|---|---:|---|
${hosts}

The ignored \`dist/plugins/\` tree contains ${ecosystem.catalogs.skills.count} canonical skills for OpenAI, Claude Code, and Cursor. Claude Code additionally receives ${ecosystem.catalogs.roles.count} host-native role agents. No generated commands, compatibility aliases, pipeline-owned prompt copies, or legacy role aliases are packaged.

Semantic workflows execute in the active host agent. The optional CLI is limited to deterministic utilities and integrations.
`;
}

function renderEcosystemDoc(ecosystem) {
  const rows = Object.values(ecosystem.components)
    .map(
      (row) =>
        `| \`${row.package}\` | ${row.version ?? 'pending'} | \`${row.path}\` | ${row.publication} |`,
    )
    .join('\n');
  return `<!-- Generated by scripts/marketplace/generate-ecosystem.mjs. -->
# OpenPlanr local ecosystem

This is the deterministic local-candidate ledger for OpenPlanr ${ecosystem.workspace.version}. It reads only files in this repository and makes no publication or remote-repository claim.

| Package | Version | Path | Publication |
|---|---:|---|---|
${rows}

Compatibility invariants:

- \`openplanr\` uses the exact optional \`planr-pipeline@${ecosystem.compatibility.cliOptionalPipeline.version}\` dependency.
- The public pipeline retains ${ecosystem.publicCompatibility.pipelineExportKeys} export keys and ${ecosystem.publicCompatibility.pipelineRootSymbols} root symbols.
- ${ecosystem.schemas.preserved.count} historical schemas and ${ecosystem.registries.preserved.count} registries remain accounted for; Protocol ${ecosystem.protocol.current} adds ${ecosystem.schemas.successors.count} successor schemas.
- ${ecosystem.catalogs.commands.rootCommands} root commands, ${ecosystem.catalogs.skills.count} canonical skills, ${ecosystem.catalogs.roles.count} canonical roles, and ${ecosystem.catalogs.outputs.count} output contracts are catalog-bound.
- \`planr\`, \`openplanr\`, and deprecated \`opr\` resolve to one CLI parser.
- \`planr operate ...\` remains supported; \`planr pipeline operate ...\` and pipeline plugin Operate assets remain retired.
`;
}

// Progressive references are what a reader chooses to open; schemas, scripts and runtime
// assets are inventory. The complete per-skill file list stays in the generated manifests.
function renderSupport(support) {
  if (support.length === 0) return 'none; the skill is intentionally single-file';
  const references = support.filter((path) => path.startsWith('references/'));
  const others = support.length - references.length;
  if (references.length === 0) return `${support.length} packaged resources`;
  const listed = references.map((path) => `\`${path}\``).join(', ');
  return others === 0
    ? listed
    : `${listed}, and ${others} packaged schema, script, and runtime resources`;
}

function renderSkillCatalog(sourceRegistry, contentManifest) {
  const contentById = new Map(contentManifest.skills.map((skill) => [skill.skillId, skill]));
  const sections = sourceRegistry.skills
    .map((skill) => {
      const content = contentById.get(skill.skillId);
      if (!content || !content.entrypoint.endsWith('/SKILL.md')) {
        fail('E_ECOSYSTEM_SKILL_ENTRYPOINT', `${skill.skillId} has no packaged skill entrypoint.`);
      }
      const entryPrefix = content.entrypoint.slice(0, -'SKILL.md'.length);
      const support = content.assets
        .map(({ path }) => {
          if (!path.startsWith(entryPrefix)) {
            fail(
              'E_ECOSYSTEM_SKILL_RESOURCE',
              `${skill.skillId} resource is outside its packaged directory.`,
              { path },
            );
          }
          return path.slice(entryPrefix.length);
        })
        .filter(
          (path) =>
            path !== 'SKILL.md' && path !== 'openplanr.skill.json' && path !== 'agents/openai.yaml',
        );
      const projectedName = skill.skillId.replace(/^planr-/u, '');
      return `## \`${skill.skillId}\`

${skill.description}

- Select for: ${skill.triggerPolicy.include.join('; ')}.
- Defer for: ${skill.triggerPolicy.exclude.join('; ')}.
- Invocation from the plugin: \`$planr:${projectedName}\` in Codex/ChatGPT; \`/planr:${projectedName}\` in Claude Code.
- Hosts: Claude Code, Codex, ChatGPT, and Cursor where supported by the package manifest.
- Aliases: none.
- Packaged support: ${renderSupport(support)}.
`;
    })
    .join('\n');
  return `<!-- Generated by scripts/marketplace/generate-ecosystem.mjs. -->
# OpenPlanr skill catalog

This catalog is generated from the canonical routing registry and the installed-content manifest. Do not edit it directly. Descriptions are the metadata-only discovery contract; support files load only after selection.

${sections}`;
}

async function buildOutputs() {
  const workspace = readJson('package.json');
  const components = {
    cli: component('packages/cli', 'public'),
    pipeline: component('packages/pipeline', 'public'),
    protocol: component('packages/protocol', 'public'),
    operate: component('packages/operate', 'private'),
    artifact: component('packages/artifact', 'private'),
    design: component('packages/design', 'private'),
    skillRuntime: component('packages/skill-runtime', 'private'),
    integrations: component('packages/integrations', 'private'),
  };
  const dashboardManifest = resolve(repoRoot, 'apps/dashboard/package.json');
  components.dashboard = existsSync(dashboardManifest)
    ? component('apps/dashboard', 'private')
    : {
        package: '@openplanr/dashboard',
        version: null,
        path: 'apps/dashboard',
        publication: 'private',
        state: 'deferred-local-extraction',
        manifestDigest: null,
      };

  const manifestByPath = new Map(
    Object.values(components).map(({ path }) => [path, readJson(`${path}/package.json`)]),
  );
  const releaseFailures = validateWorkspaceManifests(workspace, manifestByPath);
  if (releaseFailures.length > 0)
    fail(
      'E_ECOSYSTEM_RELEASE_BOUNDARY',
      'Package identities or release dependencies are invalid.',
      { failures: releaseFailures },
    );

  const cliManifest = readJson('packages/cli/package.json');
  const pipelineManifest = readJson('packages/pipeline/package.json');
  assertEqual(
    cliManifest.optionalDependencies?.['planr-pipeline'],
    components.pipeline.version,
    'E_ECOSYSTEM_PIPELINE_PIN',
    'CLI optional pipeline dependency must be exact and match the in-repo pipeline.',
  );
  assertEqual(
    cliManifest.bin,
    { planr: './bin/planr.js', openplanr: './bin/planr.js', opr: './bin/planr.js' },
    'E_ECOSYSTEM_CLI_BINS',
    'CLI aliases must resolve to one parser.',
  );
  assertEqual(
    pipelineManifest.bin,
    { 'planr-pipeline': 'bin/planr-pipeline.mjs' },
    'E_ECOSYSTEM_PIPELINE_BIN',
    'Pipeline binary drifted.',
  );
  const preservedExports = readJson('conformance/packed-surface-baseline.json').baselineExportKeys;
  const expectedExports = [
    ...preservedExports,
    './dashboard',
    './design-lineage',
    './design-plan-handoff',
    './design-delivery-status',
    './diagram-authoring',
    './diagram-authoring-store',
    './diagram-authoring-export',
    './diagram-editor',
    './diagram-editor.css',
    './diagram-owner',
  ].sort();
  const actualExports = Object.keys(pipelineManifest.exports ?? {}).sort();
  assertEqual(
    actualExports,
    expectedExports,
    'E_ECOSYSTEM_PIPELINE_EXPORT_KEYS',
    'Public pipeline export-key parity drifted.',
  );
  const pipelineExportKeys = actualExports.length;
  const rootModule = await import(
    pathToFileURL(resolve(repoRoot, 'packages/pipeline/lib/pipeline/index.mjs')).href
  );
  const pipelineRootSymbols = Object.keys(rootModule).length;
  assertEqual(
    pipelineRootSymbols,
    229,
    'E_ECOSYSTEM_PIPELINE_ROOT_SYMBOLS',
    'Public pipeline root-symbol parity drifted.',
  );

  const commands = readJson('packages/protocol/registries/commands.json');
  const skills = readJson('packages/protocol/registries/skills.json');
  const roles = readJson('packages/protocol/registries/roles.json');
  const rules = readJson('packages/protocol/registries/rules.json');
  const taskKinds = readJson('packages/protocol/registries/task-kinds.json');
  const outputs = readJson('packages/protocol/registries/outputs.json');
  const outputPaths = readJson('packages/protocol/registries/output-paths.json');
  for (const [name, catalog] of Object.entries({
    commands,
    skills,
    roles,
    rules,
    taskKinds,
    outputs,
    outputPaths,
  })) {
    if (catalog.protocolVersion !== '1.5.0')
      fail('E_ECOSYSTEM_PROTOCOL_CATALOG', `${name} is not a Protocol 1.5 catalog.`);
  }

  const skillAssets = verifyGeneratedAssets('adapters/manifests/generated-assets.json');
  const canonicalSkills = readJson('adapters/manifests/canonical-skills.json');
  const roleAssets = readJson('adapters/manifests/role-assets.json');
  const protocolSkillIds = skills.skills.map(({ skillId }) => skillId).sort();
  const protocolRoleIds = roles.roles.map(({ roleId }) => roleId).sort();
  assertEqual(
    [...canonicalSkills.skillIds].sort(),
    protocolSkillIds,
    'E_ECOSYSTEM_SKILL_MEMBERSHIP',
    'Generated skill membership differs from Protocol.',
  );
  assertEqual(
    [...roleAssets.roleIds].sort(),
    protocolRoleIds,
    'E_ECOSYSTEM_ROLE_MEMBERSHIP',
    'Generated role membership differs from Protocol.',
  );
  assertEqual(protocolRoleIds.length, 9, 'E_ECOSYSTEM_ROLE_COUNT', 'Canonical role count drifted.');
  if (!protocolRoleIds.includes('planr-documentation') || protocolRoleIds.includes('planr-docs'))
    fail('E_ECOSYSTEM_DOCUMENTATION_ROLE', 'Canonical documentation role taxonomy drifted.');

  const adapterRegistry = readJson('packages/protocol/registry/adapters.json');
  const adapterIds = adapterRegistry.adapters.map(({ id }) => id).sort();
  assertEqual(
    adapterIds,
    ['claude-code', 'codex', 'cursor'],
    'E_ECOSYSTEM_ADAPTER_MEMBERSHIP',
    'Runtime adapter membership drifted.',
  );
  const evaluationHostProfilesPath = 'packages/protocol/registry/evaluation-host-profiles.json';
  const evaluationHostProfiles = readJson(evaluationHostProfilesPath);
  assertEqual(
    evaluationHostProfiles.profiles.map(({ host }) => host),
    ['claude-code', 'codex', 'cursor'],
    'E_ECOSYSTEM_EVALUATION_HOSTS',
    'Evaluation host-profile membership drifted.',
  );
  const evaluationGradersPath = 'packages/protocol/registry/evaluation-graders.json';
  const evaluationGraders = readJson(evaluationGradersPath);

  const schemaPaths = listFiles('packages/protocol/schemas').filter((path) =>
    path.endsWith('.schema.json'),
  );
  const schemaCounts = Object.fromEntries(
    [
      'v1.0.0',
      'v1.1.0',
      'v1.2.0',
      'v1.3.0',
      'v1.4.0',
      'v1.5.0',
      'v1.6.0',
      'v1.7.0',
      'v1.8.0',
      'v1.13.0',
      'v2.0.0',
    ].map((version) => [
      version,
      schemaPaths.filter((path) => path.includes(`/schemas/${version}/`)).length,
    ]),
  );
  const preservedDistribution = {
    'v1.0.0': 12,
    'v1.1.0': 34,
    'v1.2.0': 25,
    'v1.3.0': 5,
    'v1.4.0': 15,
    'v2.0.0': 89,
  };
  for (const [version, count] of Object.entries(preservedDistribution))
    assertEqual(
      schemaCounts[version],
      count,
      'E_ECOSYSTEM_SCHEMA_PRESERVATION',
      `Historical schema count drifted for ${version}.`,
    );
  assertEqual(
    schemaCounts['v1.5.0'],
    13,
    'E_ECOSYSTEM_SCHEMA_SUCCESSORS',
    'Protocol 1.5 successor schema count drifted.',
  );
  assertEqual(
    schemaCounts['v1.6.0'],
    Object.keys(PROTOCOL_V16_CONTRACT_FILES).length + 1,
    'E_ECOSYSTEM_SCHEMA_SUCCESSORS_16',
    'Protocol 1.6 successor schema count drifted.',
  );
  assertEqual(
    schemaCounts['v1.7.0'],
    Object.keys(PROTOCOL_V17_CONTRACT_FILES).length + 1,
    'E_ECOSYSTEM_SCHEMA_SUCCESSORS_17',
    'Protocol 1.7 successor schema count drifted.',
  );
  assertEqual(
    schemaCounts['v1.8.0'],
    Object.keys(PROTOCOL_V18_CONTRACT_FILES).length + 1,
    'E_ECOSYSTEM_SCHEMA_SUCCESSORS_18',
    'Protocol 1.8 successor schema count drifted.',
  );
  assertEqual(
    schemaCounts['v1.13.0'],
    Object.keys(DIAGRAM_AUTHORING_CONTRACT_FILES).length,
    'E_ECOSYSTEM_SCHEMA_SUCCESSORS_113',
    'Protocol 1.13 authoring schema count drifted.',
  );
  const additiveSchemaCount =
    schemaCounts['v1.5.0'] +
    schemaCounts['v1.6.0'] +
    schemaCounts['v1.7.0'] +
    schemaCounts['v1.8.0'] +
    schemaCounts['v1.13.0'];
  const legacyRegistryPaths = listFiles('packages/protocol/registry').filter((path) =>
    path.endsWith('.json'),
  );
  assertEqual(
    legacyRegistryPaths.length,
    12,
    'E_ECOSYSTEM_REGISTRY_PRESERVATION',
    'Preserved registry count drifted.',
  );
  const protocolCatalogPaths = listFiles('packages/protocol/registries').filter((path) =>
    path.endsWith('.json'),
  );
  for (const [file, descriptor] of Object.entries({
    ...DIAGRAM_V16_REGISTRIES,
    ...PROTOCOL_V17_REGISTRIES,
  })) {
    const catalog = readJson(`packages/protocol/registries/${file}`);
    if (
      catalog.protocolVersion !== descriptor.protocolVersion ||
      catalog.kind !== descriptor.kind
    ) {
      fail(
        'E_ECOSYSTEM_PROTOCOL_CATALOG',
        `${file} does not match its canonical Protocol registry descriptor.`,
      );
    }
  }
  const v16CatalogFileNames = new Set(Object.keys(DIAGRAM_V16_REGISTRIES));
  const v17CatalogFileNames = new Set(Object.keys(PROTOCOL_V17_REGISTRIES));
  const protocol16CatalogPaths = protocolCatalogPaths.filter((path) =>
    v16CatalogFileNames.has(path.split('/').at(-1)),
  );
  const protocol17CatalogPaths = protocolCatalogPaths.filter((path) =>
    v17CatalogFileNames.has(path.split('/').at(-1)),
  );
  const protocol113CatalogPaths = protocolCatalogPaths.filter((path) =>
    path.endsWith('/diagram-authoring-capabilities.json'),
  );
  const protocol15CatalogPaths = protocolCatalogPaths.filter(
    (path) =>
      !v16CatalogFileNames.has(path.split('/').at(-1)) &&
      !v17CatalogFileNames.has(path.split('/').at(-1)) &&
      !protocol113CatalogPaths.includes(path),
  );
  assertEqual(
    protocol15CatalogPaths.length,
    7,
    'E_ECOSYSTEM_PROTOCOL_CATALOG_COUNT',
    'Protocol 1.5 catalog count drifted.',
  );
  assertEqual(
    protocol16CatalogPaths.length,
    Object.keys(DIAGRAM_V16_REGISTRIES).length,
    'E_ECOSYSTEM_PROTOCOL16_CATALOG_COUNT',
    'Protocol 1.6 catalog count drifted.',
  );
  assertEqual(
    protocol17CatalogPaths.length,
    Object.keys(PROTOCOL_V17_REGISTRIES).length,
    'E_ECOSYSTEM_PROTOCOL17_CATALOG_COUNT',
    'Protocol 1.7 catalog count drifted.',
  );

  assertEqual(
    protocol113CatalogPaths.length,
    1,
    'E_ECOSYSTEM_PROTOCOL113_CATALOG_COUNT',
    'Protocol 1.13 authoring catalog count drifted.',
  );
  assertEqual(
    readJson(protocol113CatalogPaths[0]).protocolVersion,
    '1.13.0',
    'E_ECOSYSTEM_PROTOCOL113_CATALOG',
    'Authoring catalog version drifted.',
  );

  const artifactShellPath =
    'packages/artifact/lib/artifact/ui/generated/artifact-shell-assets.json';
  const artifactShell = readJson(artifactShellPath);
  const landingCatalogPath = 'packages/protocol/registry/landing-workflows.json';
  const landingAssetsPath =
    'packages/pipeline/conformance/fixtures/landing-workflow/generated-assets.json';
  const landingCatalog = readJson(landingCatalogPath);
  const landingAssets = readJson(landingAssetsPath);

  const ecosystem = {
    kind: 'openplanr-ecosystem',
    schemaVersion: '1.0.0',
    releaseState: 'local-candidate',
    repositoryIntent: 'openplanr/OpenPlanr',
    remoteState: 'not-queried',
    workspace: {
      package: workspace.name,
      version: workspace.version,
      private: true,
      workspaces: workspace.workspaces,
      manifestDigest: sha256(read('package.json')),
    },
    protocol: {
      current: '1.8.0',
      additiveVersions: ['1.5.0', '1.6.0', '1.7.0', '1.8.0', '1.13.0'],
      supportedReaders: [
        '1.0.x',
        '1.1.x',
        '1.2.x',
        '1.3.x',
        '1.4.x',
        '1.5.x',
        '1.6.x',
        '1.7.x',
        '1.8.x',
        '1.13.x',
        '2.0.x',
      ],
    },
    components,
    compatibility: {
      cliOptionalPipeline: {
        package: 'planr-pipeline',
        version: components.pipeline.version,
        exact: true,
      },
      publicArtifacts: { selfContained: true, privateWorkspaceDependenciesAllowed: false },
    },
    binaries: {
      cli: cliManifest.bin,
      pipeline: pipelineManifest.bin,
    },
    publicCompatibility: {
      pipelineExportKeys,
      pipelineRootSymbols,
    },
    catalogs: {
      commands: {
        ...digestRef('packages/protocol/registries/commands.json'),
        rootCommands: commands.inventory.rootCommandModules,
        pipelineMachineLeaves: commands.inventory.pipelineMachineLeaves,
        frozenClaudeDocuments: commands.inventory.frozenClaudeDocuments,
        negativeContracts: commands.negativeContracts,
      },
      skills: {
        ...digestRef('packages/protocol/registries/skills.json'),
        count: protocolSkillIds.length,
        ids: protocolSkillIds,
        aliases: canonicalSkills.aliases.map(({ id }) => id).sort(),
        membershipDigest: canonicalSkills.membershipDigest,
      },
      roles: {
        ...digestRef('packages/protocol/registries/roles.json'),
        count: protocolRoleIds.length,
        ids: protocolRoleIds,
        aliases: roleAssets.aliases,
      },
      rules: { ...digestRef('packages/protocol/registries/rules.json'), count: rules.rules.length },
      taskKinds: {
        ...digestRef('packages/protocol/registries/task-kinds.json'),
        count: taskKinds.bindings.length,
      },
      outputs: {
        ...digestRef('packages/protocol/registries/outputs.json'),
        count: outputs.outputs.length,
      },
      outputPaths: {
        ...digestRef('packages/protocol/registries/output-paths.json'),
        count: outputPaths.outputs.length,
        outputCatalogDigest: outputPaths.outputCatalogDigest,
      },
    },
    adapters: {
      registry: digestRef('packages/protocol/registry/adapters.json'),
      // Registry versions describe the preserved adapter contract. Runtime
      // package release projections follow the implementation manifest.
      hosts: adapterRegistry.adapters
        .map(({ id, capabilityLevel }) => ({
          id,
          version: components.pipeline.version,
          capabilityLevel,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      generatedAssets: {
        ...digestRef('adapters/manifests/generated-assets.json'),
        count: skillAssets.assets.length,
      },
    },
    schemas: {
      preserved: {
        count: Object.values(preservedDistribution).reduce((sum, count) => sum + count, 0),
        distribution: preservedDistribution,
      },
      successors: { protocolVersion: '1.8.0', count: schemaCounts['v1.8.0'] },
      additive: {
        count: additiveSchemaCount,
        byVersion: {
          'v1.5.0': schemaCounts['v1.5.0'],
          'v1.6.0': schemaCounts['v1.6.0'],
          'v1.7.0': schemaCounts['v1.7.0'],
          'v1.8.0': schemaCounts['v1.8.0'],
          'v1.13.0': schemaCounts['v1.13.0'],
        },
      },
      total: schemaPaths.length,
    },
    registries: {
      preserved: { count: legacyRegistryPaths.length, path: 'packages/protocol/registry' },
      canonicalCatalogs: {
        count:
          protocol15CatalogPaths.length +
          protocol16CatalogPaths.length +
          protocol17CatalogPaths.length +
          protocol113CatalogPaths.length,
        path: 'packages/protocol/registries',
      },
      protocol15Catalogs: {
        count: protocol15CatalogPaths.length,
        path: 'packages/protocol/registries',
      },
      protocol16Catalogs: {
        count: protocol16CatalogPaths.length,
        path: 'packages/protocol/registries',
      },
      protocol17Catalogs: {
        count: protocol17CatalogPaths.length,
        path: 'packages/protocol/registries',
      },
      protocol113Catalogs: {
        count: protocol113CatalogPaths.length,
        path: 'packages/protocol/registries',
      },
      capturedEvaluationContracts: {
        lifecycle: 'byte-preserved',
        hostProfiles: {
          ...digestRef(evaluationHostProfilesPath),
          registryId: evaluationHostProfiles.registryId,
          count: evaluationHostProfiles.profiles.length,
        },
        graders: {
          ...digestRef(evaluationGradersPath),
          registryId: evaluationGraders.registryId,
          count: evaluationGraders.graders.length,
        },
      },
    },
    generatedSurfaces: {
      artifactShell: {
        ...digestRef(artifactShellPath),
        shellVersion: artifactShell.shellVersion,
        assetCount: artifactShell.assets.length,
      },
      landingWorkflow: {
        catalog: {
          ...digestRef(landingCatalogPath),
          workflowId: landingCatalog.workflow.workflowId,
          workflowVersion: landingCatalog.workflow.workflowVersion,
          catalogHash: landingCatalog.catalogHash,
          authority: landingCatalog.authority,
        },
        generatedAssets: {
          ...digestRef(landingAssetsPath),
          assetCount: landingAssets.assets.length,
          workflowCatalogDigest: landingAssets.workflowCatalogDigest,
        },
      },
    },
  };
  const ecosystemJson = stableJson(ecosystem);
  const schemaErrors = validateJson(JSON.parse(ecosystemJson), readJson(ecosystemSchemaPath));
  if (schemaErrors.length > 0)
    fail('E_ECOSYSTEM_SCHEMA', `ecosystem.json does not satisfy ${ecosystemSchemaPath}.`, {
      errors: schemaErrors,
    });

  const codexPluginContent = readJson('adapters/manifests/codex-plugin-content.json');
  const plugin = {
    $schema: 'https://json.schemastore.org/claude-code-plugin.json',
    name: 'planr',
    version: components.cli.version,
    description: 'Host-native OpenPlanr planning, delivery, review, design, and operating skills.',
    author: { name: 'AsemDevs' },
    license: 'MIT',
  };
  const marketplace = {
    $schema: 'https://json.schemastore.org/claude-code-marketplace.json',
    name: 'openplanr',
    owner: { name: 'AsemDevs' },
    metadata: {
      version: components.cli.version,
      description:
        'Local-only OpenPlanr integration marketplace. Generate host packages before installation.',
    },
    plugins: [
      {
        name: 'planr',
        source: './dist/plugins/claude/openplanr',
        version: components.cli.version,
        description: plugin.description,
        strict: true,
      },
    ],
  };
  const sourceSkillRegistry = readJson('skills/registry.json');

  const adapterDoc = renderAdapterDoc(ecosystem);
  const ecosystemDoc = renderEcosystemDoc(ecosystem);
  const skillCatalogDoc = renderSkillCatalog(sourceSkillRegistry, codexPluginContent);
  // The pipeline plugin manifest keeps its hand-maintained metadata; only its version is derived.
  const pipelinePlugin = {
    ...readJson('packages/pipeline/.claude-plugin/plugin.json'),
    version: components.pipeline.version,
  };
  const outputsMap = new Map([
    ['ecosystem.json', ecosystemJson],
    ['.claude-plugin/plugin.json', stableJson(plugin)],
    ['packages/pipeline/.claude-plugin/plugin.json', stableJson(pipelinePlugin)],
    ['.claude-plugin/marketplace.json', stableJson(marketplace)],
    ['adapters/manifests/codex-plugin-content.json', stableJson(codexPluginContent)],
    ['docs/generated/adapters.md', adapterDoc],
    ['docs/generated/ecosystem.md', ecosystemDoc],
    ['docs/generated/skills.md', skillCatalogDoc],
  ]);
  const custody = {
    kind: 'openplanr-ecosystem-generated-assets',
    schemaVersion: '1.0.0',
    protocolVersion: '1.5.0',
    generator: 'scripts/marketplace/generate-ecosystem.mjs',
    inputs: [
      'scripts/marketplace/generate-ecosystem.mjs',
      ecosystemSchemaPath,
      'scripts/lib/workspace-release-policy.mjs',
      'conformance/packed-surface-baseline.json',
      'packages/protocol/src/semver.mjs',
      'package.json',
      ...Object.values(components)
        .filter(({ manifestDigest }) => manifestDigest)
        .map(({ path }) => `${path}/package.json`),
      'packages/protocol/registries/commands.json',
      'packages/protocol/registries/roles.json',
      'packages/protocol/registries/rules.json',
      'packages/protocol/registries/skills.json',
      'packages/protocol/registries/task-kinds.json',
      'packages/protocol/registries/outputs.json',
      'packages/protocol/registries/output-paths.json',
      'packages/protocol/registry/adapters.json',
      evaluationHostProfilesPath,
      evaluationGradersPath,
      'adapters/manifests/generated-assets.json',
    ]
      .map((path) => digestRef(path))
      .sort((left, right) => left.path.localeCompare(right.path)),
    outputs: [...outputsMap.entries()]
      .map(([path, bytes]) => ({ path, digest: sha256(Buffer.from(bytes, 'utf8')) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  outputsMap.set('adapters/manifests/ecosystem-assets.json', stableJson(custody));
  return outputsMap;
}

function writeAtomic(path, bytes) {
  const absolute = absolutePath(path);
  mkdirSync(dirname(absolute), { recursive: true });
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink())
    fail('E_ECOSYSTEM_OUTPUT_SYMLINK', `Generated output may not be a symlink: ${path}`);
  const temporary = `${absolute}.openplanr-tmp-${process.pid}`;
  writeFileSync(temporary, bytes, { encoding: 'utf8', mode: 0o644 });
  chmodSync(temporary, 0o644);
  renameSync(temporary, absolute);
}

async function run() {
  const mode = parseMode(arguments_);
  const outputs = await buildOutputs();
  if (mode === 'write') {
    for (const [path, bytes] of [...outputs.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ))
      writeAtomic(path, bytes);
    process.stdout.write(`Generated ${outputs.size} local ecosystem and marketplace assets.\n`);
    return;
  }
  const drift = [];
  for (const [path, expected] of outputs) {
    const absolute = absolutePath(path);
    if (!existsSync(absolute)) drift.push({ path, reason: 'missing' });
    else if (lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile())
      drift.push({ path, reason: 'type' });
    else {
      const actual = canonicalText(readFileSync(absolute, 'utf8'));
      if (actual !== expected)
        drift.push({
          path,
          reason: 'content',
          expected: sha256(Buffer.from(expected)),
          actual: sha256(Buffer.from(actual)),
        });
    }
  }
  if (drift.length > 0)
    fail('E_ECOSYSTEM_DRIFT', 'Generated ecosystem and marketplace assets are stale.', { drift });
  process.stdout.write(`Checked ${outputs.size} local ecosystem and marketplace assets.\n`);
}

try {
  await run();
} catch (error) {
  process.stderr.write(`${error?.code ?? 'E_ECOSYSTEM_GENERATION'}: ${error.message}\n`);
  if (error?.details && Object.keys(error.details).length > 0)
    process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
  process.exitCode = 1;
}
