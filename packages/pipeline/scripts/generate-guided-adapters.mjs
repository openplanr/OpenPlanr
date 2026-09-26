#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileOperateContractRegistry } from '../lib/operate/contracts/compiler.mjs';
import {
  operateAdapterAssetPaths,
  renderClaudeCodeReadme,
  renderCodexProjectGuidance,
  renderCursorProjectGuidance,
} from '../lib/operate/contracts/operate-adapter-skills.mjs';
import {
  BUSINESS_EXECUTIVE_SKILL_BINDINGS,
  renderOperateMandateAppendixModule,
} from '../lib/operate/contracts/role-skills.mjs';
import { assertProtocolArtifact } from '../lib/protocol/contracts.mjs';
import { sha256Jcs } from '../lib/protocol/jcs.mjs';
import { resolveGuidedInteraction } from '../lib/pipeline/guided-interaction.mjs';
import {
  PROFESSIONAL_SKILLS_MANIFEST_PATH,
  buildProfessionalSkillsManifest,
  readProfessionalSkillsCatalog,
} from '../lib/pipeline/professional-skills.mjs';
import {
  LANDING_WORKFLOW_ASSET_PATHS,
  LANDING_WORKFLOW_CATALOG_PATH,
  LANDING_WORKFLOW_MANIFEST_PATH,
  assertLandingWorkflowCatalog,
} from '../lib/pipeline/landing.mjs';

const REGISTRY_PATH = 'registry/operate-v2-contracts.json';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const RUNTIME_ASSETS = Object.freeze(['adapters/cursor/rules/openplanr.mdc']);

const OPERATE_RUNTIME_CLIENTS = Object.freeze([
  Object.freeze({
    id: 'claude-code',
    entrypoint: '/planr-pipeline:planr-operate',
    asset: 'skills/planr-operate/SKILL.md',
    guidance: 'adapters/claude-code/README.md',
    registryAsset: 'operate-skill',
  }),
  Object.freeze({
    id: 'codex',
    entrypoint: '$planr-operate',
    asset: 'adapters/codex/skills/planr-operate/SKILL.md',
    guidance: 'adapters/codex/project-guidance.md',
    registryAsset: 'operate-skill',
  }),
  Object.freeze({
    id: 'cursor',
    entrypoint: 'operate with planr',
    asset: 'adapters/cursor/rules/openplanr-operate.mdc',
    guidance: 'adapters/cursor/rules/openplanr.mdc',
    registryAsset: 'operate-rule',
  }),
]);

const GENERATED_MANIFEST = 'conformance/fixtures/guided-runtime-parity/generated-assets.json';
const GENERATED_OPERATE_MANIFEST =
  'conformance/fixtures/operate-adapter-parity/generated-assets.json';
const GENERATED_LANDING_MANIFEST = LANDING_WORKFLOW_MANIFEST_PATH;
const GENERATED_DOC = 'docs/runtime-guided-interactions.md';
const GENERATED_ADAPTER_DOC = 'docs/generated/adapters.md';
const GENERATED_SKILL_CUSTODY_MANIFEST = 'registry/generated-skill-assets.json';
const SKILL_REGISTRY_PATH = 'registry/v1.5.0/skills.json';
const PACKAGE_SKILL_HOSTS = Object.freeze(['pipeline', 'codex', 'cursor']);

export class GuidedAdapterGenerationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GuidedAdapterGenerationError';
    this.code = code;
    this.details = details;
  }
}

function readJson(projectRoot, path) {
  return JSON.parse(readFileSync(resolve(projectRoot, path), 'utf8'));
}

