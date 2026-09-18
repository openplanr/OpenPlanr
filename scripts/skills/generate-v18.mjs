#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXPECTED_ROLE_IDS,
  listRegularFiles,
  readSkillSourceRegistry,
  readStandardSkillPackage,
} from '../../packages/skill-runtime/src/catalog.mjs';
import { parseMarkdownAsset, sha256Bytes } from '../../packages/skill-runtime/src/compiler/index.mjs';
import { linkSkillProjection } from '../../packages/skill-runtime/src/linker/index.mjs';
import { renderOpenAiSkillMetadata } from '../../packages/skill-runtime/src/packaging/index.mjs';
import { buildDesignSkillResources, DESIGN_SKILL_IDS } from './design-resources.mjs';
import {
  HOST_PLUGIN_NAME,
  namespacedInvocation,
  projectedSkillName,
  renderNamespacedSkill,
} from './host-invocations.mjs';
import { resourceBytes } from './resource-bytes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const option = process.argv[2];
if (!['--write', '--check'].includes(option) || process.argv.length !== 3) {
  process.stderr.write('Usage: node scripts/skills/generate-v18.mjs <--write|--check>\n');
  process.exit(2);
}
const mode = option.slice(2);
// Host packages ship inside the CLI package, so their manifests carry its version.
const pluginVersion = JSON.parse(readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8')).version;
const registry = readSkillSourceRegistry({ repoRoot: root });
const skillIds = registry.skills.map(({ skillId }) => skillId);
const outputs = new Map();
const tracked = new Set();
const executable = new Set();
const generatedRoots = Object.freeze([
  'dist/plugins/openai',
  'dist/plugins/claude',
  'dist/plugins/cursor',
  'packages/cli/lib/host-packages',
]);
const operateAdvisorDestinations = Object.freeze([
  'planr-ceo-review',
  'planr-cto-review',
  'planr-cpo-review',
  'planr-cmo-review',
  'planr-coo-review',
]);
const operateValidatorDestinations = Object.freeze([
  'planr-operate',
  'planr-chair-review',
  'planr-challenger-review',
  ...operateAdvisorDestinations,
]);
const sharedSkillResources = Object.freeze([
  {
    source: 'packages/design/references/design-spec-template.md',
    destination: 'agents/shared/modes/shared/design-spec-template.md',
    executable: false,
  },
  ...DESIGN_SKILL_IDS.flatMap((skillId) => listRegularFiles(resolve(root, 'packages/design/references'), { relativeTo: resolve(root, 'packages/design/references') }).map((path) => ({
    source: `packages/design/references/${path}`,
    destination: `skills/${skillId}/references/${path}`,
    executable: false,
  }))),
  {
    source: 'packages/integrations/src/portable-sync.mjs',
    destination: 'packages/cli/lib/integrations.mjs',
    executable: false,
  },
  {
    source: 'packages/integrations/src/portable-sync.d.mts',
    destination: 'packages/cli/lib/integrations.d.mts',
    executable: false,
  },
  ...operateAdvisorDestinations.map((skillId) => ({
    source: 'skills/shared/operate-advisor-contract.md',
    destination: `skills/${skillId}/references/operate-advisor-contract.md`,
    executable: false,
  })),
  {
    source: 'packages/integrations/src/portable-sync.mjs',
    destination: 'skills/planr-sync/scripts/sync.mjs',
    executable: true,
  },
  ...operateValidatorDestinations.flatMap((skillId) => [
    {
      source: 'packages/skill-runtime/src/operate-review-note-cli.mjs',
      destination: `skills/${skillId}/scripts/validate-note.mjs`,
      executable: true,
    },
    {
      source: 'packages/skill-runtime/src/operate-review-note.mjs',
      destination: `skills/${skillId}/scripts/operate-review-note.mjs`,
      executable: false,
    },
    {
      source: 'packages/skill-runtime/src/operate-review-contract.mjs',
      destination: `skills/${skillId}/scripts/operate-review-contract.mjs`,
      executable: false,
    },
    {
      source: 'packages/skill-runtime/src/errors.mjs',
      destination: `skills/${skillId}/scripts/errors.mjs`,
      executable: false,
    },
  ]),
]);

for (const row of registry.skills) {
  const bytes = renderOpenAiSkillMetadata({
    skillId: row.skillId,
    description: row.description,
  });
  const destinationPath = `skills/${row.skillId}/agents/openai.yaml`;
  const destination = resolve(root, destinationPath);
  if (mode === 'write') {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { mode: 0o644 });
  } else if (!existsSync(destination) || readFileSync(destination, 'utf8').replace(/\r\n/gu, '\n') !== bytes) {
    throw new Error(`${destinationPath} drifted from the canonical skill registry.`);
  }
}