function canonicalText(bytes) {
  return bytes.replace(/\r\n/gu, '\n');
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(canonicalText(bytes), 'utf8').digest('hex')}`;
}

function expectedPackageSkillPath(skillId, host) {
  if (host === 'pipeline') return `skills/${skillId}/SKILL.md`;
  if (host === 'codex') return `adapters/codex/skills/${skillId}/SKILL.md`;
  return `adapters/cursor/rules/openplanr-${skillId.slice('planr-'.length)}.mdc`;
}

function assertSafePackageSkillPath(path, { skillId, host }) {
  if (typeof path !== 'string' || path.includes('\\') || path.startsWith('/')) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      `Generated skill custody contains an unsafe path for ${skillId}.`,
      { skillId, host, path },
    );
  }
  const segments = path.split('/');
  if (segments.includes('') || segments.includes('.') || segments.includes('..')) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      `Generated skill custody contains an unsafe path for ${skillId}.`,
      { skillId, host, path },
    );
  }
  const rootPath =
    host === 'pipeline'
      ? `skills/${skillId}`
      : host === 'codex'
        ? `adapters/codex/skills/${skillId}`
        : 'adapters/cursor/rules';
  if (path !== rootPath && !path.startsWith(`${rootPath}/`)) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      `Generated ${host} skill asset ${path} is outside its package custody root.`,
      { skillId, host, path, rootPath },
    );
  }
  return path;
}

/**
 * Read-only handoff from the workspace skill generator. The root generator is
 * the sole writer of these prompt assets; this package generator verifies their
 * custody before referencing them from install and compatibility manifests.
 */
export function readGeneratedSkillCustody({ projectRoot = root } = {}) {
  const manifestPath = resolve(projectRoot, GENERATED_SKILL_CUSTODY_MANIFEST);
  if (!existsSync(manifestPath) || lstatSync(manifestPath).isSymbolicLink()) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      `${GENERATED_SKILL_CUSTODY_MANIFEST} must be generated before guided adapters.`,
      { manifest: GENERATED_SKILL_CUSTODY_MANIFEST },
    );
  }
  const manifest = readJson(projectRoot, GENERATED_SKILL_CUSTODY_MANIFEST);
  const skillRegistry = readJson(projectRoot, SKILL_REGISTRY_PATH);
  if (
    skillRegistry.kind !== 'skill-catalog' ||
    skillRegistry.protocolVersion !== '1.5.0' ||
    !Array.isArray(skillRegistry.skills)
  ) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      `${SKILL_REGISTRY_PATH} must expose the projected Protocol skill catalog.`,
    );
  }
  const registryById = new Map(skillRegistry.skills.map((skill) => [skill.skillId, skill]));
  const registrySkillIds = [...registryById.keys()];
  const skillIds = manifest.skillIds;
  if (
    manifest.kind !== 'openplanr-package-skill-assets' ||
    manifest.schemaVersion !== '1.0.0' ||
    manifest.protocolVersion !== '1.5.0' ||
    manifest.generator !== 'scripts/skills/generate.mjs' ||
    !Array.isArray(skillIds) ||
    new Set(skillIds).size !== skillIds.length ||
    skillIds.some((id) => typeof id !== 'string' || !/^planr-[a-z][a-z0-9-]*$/u.test(id)) ||
    JSON.stringify(skillIds) !== JSON.stringify(registrySkillIds) ||
    JSON.stringify(skillIds) !== JSON.stringify([...skillIds].sort())
  ) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      'The generated package skill custody envelope is invalid or incomplete.',
      { skillIds },
    );
  }
  if (
    !Array.isArray(manifest.skills) ||
    manifest.skills.length !== skillIds.length ||
    !Array.isArray(manifest.assets)
  ) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      'The generated package skill custody inventory is incomplete.',
    );
  }

  const skillsById = new Map();
  for (const row of manifest.skills) {
    const registration = registryById.get(row?.id);
    const registeredCommands = registration?.cliRequirements?.map(({ argv }) => argv[0]);
    if (
      !row ||
      typeof row !== 'object' ||
      !skillIds.includes(row.id) ||
      skillsById.has(row.id) ||
      row.source !== registration?.source ||
      row.sourceDigest !== registration?.sourceDigest ||
      typeof row.sourceDigest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(row.sourceDigest) ||
      !Array.isArray(row.commands) ||
      row.commands.some((id) => typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(id)) ||
      new Set(row.commands).size !== row.commands.length ||
      JSON.stringify(row.commands) !== JSON.stringify(registeredCommands) ||
      !Array.isArray(row.assets)
    ) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        'A generated package skill custody row is invalid.',
        { row },
      );
    }
    const mainHosts = row.assets.map(({ host }) => host);
    if (JSON.stringify(mainHosts) !== JSON.stringify(PACKAGE_SKILL_HOSTS)) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        `Skill ${row.id} must expose one main asset for every package host.`,
        { skillId: row.id, hosts: mainHosts },
      );
    }
    for (const asset of row.assets) {
      const expectedPath = expectedPackageSkillPath(row.id, asset.host);
      if (
        asset.path !== expectedPath ||
        typeof asset.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/u.test(asset.digest) ||
        !Array.isArray(asset.supportAssets ?? [])
      ) {
        throw new GuidedAdapterGenerationError(
          'E_GUIDED_ADAPTER_SKILL_CUSTODY',
          `Skill ${row.id} has an invalid ${asset.host} main asset.`,
          { skillId: row.id, asset, expectedPath },
        );
      }
    }
    skillsById.set(row.id, row);
  }
  if (JSON.stringify([...skillsById.keys()]) !== JSON.stringify(skillIds)) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_CUSTODY',
      'Generated package skill rows do not match canonical membership order.',
    );
  }

  const assetBytesByPath = {};
  const assetsBySkillAndHost = new Map();
  for (const asset of manifest.assets) {
    if (
      !asset ||
      typeof asset !== 'object' ||
      !skillsById.has(asset.skillId) ||
      !PACKAGE_SKILL_HOSTS.includes(asset.host) ||
      typeof asset.digest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/u.test(asset.digest)
    ) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        'A generated package skill asset row is invalid.',
        { asset },
      );
    }
    const path = assertSafePackageSkillPath(asset.path, asset);
    if (Object.hasOwn(assetBytesByPath, path)) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        `Generated package skill asset ${path} has duplicate custody.`,
        { path },
      );
    }
    const absolute = resolve(projectRoot, path);
    if (
      !existsSync(absolute) ||
      lstatSync(absolute).isSymbolicLink() ||
      !lstatSync(absolute).isFile()
    ) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        `Generated package skill asset ${path} is missing or not a regular file.`,
        { path },
      );
    }
    const bytes = canonicalText(readFileSync(absolute, 'utf8'));
    const actualDigest = digest(bytes);
    if (actualDigest !== asset.digest) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        `Generated package skill asset ${path} differs from root custody.`,
        { path, expected: asset.digest, actual: actualDigest },
      );
    }
    assetBytesByPath[path] = bytes;
    const key = `${asset.skillId}:${asset.host}`;
    const paths = assetsBySkillAndHost.get(key) ?? [];
    paths.push(path);
    assetsBySkillAndHost.set(key, paths);
  }

  for (const skillId of skillIds) {
    const row = skillsById.get(skillId);
    for (const main of row.assets) {
      const key = `${skillId}:${main.host}`;
      const paths = assetsBySkillAndHost.get(key) ?? [];
      const declared = [main.path, ...(main.supportAssets ?? []).map(({ path }) => path)].sort();
      if (
        JSON.stringify([...paths].sort()) !== JSON.stringify(declared) ||
        digest(assetBytesByPath[main.path] ?? '') !== main.digest
      ) {
        throw new GuidedAdapterGenerationError(
          'E_GUIDED_ADAPTER_SKILL_CUSTODY',
          `Skill ${skillId} ${main.host} assets do not match root custody.`,
          { skillId, host: main.host, declared, assets: paths },
        );
      }
    }
  }
  return Object.freeze({
    manifest,
    skillRegistry,
    assetBytesByPath: Object.freeze(assetBytesByPath),
  });
}

function runtimeReport(mode) {
  return {
    nativeQuestions: mode === 'native',
    structuredChat: mode === 'native' || mode === 'chat',
    attachedTerminal: mode !== 'none',
  };
}

function renderDocs(registry) {
  const rows = registry.adapters.map((adapter) => {
    const resolved = resolveGuidedInteraction({
      registry,
      runtime: adapter.id,
      runtimeReport: runtimeReport(adapter.capabilities.interactiveQuestions),
    });
    return `| ${adapter.id} | ${adapter.capabilities.interactiveQuestions} | ${resolved.attempted.join(' → ')} | ${adapter.capabilities.toolIsolation} |`;
  });
  return `<!-- Generated by scripts/generate-guided-adapters.mjs. Do not edit. -->
# Runtime-guided interactions

OpenPlanr skills provide portable context and workflow guidance. The active coding
agent owns reasoning and conversation, using its native structured question UI
when a consequential decision needs user input and a concise chat question when
that UI is unavailable. Spec, Plan, Plan Review, and ordinary Ship do not require
a Planr lifecycle command before the agent can do the requested local work.

## Certified presentation paths

| Runtime | Declared ceiling | Deterministic fallback | Tool isolation |
|---|---|---|---|
${rows.join('\n')}

The declared mode is a capability ceiling, not proof that a tool exists in the
active session. Native presentation is selected only after a positive runtime
capability report. Otherwise the portable helper downgrades in the order shown
and emits a named diagnostic. \`none\` is a fail-closed handoff.

## Guided CLI actions

Some public CLI commands still return guided JSON for setup or other bounded
actions. For those commands only:

1. Validate each returned questionnaire and structured action.
2. Present the questionnaire through the resolved interaction mode.
3. Assemble typed answers from the questionnaire's self-describing
   \`submission\` contract and send one bounded JSON envelope on stdin.
4. Render the CLI preview without applying it.

The CLI owns validation and application of its preview. Adapters never launch
another coding runtime or invoke the nested pipeline executable.

## Parity guarantee

Transport metadata and submission time do not affect the reduced answer view.
Equal typed answers bound to the same questionnaire and project/config heads
therefore produce byte-equivalent preview data across native, chat, and terminal
presentation.

## Operate dispatch

The parent \`planr-operate\` skill scopes one business review cycle, writes a
single shared cycle brief, and dispatches the seven lens review skills: the
five advisors in parallel, then the challenger, then the chair. Each lens writes
its own file and returns a short status summary. A lens that does not report is
recorded absent and is never synthesised.
`;
}