for (const resource of sharedSkillResources) {
  const source = readFileSync(resolve(root, resource.source));
  const destination = resolve(root, resource.destination);
  if (mode === 'write') {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source, { mode: resource.executable ? 0o755 : 0o644 });
    if (resource.executable) chmodSync(destination, 0o755);
  } else if (!existsSync(destination) || !readFileSync(destination).equals(source)) {
    throw new Error(`${resource.destination} drifted from ${resource.source}.`);
  }
}

const designResources = await buildDesignSkillResources({ repoRoot: root });
for (const skillId of [...DESIGN_SKILL_IDS, 'planr-plan']) {
  const manifestPath = resolve(root, `skills/${skillId}/openplanr.skill.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const expectedResources = [
    ...manifest.resources.filter(({ path }) => !designResources.some((resource) => resource.path === path) && (!path.startsWith('scripts/') || (skillId === 'planr-plan' && path === 'scripts/planning-ids.mjs'))),
    ...designResources.map(({ bytes: _bytes, ...resource }) => ({ ...resource, hosts: manifest.hosts })),
  ];
  const expectedManifest = `${JSON.stringify({ ...manifest, resources: expectedResources }, null, 2)}\n`;
  if (mode === 'write') writeFileSync(manifestPath, expectedManifest);
  else if (readFileSync(manifestPath, 'utf8') !== expectedManifest) throw new Error(`${skillId} runtime resource declarations drifted.`);
  const expectedPaths = new Set(designResources.map(({ path }) => path));
  for (const path of listRegularFiles(resolve(root, `skills/${skillId}/scripts`), { relativeTo: resolve(root, `skills/${skillId}`) })) {
    if (expectedPaths.has(path)) continue;
    if (skillId === 'planr-plan' && path === 'scripts/planning-ids.mjs') continue;
    if (mode === 'write') rmSync(resolve(root, `skills/${skillId}/${path}`));
    else throw new Error(`${skillId} has obsolete runtime asset ${path}.`);
  }
  for (const resource of designResources) {
    const destination = resolve(root, `skills/${skillId}/${resource.path}`);
    if (mode === 'write') {
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, resource.bytes);
      chmodSync(destination, resource.executable ? 0o755 : 0o644);
    } else if (!existsSync(destination) || !readFileSync(destination).equals(resource.bytes)) {
      throw new Error(`${skillId}/${resource.path} runtime resource drifted.`);
    }
  }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function read(path) {
  return readFileSync(resolve(root, path), 'utf8').replace(/\r\n/gu, '\n');
}

function add(path, bytes, { checkedIn = false, isExecutable = false } = {}) {
  if (outputs.has(path)) throw new Error(`Duplicate generated path: ${path}`);
  outputs.set(path, resourceBytes(bytes));
  if (checkedIn) tracked.add(path);
  if (isExecutable) executable.add(path);
}

function copySkillResource(packageInfo, resource, destinationRoot) {
  const path = `${destinationRoot}/${resource.path}`;
  add(path, readFileSync(resource.absolute), { isExecutable: resource.executable });
  return path;
}

function hostResources(packageInfo, host) {
  return packageInfo.resources.filter(({ hosts }) => hosts.includes(host));
}

function assertCanonicalSkill(packageInfo) {
  const { row, manifest, markdown, skillDir } = packageInfo;
  if (manifest.execution !== 'host-agent') {
    throw new Error(`${row.skillId} must execute in the active host agent.`);
  }
  if (/\{\{[A-Z0-9_]+\}\}/u.test(markdown)) {
    throw new Error(`${row.skillId} contains an unresolved custom variable.`);
  }
  if (/installed(?:-| )package(?:-| )root/iu.test(markdown)) {
    throw new Error(`${row.skillId} contains installed-package-root prose.`);
  }
  if (['planr-plan', 'planr-spec', 'planr-ship', ...DESIGN_SKILL_IDS].includes(row.skillId)) {
    const forbidden = [
      /`planr\s+plan(?:\s|`)/u,
      /`planr\s+spec\s+decompose(?:\s|`)/u,
      /`planr-pipeline(?:\s|`)/u,
      /ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA/iu,
    ];
    if (forbidden.some((pattern) => pattern.test(markdown))) {
      throw new Error(`${row.skillId} contains a forbidden semantic subprocess dependency.`);
    }
  }
  const parsed = parseMarkdownAsset(markdown, { expectedName: row.skillId });
  const resourceAssets = packageInfo.resources.map((resource) => ({
    path: resource.path,
    bytes: readFileSync(resource.absolute, 'utf8'),
  }));
  linkSkillProjection({
    skillId: row.skillId,
    host: 'canonical',
    primary: { path: 'SKILL.md', bytes: markdown },
    references: resourceAssets.filter(({ path }) => path.startsWith('references/')),
    auxiliary: resourceAssets.filter(({ path }) => !path.startsWith('references/')),
  });
  const declared = new Set(packageInfo.resources.map(({ path }) => path));
  for (const folder of ['references', 'scripts', 'assets', 'schemas', 'templates', 'agents']) {
    const directory = resolve(skillDir, folder);
    for (const path of listRegularFiles(directory, { relativeTo: skillDir })) {
      if (!declared.has(path)) throw new Error(`${row.skillId} has undeclared resource ${path}.`);
    }
  }
  return parsed;
}

if (registry.sourceFormat !== 'package-v1' || registry.protocolVersion !== '1.8.0') {
  throw new Error('The canonical registry must use Protocol 1.8 package-v1 sources.');
}
if (new Set(skillIds).size !== skillIds.length || registry.aliases.length !== 0) {
  throw new Error('The canonical registry must contain unique skills and zero aliases.');
}

const skillRows = [];
for (const row of registry.skills) {
  const packageInfo = readStandardSkillPackage({ repoRoot: root, registryRow: row });
  const parsed = assertCanonicalSkill(packageInfo);
  const hostSkillName = projectedSkillName(row.skillId);
  const sourceDigest = sha256Bytes(packageInfo.markdown);
  const resources = packageInfo.resources.map(({ absolute, ...resource }) => ({
    ...resource,
    digest: sha256Bytes(readFileSync(absolute)),
  }));

  for (const [host, destination] of [
    ['codex', `dist/plugins/openai/openplanr/skills/${hostSkillName}`],
    ['claude-code', `dist/plugins/claude/openplanr/skills/${hostSkillName}`],
  ]) {
    add(`${destination}/SKILL.md`, renderNamespacedSkill(packageInfo.markdown, row.skillId));
    add(`${destination}/openplanr.skill.json`, json(packageInfo.manifest));
    for (const resource of hostResources(packageInfo, host)) {
      if (host === 'codex' && resource.path === 'agents/openai.yaml') {
        add(`${destination}/${resource.path}`, renderOpenAiSkillMetadata({
          skillId: row.skillId,
          description: row.description,
          invocation: namespacedInvocation(row.skillId, 'codex'),
        }));
      } else {
        copySkillResource(packageInfo, resource, destination);
      }
    }
  }

  const cursorBody = packageInfo.markdown.replace(/^---[\s\S]*?---\s*/u, '');
  add(
    `dist/plugins/cursor/openplanr/rules/${row.skillId}.mdc`,
    `---\ndescription: ${JSON.stringify(parsed.fields.description)}\nalwaysApply: false\n---\n\n${cursorBody}`,
  );
  for (const resource of hostResources(packageInfo, 'cursor').filter(({ path }) => !path.startsWith('agents/'))) {
    copySkillResource(packageInfo, resource, `dist/plugins/cursor/openplanr/rules/${row.skillId}`);
  }

  skillRows.push({
    id: row.skillId,
    version: row.skillVersion,
    source: row.source,
    entrypoint: row.baseline,
    description: parsed.fields.description,
    sourceDigest,
    resources,
    contracts: row.contracts,
    ruleIds: row.ruleIds,
    contribution: row.contribution,
    authorityClass: row.authorityClass,
    utilityRequirements: row.utilityRequirements ?? [],
  });
}

const roleSources = listRegularFiles(resolve(root, 'agents'), { relativeTo: root })
  .filter((path) => path.endsWith('/AGENT.md'));
if (roleSources.length !== 9) throw new Error(`Expected nine canonical role agents, got ${roleSources.length}.`);
const roleRows = roleSources.map((source) => {
  const bytes = read(source)
    .replaceAll('{{WORKFLOW_PREFIX}}', `/${HOST_PLUGIN_NAME}:`)
    .replaceAll('{{AGENTS_ROOT}}', '${CLAUDE_PLUGIN_ROOT}/references/agents')
    .replaceAll('{{PIPELINE_PACKAGE_ROOT}}', '${CLAUDE_PLUGIN_ROOT}/references/pipeline')
    .replaceAll('{{PROJECT_STACKS_ROOT}}', '.openplanr/stacks');
  const name = /^name:\s*([^\n]+)$/mu.exec(bytes)?.[1]?.replace(/["']/gu, '').trim();
  if (!name || !EXPECTED_ROLE_IDS.includes(name)) throw new Error(`Invalid role identity in ${source}.`);
  const destination = `dist/plugins/claude/openplanr/agents/${name}.md`;
  add(destination, bytes);
  return { id: name, source, path: destination, digest: sha256Bytes(bytes) };
}).sort((left, right) => left.id.localeCompare(right.id));

for (const source of listRegularFiles(resolve(root, 'agents/shared'), { relativeTo: root })) {
  const bytes = read(source)
    .replaceAll('{{WORKFLOW_PREFIX}}', `/${HOST_PLUGIN_NAME}:`)
    .replaceAll('{{AGENTS_ROOT}}', '${CLAUDE_PLUGIN_ROOT}/references/agents')
    .replaceAll('{{PIPELINE_PACKAGE_ROOT}}', '${CLAUDE_PLUGIN_ROOT}/references/pipeline')
    .replaceAll('{{PROJECT_STACKS_ROOT}}', '.openplanr/stacks');
  add(`dist/plugins/claude/openplanr/references/${source}`, bytes);
}
for (const source of listRegularFiles(resolve(root, 'packages/pipeline/stacks'), { relativeTo: resolve(root, 'packages/pipeline') })) {
  add(`dist/plugins/claude/openplanr/references/pipeline/${source}`, read(`packages/pipeline/${source}`));
}

add('dist/plugins/openai/openplanr/.codex-plugin/plugin.json', json({
  name: HOST_PLUGIN_NAME,
  version: pluginVersion,
  description: 'Host-native OpenPlanr planning, delivery, review, design, and operating skills.',
  author: { name: 'AsemDevs' },
  license: 'MIT',
  skills: './skills/',
}));
add('dist/plugins/claude/openplanr/.claude-plugin/plugin.json', json({
  name: HOST_PLUGIN_NAME,
  version: pluginVersion,
  description: 'Host-native OpenPlanr planning, delivery, review, design, and operating skills.',
  author: { name: 'AsemDevs' },
  license: 'MIT',
}));
add('dist/plugins/cursor/openplanr/manifest.json', json({
  name: 'openplanr',
  version: pluginVersion,
  ruleCount: skillRows.length,
  rules: skillRows.map(({ id }) => `rules/${id}.mdc`),
}));

for (const [host, prefix] of [
  ['openai', 'dist/plugins/openai/openplanr/'],
  ['claude-code', 'dist/plugins/claude/openplanr/'],
  ['cursor', 'dist/plugins/cursor/openplanr/'],
]) {
  const files = [...outputs.entries()]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, bytes]) => ({
      path: path.slice(prefix.length),
      digest: sha256Bytes(bytes),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  add(`${prefix}.openplanr-content.json`, json({
    kind: 'openplanr-host-package-content',
    schemaVersion: '1.0.0',
    protocolVersion: '1.8.0',
    host,
    skillCount: skillRows.length,
    roleCount: host === 'claude-code' ? roleRows.length : 0,
    files,
    contentDigest: sha256Bytes(json(files)),
  }));
}

const CAPABILITY_FAMILY_TITLES = new Map([
  ['planning', 'Plan and specify'],
  ['implementation', 'Implement'],
  ['quality', 'Review and QA'],
  ['design', 'Design'],
  ['diagram', 'Diagrams'],
  ['artifact', 'Artifact reviews'],
  ['release', 'Land and release'],
  ['diagnostics', 'Setup and diagnostics'],
  ['planning-tools', 'Status, routing and sync'],
  ['operate', 'Operate'],
  ['operate-advisor', 'Operate advisors'],
  ['operate-synthesis', 'Operate synthesis'],
]);
const roleDescriptions = new Map(roleRows.map(({ id, source }) => [
  id,
  /^description:\s*([^\n]+)$/mu.exec(read(source))?.[1]?.replace(/["']/gu, '').trim() ?? '',
]));
// The compact inventory the CLI renders into CLAUDE.md and AGENTS.md so a host agent
// sees every skill and agent, not only the three workflow entry points.
add('packages/cli/lib/host-packages/capability-map.json', json({
  kind: 'openplanr-capability-map',
  schemaVersion: '1.0.0',
  pluginVersion,
  families: [...CAPABILITY_FAMILY_TITLES].map(([id, title]) => ({ id, title })),
  skills: registry.skills.map((row) => {
    if (!CAPABILITY_FAMILY_TITLES.has(row.family)) {
      throw new Error(`No capability family title for ${row.skillId} (${row.family}).`);
    }
    return {
      id: row.skillId,
      name: projectedSkillName(row.skillId),
      family: row.family,
      description: row.description,
      useWhen: row.triggerPolicy.include,
      notFor: row.triggerPolicy.exclude,
      deferTo: row.triggerPolicy.deferTo,
    };
  }),
  agents: roleRows.map(({ id }) => ({ id, description: roleDescriptions.get(id) })),
}));

add('packages/cli/lib/host-packages/adapter-registry.json', json({
  kind: 'host-native-adapter-registry',
  schemaVersion: '1.0.0',
  protocolVersion: '1.8.0',
  pipelineVersion: JSON.parse(read('packages/pipeline/package.json')).version,
  pluginVersion,
  adapters: [
    {
      id: 'claude-code',
      version: pluginVersion,
      capabilityLevel: 'product',
      installScopes: ['user', 'project'],
      capabilities: { interactiveQuestions: 'native' },
    },
    {
      id: 'codex',
      version: pluginVersion,
      capabilityLevel: 'product',
      installScopes: ['user', 'project'],
      capabilities: { interactiveQuestions: 'native' },
    },
    {
      id: 'cursor',
      version: pluginVersion,
      capabilityLevel: 'workflow',
      installScopes: ['project'],
      capabilities: { interactiveQuestions: 'chat' },
    },
  ],
}));
add('dist/plugins/openai/.claude-plugin/marketplace.json', json({
  name: 'openplanr-local',
  owner: { name: 'AsemDevs' },
  metadata: { version: pluginVersion, description: 'Generated local OpenPlanr package.' },
  plugins: [{
    name: HOST_PLUGIN_NAME,
    source: './openplanr',
    version: pluginVersion,
    description: 'Host-native OpenPlanr skills for OpenAI coding agents.',
    strict: true,
  }],
}));
add('dist/plugins/claude/.claude-plugin/marketplace.json', json({
  '$schema': 'https://json.schemastore.org/claude-code-marketplace.json',
  name: 'openplanr-local',
  owner: { name: 'AsemDevs' },
  metadata: { version: pluginVersion, description: 'Generated local OpenPlanr package.' },
  plugins: [{
    name: HOST_PLUGIN_NAME,
    source: './openplanr',
    version: pluginVersion,
    description: 'Host-native OpenPlanr skills and role agents for Claude Code.',
    strict: true,
  }],
}));

for (const [path, bytes] of [...outputs.entries()]) {
  if (!path.startsWith('dist/plugins/')) continue;
  add(`packages/cli/lib/host-packages/${path.slice('dist/plugins/'.length)}`, bytes, {
    isExecutable: executable.has(path),
  });
}

const membership = {
  kind: 'canonical-skill-membership',
  schemaVersion: '1.0.0',
  protocolVersion: '1.8.0',
  skillIds,
};
add('packages/skill-runtime/contributions/canonical-skills.json', json(membership), { checkedIn: true });

for (const contribution of [...new Set(skillRows.map(({ contribution }) => contribution))].sort()) {
  add(`packages/skill-runtime/contributions/${contribution}.json`, json({
    kind: 'openplanr-skill-contribution',
    schemaVersion: '1.0.0',
    protocolVersion: '1.8.0',
    id: contribution,
    skills: skillRows
      .filter((row) => row.contribution === contribution)
      .map(({ id, source, authorityClass, utilityRequirements }) => ({
        id,
        source,
        authorityClass,
        utilityRequirements,
      })),
  }), { checkedIn: true });
}

const canonicalManifest = {
  kind: 'canonical-skill-assets',
  schemaVersion: '2.0.0',
  protocolVersion: '1.8.0',
  sourceFormat: 'package-v1',
  skillIds,
  aliases: [],
  skills: skillRows,
};
canonicalManifest.membershipDigest = sha256Bytes(json(skillIds));
add('adapters/manifests/canonical-skills.json', json(canonicalManifest), { checkedIn: true });
add('adapters/manifests/role-assets.json', json({
  kind: 'role-adapter-assets',
  schemaVersion: '2.0.0',
  protocolVersion: '1.8.0',
  roleIds: roleRows.map(({ id }) => id),
  aliases: [],
  roles: roleRows,
}), { checkedIn: true });

const generatedAssets = [...outputs.entries()].map(([path, bytes]) => ({
  path,
  digest: sha256Bytes(bytes),
  generated: !tracked.has(path),
})).sort((left, right) => left.path.localeCompare(right.path));
add('adapters/manifests/generated-assets.json', json({
  kind: 'adapter-generated-assets',
  schemaVersion: '2.0.0',
  protocolVersion: '1.8.0',
  generator: 'scripts/skills/generate-v18.mjs',
  assets: generatedAssets,
}), { checkedIn: true });

const openAiAssets = [...outputs.entries()]
  .filter(([path]) => path.startsWith('dist/plugins/openai/openplanr/skills/'))
  .map(([path, bytes]) => ({ path: path.slice('dist/plugins/openai/openplanr/'.length), digest: sha256Bytes(bytes) }));
add('adapters/manifests/codex-plugin-content.json', json({
  kind: 'codex-plugin-skill-content',
  schemaVersion: '2.0.0',
  protocolVersion: '1.8.0',
  plugin: HOST_PLUGIN_NAME,
  version: pluginVersion,
  skillRoot: './skills/',
  canonicalSkillCount: skillRows.length,
  compatibilityAliasCount: 0,
  skillCount: skillRows.length,
  assetCount: openAiAssets.length,
  skills: skillRows.map(({ id, description }) => ({
    skillId: id,
    projectedName: projectedSkillName(id),
    invocation: namespacedInvocation(id, 'codex'),
    description,
    entrypoint: `skills/${projectedSkillName(id)}/SKILL.md`,
    assets: openAiAssets.filter(({ path }) => path.startsWith(`skills/${projectedSkillName(id)}/`)),
  })),
}), { checkedIn: true });

function write(path, bytes) {
  const destination = resolve(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes, { mode: executable.has(path) ? 0o755 : 0o644 });
  if (executable.has(path)) chmodSync(destination, 0o755);
}

function actualFiles(generatedRoot) {
  return listRegularFiles(resolve(root, generatedRoot), { relativeTo: root });
}

if (mode === 'write') {
  for (const generatedRoot of generatedRoots) {
    const path = resolve(root, generatedRoot);
    if (existsSync(path)) rmSync(path, { recursive: true });
  }
  for (const [path, bytes] of [...outputs.entries()].sort(([left], [right]) => left.localeCompare(right))) write(path, bytes);
  process.stdout.write(`Generated ${skillRows.length} standard skills and ${roleRows.length} Claude agents.\n`);
} else {
  const drift = [];
  const expectedPaths = [...outputs.keys()].sort();
  for (const path of expectedPaths) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) drift.push({ path, reason: 'missing' });
    else if (lstatSync(absolute).isSymbolicLink()) drift.push({ path, reason: 'symlink' });
    else if (!readFileSync(absolute).equals(outputs.get(path))) drift.push({ path, reason: 'content' });
    else if (executable.has(path) !== ((lstatSync(absolute).mode & 0o111) !== 0)) drift.push({ path, reason: 'mode' });
  }
  const expectedGenerated = expectedPaths.filter((path) => generatedRoots.some((rootPath) => path.startsWith(`${rootPath}/`)));
  const actualGenerated = generatedRoots.flatMap(actualFiles).sort();
  for (const path of actualGenerated.filter((path) => !expectedGenerated.includes(path))) drift.push({ path, reason: 'extra' });
  if (drift.length > 0) throw new Error(`Generated skill assets drifted:\n${json(drift)}`);
  process.stdout.write(`Checked ${skillRows.length} standard skills and ${roleRows.length} Claude agents.\n`);
}