function renderAdapterDocs(registry) {
  const rows = registry.adapters.map((adapter) => {
    const operate = OPERATE_RUNTIME_CLIENTS.find(({ id }) => id === adapter.id);
    if (!operate) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_OPERATE_MAPPING',
        `Adapter ${adapter.id} has no fixed Operate client mapping.`,
      );
    }
    if (typeof adapter.entrypoints.land !== 'string' || adapter.entrypoints.land.length === 0) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_LANDING_MAPPING',
        `Adapter ${adapter.id} has no landing entrypoint.`,
      );
    }
    return `| ${adapter.id} | ${adapter.version} | ${adapter.capabilityLevel} | ${adapter.entrypoints.plan} | ${adapter.entrypoints.artifact} | ${operate.entrypoint} | ${adapter.entrypoints.land} | ${adapter.capabilities.interactiveQuestions} | ${adapter.capabilities.toolIsolation} |`;
  });
  return `<!-- Generated by scripts/generate-guided-adapters.mjs. Do not edit. -->
# Runtime adapters

| Runtime | Version | Level | Plan entrypoint | Artifact entrypoint | Operate entrypoint | Land entrypoint | Guided interaction ceiling | Tool isolation |
|---|---:|---|---|---|---|---|---|---|
${rows.join('\n')}
`;
}

function renderLandingManifest(projectRoot, registry, assetBytesByPath, labels) {
  const expectedEntrypoints = new Map([
    ['claude-code', '/planr-pipeline:planr-land'],
    ['codex', '$planr-land'],
    ['cursor', 'land with planr'],
  ]);
  for (const adapter of registry.adapters) {
    if (adapter.entrypoints.land !== expectedEntrypoints.get(adapter.id)) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_LANDING_MAPPING',
        `Adapter ${adapter.id} has a non-canonical landing entrypoint.`,
      );
    }
  }
  assertLandingWorkflowCatalog(readJson(projectRoot, LANDING_WORKFLOW_CATALOG_PATH));
  const assets = LANDING_WORKFLOW_ASSET_PATHS.map((path) => {
    const bytes = canonicalText(
      assetBytesByPath[path] ?? readFileSync(resolve(projectRoot, path), 'utf8'),
    );
    assertPortableAsset(path, bytes, labels);
    return { path, digest: digest(bytes) };
  });
  const catalogBytes = canonicalText(
    readFileSync(resolve(projectRoot, LANDING_WORKFLOW_CATALOG_PATH), 'utf8'),
  );
  return `${JSON.stringify(
    {
      kind: 'landing-workflow-assets',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      generator: 'scripts/generate-guided-adapters.mjs',
      workflowCatalogDigest: digest(catalogBytes),
      assets,
    },
    null,
    2,
  )}\n`;
}

function copiedQuestionLabels(projectRoot) {
  const questionnaire = readJson(
    projectRoot,
    'conformance/fixtures/guided-runtime-parity/questionnaire.json',
  );
  return questionnaire.questions.map(({ label }) => label);
}

function assertPortableAsset(path, bytes, labels) {
  const failures = [];
  for (const label of labels) {
    if (bytes.includes(label)) failures.push(`copied CLI question: ${label}`);
  }
  if (/^\s*(?:[$>]\s*)?planr-pipeline(?:\s|$)/mu.test(bytes)) {
    failures.push('invokes the nested planr-pipeline executable');
  }
  if (/^\s*(?:[$>]\s*)?(?:claude|codex|cursor)\s+(?:run|exec|--)/mu.test(bytes)) {
    failures.push('launches a nested coding runtime');
  }
  if (/(?:sonnet|opus)/iu.test(bytes)) failures.push('contains a vendor model name');
  if (/^\s*(?:[$>]\s*)?planr\s+[^\n]*--yes(?:\s|$)/mu.test(bytes)) {
    failures.push('adds implicit --yes to an executable command');
  }
  if (path.includes('/codex/') && /\$\{?CLAUDE_PLUGIN_ROOT\}?|~\/\.claude\//u.test(bytes)) {
    failures.push('contains a Claude-only path');
  }
  if (path.includes('/cursor/') && /\$\{?CLAUDE_PLUGIN_ROOT\}?|~\/\.codex\//u.test(bytes)) {
    failures.push('contains a foreign runtime path');
  }
  if (path.startsWith('skills/') && /~\/\.codex\/|~\/\.cursor\//u.test(bytes)) {
    failures.push('contains a foreign runtime path');
  }
  if (failures.length) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_STATIC_SCAN',
      `${path} failed portable adapter checks: ${failures.join('; ')}.`,
      { path, failures },
    );
  }
}

function renderManifest(projectRoot, assetBytesByPath = {}) {
  const labels = copiedQuestionLabels(projectRoot);
  const assets = RUNTIME_ASSETS.map((path) => {
    const bytes = canonicalText(
      assetBytesByPath[path] ?? readFileSync(resolve(projectRoot, path), 'utf8'),
    );
    assertPortableAsset(path, bytes, labels);
    return { path, digest: digest(bytes) };
  });
  return `${JSON.stringify(
    {
      kind: 'guided-runtime-assets',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      generator: 'scripts/generate-guided-adapters.mjs',
      assets,
    },
    null,
    2,
  )}\n`;
}

function canonicalCliRequirements(skillRegistry) {
  const requirements = new Map();
  for (const skill of skillRegistry.skills) {
    for (const requirement of skill.cliRequirements) {
      const row = {
        id: requirement.commandId,
        argv: requirement.argv,
        requiredOptions: requirement.requiredOptions,
      };
      const previous = requirements.get(row.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) {
        throw new GuidedAdapterGenerationError(
          'E_GUIDED_ADAPTER_SKILL_REQUIREMENT',
          `Protocol command ${row.id} has conflicting skill requirements.`,
          { previous, row },
        );
      }
      requirements.set(row.id, row);
    }
  }
  return [...requirements.values()];
}

function renderCodexSkillDistribution(skillCustody) {
  const registryById = new Map(
    skillCustody.skillRegistry.skills.map((skill) => [skill.skillId, skill]),
  );
  const skillIds = [...skillCustody.manifest.skillIds];
  const definitions = skillIds.map((skillId) => {
    const registration = registryById.get(skillId);
    const requirementIds = registration?.cliRequirements?.map(({ commandId }) => commandId);
    if (!Array.isArray(requirementIds)) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_REQUIREMENT',
        `Skill ${skillId} has invalid CLI requirements for its interaction model.`,
        { skillId, requirementIds },
      );
    }
    return {
      skillId,
      targetName: skillId,
      rootPath: `adapters/codex/skills/${skillId}`,
      classification: 'public-skill',
      requirementIds: [...requirementIds],
    };
  });
  if (new Set(definitions.map(({ skillId }) => skillId)).size !== definitions.length) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_SKILL_MEMBERSHIP',
      'The Codex distribution contains duplicate manifest members.',
    );
  }
  const assets = [];
  const skills = definitions.map((definition) => {
    const assetPaths = skillCustody.manifest.assets
      .filter(({ skillId, host }) => skillId === definition.skillId && host === 'codex')
      .map(({ path }) => path)
      .sort((left, right) => left.localeCompare(right));
    if (assetPaths.length === 0 || !assetPaths.includes(`${definition.rootPath}/SKILL.md`)) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_SKILL_CUSTODY',
        `Skill ${definition.skillId} has no complete Codex asset tree in root custody.`,
        { skillId: definition.skillId, assetPaths },
      );
    }
    for (const path of assetPaths) {
      const bytes = skillCustody.assetBytesByPath[path];
      assets.push({
        skillId: definition.skillId,
        path,
        digest: digest(bytes),
        classification: 'public-skill',
      });
    }
    return { ...definition, assetPaths };
  });
  const custody = { skills, assets };
  return {
    skillCount: skills.length,
    assetCount: assets.length,
    bundleDigest: sha256Jcs(custody),
    skills,
    assets,
  };
}

function renderOperateManifest(registry, assetBytesByPath, labels, skillCustody) {
  const adapters = OPERATE_RUNTIME_CLIENTS.map((client) => {
    const adapter = registry.adapters.find(({ id }) => id === client.id);
    if (
      !adapter ||
      !adapter.assets.includes(client.registryAsset) ||
      !adapter.healthChecks.includes('operate-machine-json')
    ) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_OPERATE_REGISTRATION',
        `Adapter ${client.id} does not declare its Operate asset and machine-JSON health check.`,
        { runtime: client.id },
      );
    }
    const assets = operateAdapterAssetPaths(client.id).map((path) => {
      const source = assetBytesByPath[path];
      if (typeof source !== 'string') {
        throw new GuidedAdapterGenerationError(
          'E_GUIDED_ADAPTER_OPERATE_MAPPING',
          `Missing generated Operate asset ${path} for ${client.id}.`,
          { runtime: client.id, path },
        );
      }
      const bytes = canonicalText(source);
      assertPortableAsset(path, bytes, labels);
      return { path, digest: digest(bytes), classification: 'public-adapter' };
    });
    return {
      runtime: client.id,
      entrypoint: client.entrypoint,
      dispatchMode: 'lens-skills-write-files',
      assets,
    };
  });
  return `${JSON.stringify(
    {
      kind: 'operate-adapter-assets',
      schemaVersion: '1.0.0',
      protocolVersion: '2.0.0',
      generator: 'scripts/generate-guided-adapters.mjs',
      skillDistribution: renderCodexSkillDistribution(skillCustody),
      cliRequirements: {
        executable: 'planr',
        protocolVersion: '2.0.0',
        output: 'json',
        commands: canonicalCliRequirements(skillCustody.skillRegistry),
      },
      capabilityPolicy: {
        evidencePreparation: 'automatic-adapter-screened-on-start',
        executiveEvidenceAccess: 'screened-artifacts-only',
        grantedCapabilities: ['artifact.read', 'artifact.submit'],
        repositoryRead: 'not-granted',
        privateRuntimeStorage: 'not-readable',
        supportedOperatingDomains: ['business'],
        deferredOperatingDomains: ['software'],
      },
      adapters,
    },
    null,
    2,
  )}\n`;
}

export function renderGuidedAdapterAssets({ projectRoot = root } = {}) {
  const registry = readJson(projectRoot, 'registry/adapters.json');
  assertProtocolArtifact('adapter-registry', registry);
  const operateRegistry = readJson(projectRoot, REGISTRY_PATH);
  const catalog = compileOperateContractRegistry(operateRegistry);
  const labels = copiedQuestionLabels(projectRoot);
  const skillCustody = readGeneratedSkillCustody({ projectRoot });
  const professionalCatalog = readProfessionalSkillsCatalog({ projectRoot });
  const professionalManifest = buildProfessionalSkillsManifest(
    professionalCatalog,
    skillCustody.assetBytesByPath,
    {
      activeRegistrationsBySkill: new Map(
        professionalCatalog.skills.map(({ skillId }) => [
          skillId,
          skillCustody.skillRegistry.skills.find((skill) => skill.skillId === skillId),
        ]),
      ),
    },
  );
  const generatedAssets = {
    'adapters/claude-code/README.md': renderClaudeCodeReadme(skillCustody.manifest.skillIds),
    'adapters/codex/project-guidance.md': renderCodexProjectGuidance(
      skillCustody.manifest.skillIds,
    ),
    'adapters/cursor/rules/openplanr.mdc': renderCursorProjectGuidance(),
    'lib/operate/contracts/mandate-appendix-v2.mjs': renderOperateMandateAppendixModule(catalog),
    [PROFESSIONAL_SKILLS_MANIFEST_PATH]: `${JSON.stringify(professionalManifest, null, 2)}\n`,
  };
  const manifestAssets = { ...skillCustody.assetBytesByPath, ...generatedAssets };
  return {
    [GENERATED_DOC]: renderDocs(registry),
    [GENERATED_ADAPTER_DOC]: renderAdapterDocs(registry),
    [GENERATED_MANIFEST]: renderManifest(projectRoot, generatedAssets),
    [GENERATED_OPERATE_MANIFEST]: renderOperateManifest(
      registry,
      manifestAssets,
      labels,
      skillCustody,
    ),
    [GENERATED_LANDING_MANIFEST]: renderLandingManifest(
      projectRoot,
      registry,
      manifestAssets,
      labels,
    ),
    ...generatedAssets,
  };
}

function staleTargets(projectRoot, assets) {
  return Object.entries(assets)
    .filter(([target, expected]) => {
      const path = resolve(projectRoot, target);
      return (
        !existsSync(path) || canonicalText(readFileSync(path, 'utf8')) !== canonicalText(expected)
      );
    })
    .map(([target]) => target)
    .sort();
}

function parseArgs(argv) {
  const unsupported = argv.filter((arg) => arg !== '--check');
  if (unsupported.length) {
    throw new GuidedAdapterGenerationError(
      'E_GUIDED_ADAPTER_ARGUMENT',
      `Unsupported argument${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`,
    );
  }
  return { check: argv.includes('--check') };
}

export function runGuidedAdapterGenerator({
  argv = process.argv.slice(2),
  projectRoot = root,
} = {}) {
  const { check } = parseArgs(argv);
  const assets = renderGuidedAdapterAssets({ projectRoot });
  const stale = staleTargets(projectRoot, assets);
  if (check) {
    if (stale.length) {
      throw new GuidedAdapterGenerationError(
        'E_GUIDED_ADAPTER_DRIFT',
        `Generated guided adapter assets are stale:\n${stale.map((target) => `  - ${target}`).join('\n')}\nRun: npm run generate:guided-adapters`,
        { staleTargets: stale },
      );
    }
    return { ok: true, mode: 'check', staleTargets: [] };
  }
  const written = [];
  for (const [target, bytes] of Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))) {
    const path = resolve(projectRoot, target);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path) || readFileSync(path, 'utf8') !== bytes) {
      writeFileSync(path, bytes, 'utf8');
      written.push(relative(projectRoot, path).split(sep).join('/'));
    }
  }
  return { ok: true, mode: 'write', written };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = runGuidedAdapterGenerator();
    process.stdout.write(
      result.mode === 'check'
        ? 'Guided runtime adapter assets are current.\n'
        : `Generated ${result.written.length} guided adapter asset${result.written.length === 1 ? '' : 's'}.\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.code ?? 'E_GUIDED_ADAPTER_GENERATION'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
