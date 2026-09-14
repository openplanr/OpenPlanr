import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { withDocumentDigest } from '@openplanr/protocol/canonical-json';
import { validateProtocolArtifact } from '@openplanr/protocol/contracts';

import { sha256 } from '../compiler/render-primitives.mjs';
import { SkillAuthoringError } from './diagnostics.mjs';

const envelopeFor = (protocolVersion) => Object.freeze({
  schemaVersion: '1.0.0',
  protocolVersion,
  documentVersion: '1.0.0',
  digestAlgorithm: 'sha256',
  canonicalization: 'rfc8785',
});

const SKILL_SOURCE_KINDS = Object.freeze([
  ['skill.json', 'skill-source'],
  ['modules.json', 'skill-module-registry'],
  ['host-profiles.json', 'skill-host-profile-registry'],
]);

const CURSOR_TEMPLATE = readFileSync(
  new URL('../../templates/cursor-rule.md', import.meta.url),
  'utf8',
);

function isOutside(root, candidate) {
  const within = relative(root, candidate);
  return isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`);
}

function readSkillFile(skillDir, relativePath) {
  if (
    typeof relativePath !== 'string'
    || relativePath.length === 0
    || relativePath.includes('\0')
    || relativePath.includes('\\')
    || isAbsolute(relativePath)
    || /^[A-Za-z]:/u.test(relativePath)
    || relativePath.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new SkillAuthoringError('E_SKILL_SOURCE_PATH_INVALID', `Skill source path ${String(relativePath)} must be a non-empty repository-relative path.`, { path: relativePath });
  }
  const segments = relativePath.split('/');
  const absolute = resolve(skillDir, ...segments);
  if (isOutside(skillDir, absolute)) {
    throw new SkillAuthoringError('E_SKILL_SOURCE_PATH_ESCAPE', `Skill source path ${relativePath} escapes the skill directory.`, { path: relativePath });
  }
  if (!existsSync(absolute)) {
    throw new SkillAuthoringError('E_SKILL_SOURCE_FILE_MISSING', `Referenced source file ${relativePath} does not exist.`, { path: relativePath, repair: `Create ${relativePath} or correct the reference in the skill graph.` });
  }
  let cursor = skillDir;
  let finalStat;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) {
      throw new SkillAuthoringError('E_SKILL_SOURCE_SYMLINK', `Skill source path ${relativePath} may not pass through a symlink.`, { path: relativePath, segment });
    }
    finalStat = stat;
  }
  if (!finalStat.isFile()) {
    throw new SkillAuthoringError('E_SKILL_SOURCE_PATH_INVALID', `Skill source path ${relativePath} must resolve to a regular file.`, { path: relativePath });
  }
  const real = realpathSync(absolute);
  if (isOutside(skillDir, real)) {
    throw new SkillAuthoringError('E_SKILL_SOURCE_PATH_ESCAPE', `Skill source path ${relativePath} resolves outside the skill directory.`, { path: relativePath });
  }
  // Raw bytes: custody digests hash exactly what is on disk. Canonicalization to
  // LF happens later, explicitly, at the compiler's render sites.
  let descriptor;
  try {
    descriptor = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStat = fstatSync(descriptor);
    if (openedStat.dev !== finalStat.dev || openedStat.ino !== finalStat.ino) {
      throw new SkillAuthoringError('E_SKILL_SOURCE_CHANGED', `Source file ${relativePath} changed while it was being opened.`, { path: relativePath });
    }
    return readFileSync(descriptor, 'utf8');
  } catch (error) {
    if (error instanceof SkillAuthoringError) throw error;
    throw new SkillAuthoringError('E_SKILL_SOURCE_FILE_READ', `Unable to read source file ${relativePath}: ${error.message}`, { path: relativePath });
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readSkillJson(skillDir, name) {
  try {
    const bytes = readSkillFile(skillDir, name);
    return Object.freeze({ bytes, document: JSON.parse(bytes) });
  } catch (error) {
    if (error?.code === 'E_SKILL_SOURCE_FILE_MISSING') {
      throw new SkillAuthoringError('E_SKILL_DIR_INVALID', `${name} is required in ${skillDir}.`, { path: name, usage: true, repair: `Add ${name} to the composed-v1 skill directory.` });
    }
    if (error instanceof SkillAuthoringError && error.code !== 'E_SKILL_SOURCE_JSON_INVALID') throw error;
    throw new SkillAuthoringError('E_SKILL_SOURCE_JSON_INVALID', `${name} is not valid JSON: ${error.message}`, { path: name });
  }
}

function assertSchemaValid(kind, document, protocolVersion) {
  const errors = validateProtocolArtifact(kind, document, { protocolVersion });
  if (errors.length > 0) {
    const first = errors[0];
    const firstDetail = typeof first === 'string' ? first : first?.detail;
    throw new SkillAuthoringError('E_SKILL_SOURCE_SCHEMA_INVALID', `${kind} document does not satisfy the Protocol ${protocolVersion} contract${firstDetail ? `: ${firstDetail}` : '.'}`, {
      kind,
      pointer: typeof first === 'string' ? null : first?.path ?? null,
      errors: errors.map((issue) => (typeof issue === 'string' ? issue : `${issue.path}: ${issue.detail}`)),
      repair: `Correct ${kind} so it satisfies schemas/v${protocolVersion}/${kind}.schema.json.`,
    });
  }
}

/**
 * Load a composed-v1 skill from a directory and assemble the three schema-valid
 * versioned Protocol documents (skill-source, module registry, host-profile registry).
 *
 * Contributor files stay digest-free: every `source` and `moduleRef` digest is
 * computed here from the exact file bytes, so an author never hand-maintains a
 * hash and generated custody never carries a stale one.
 */
export function loadComposedSkill({ skillDir }) {
  const resolvedDir = resolve(skillDir);
  if (!existsSync(resolvedDir) || !lstatSync(resolvedDir).isDirectory()) {
    throw new SkillAuthoringError('E_SKILL_DIR_INVALID', `${skillDir} is not a skill directory.`, { path: skillDir, usage: true });
  }
  if (lstatSync(resolvedDir).isSymbolicLink()) {
    throw new SkillAuthoringError('E_SKILL_DIR_INVALID', `${skillDir} may not be a symbolic-link skill directory.`, { path: skillDir, usage: true });
  }
  const realSkillDir = realpathSync(resolvedDir);
  const skillsRoot = dirname(realSkillDir);

  const skillFile = readSkillJson(realSkillDir, 'skill.json');
  const moduleFile = readSkillJson(realSkillDir, 'modules.json');
  const profileFile = readSkillJson(realSkillDir, 'host-profiles.json');
  const skillDoc = skillFile.document;
  const moduleDoc = moduleFile.document;
  const profileDoc = profileFile.document;
  const protocolVersion = skillDoc.protocolVersion ?? '1.6.0';
  if (!['1.6.0', '1.7.0'].includes(protocolVersion)) {
    throw new SkillAuthoringError('E_SKILL_SOURCE_PROTOCOL_UNSUPPORTED', `Skill source protocol ${String(protocolVersion)} is unsupported.`, {
      path: 'skill.json',
      repair: 'Use protocolVersion 1.6.0 or 1.7.0.',
    });
  }
  const envelope = envelopeFor(protocolVersion);

  const localModules = Array.isArray(moduleDoc) ? moduleDoc : moduleDoc.modules ?? [];
  const imports = Array.isArray(moduleDoc) ? [] : moduleDoc.imports ?? [];
  const authoredProfiles = Array.isArray(profileDoc) ? profileDoc : profileDoc.profiles ?? [];

  const sharedModules = imports.length === 0
    ? []
    : readSkillJson(resolve(skillsRoot, 'shared'), 'modules.json').document.modules ?? [];
  const sharedIndex = new Map(sharedModules.map((module) => [
    `${module.moduleId}@${module.moduleVersion}`,
    { ...module, source: `shared/${module.source}` },
  ]));
  const importedModules = [];
  const selectedImports = new Set();
  const selectShared = ({ moduleId, moduleVersion }, edge = 'modules.json#imports') => {
    const key = `${moduleId}@${moduleVersion}`;
    if (selectedImports.has(key)) return;
    const module = sharedIndex.get(key);
    if (!module) {
      throw new SkillAuthoringError('E_SKILL_MODULE_UNDECLARED', `Shared module ${key} is imported but absent from skills/shared/modules.json.`, {
        pointer: edge,
        repair: `Declare ${key} in skills/shared/modules.json or remove the import.`,
      });
    }
    selectedImports.add(key);
    for (const dependency of [...(module.dependsOn ?? []), ...(module.references ?? [])]) {
      selectShared(dependency, `skills/shared/modules.json#/${key}`);
    }
    importedModules.push(module);
  };
  for (const imported of imports) selectShared(imported);
  const authoredModules = [...localModules, ...importedModules];

  const readSource = (relativePath) => (
    relativePath.startsWith('shared/')
      ? readSkillFile(skillsRoot, relativePath)
      : readSkillFile(realSkillDir, relativePath)
  );

  const sourceByModule = new Map(authoredModules.map((module) => [`${module.moduleId}@${module.moduleVersion}`, module.source]));
  const digestOf = (relativePath) => sha256(readSource(relativePath));
  const moduleRef = ({ moduleId, moduleVersion }) => {
    const sourcePath = sourceByModule.get(`${moduleId}@${moduleVersion}`);
    if (!sourcePath) {
      throw new SkillAuthoringError('E_SKILL_MODULE_UNDECLARED', `Module ${moduleId}@${moduleVersion} is referenced but absent from modules.json.`, {
        pointer: `modules.json#/${moduleId}@${moduleVersion}`,
        repair: `Declare ${moduleId}@${moduleVersion} in modules.json before referencing it.`,
      });
    }
    return { moduleId, moduleVersion, digest: digestOf(sourcePath) };
  };

  const modules = authoredModules.map((module) => ({
    moduleId: module.moduleId,
    moduleVersion: module.moduleVersion,
    moduleKind: module.moduleKind,
    description: module.description,
    authorityCeiling: module.authorityCeiling,
    source: { path: module.source, digest: digestOf(module.source) },
    appliesWhen: module.appliesWhen,
    dependsOn: (module.dependsOn ?? []).map(moduleRef),
    references: (module.references ?? []).map(moduleRef),
  }));

  const hostProfilesByKey = new Map();
  for (const profile of authoredProfiles) {
    const key = `${profile.hostProfileId}@${profile.hostProfileVersion}`;
    if (hostProfilesByKey.has(key)) {
      throw new SkillAuthoringError('E_SKILL_HOST_PROFILE_DUPLICATE', `Host profile ${key} is declared more than once in host-profiles.json.`, {
        path: 'host-profiles.json',
        pointer: `host-profiles.json#/${key}`,
        repair: `Keep one declaration for ${key}; distinct versions must use distinct exact keys.`,
      });
    }
    hostProfilesByKey.set(key, {
      hostProfileId: profile.hostProfileId,
      hostProfileVersion: profile.hostProfileVersion,
      host: profile.host,
      description: profile.description,
      authorityCeiling: profile.authorityCeiling,
      source: { path: profile.source, digest: digestOf(profile.source) },
      overlayModules: (profile.overlayModules ?? []).map(moduleRef),
      ...(profile.runtimeCapabilities === undefined
        ? {}
        : { runtimeCapabilities: structuredClone(profile.runtimeCapabilities) }),
      ...(profile.interactionBindings === undefined
        ? {}
        : { interactionBindings: structuredClone(profile.interactionBindings) }),
    });
  }

  const skillSource = withDocumentDigest({
    kind: 'skill-source',
    ...envelope,
    skillId: skillDoc.skillId,
    skillVersion: skillDoc.skillVersion,
    sourceFormat: skillDoc.sourceFormat ?? 'composed-v1',
    authorityCeiling: skillDoc.authorityCeiling,
    template: { path: skillDoc.template, digest: digestOf(skillDoc.template) },
    modules: (skillDoc.modules ?? []).map(moduleRef),
    references: (skillDoc.references ?? []).map((reference) => ({ module: moduleRef(reference), routed: true })),
    hostProfiles: (skillDoc.hostProfiles ?? []).map(({ id, version }) => ({ id, version })),
  });

  const moduleRegistry = withDocumentDigest({ kind: 'skill-module-registry', ...envelope, modules });
  const profiles = [...hostProfilesByKey.values()];
  const capabilityAware = profiles.some((profile) => (
    profile.runtimeCapabilities !== undefined || profile.interactionBindings !== undefined
  ));
  const hostProfileEnvelope = capabilityAware
    ? { ...envelope, schemaVersion: '1.1.0', documentVersion: '1.1.0' }
    : envelope;
  const hostProfileRegistry = withDocumentDigest({
    kind: 'skill-host-profile-registry',
    ...hostProfileEnvelope,
    profiles,
  });

  for (const [, kind] of SKILL_SOURCE_KINDS) {
    assertSchemaValid(kind, { 'skill-source': skillSource, 'skill-module-registry': moduleRegistry, 'skill-host-profile-registry': hostProfileRegistry }[kind], protocolVersion);
  }

  const declaredProfiles = skillSource.hostProfiles.map(({ id, version }) => {
    const key = `${id}@${version}`;
    const profile = hostProfilesByKey.get(key);
    if (!profile) {
      throw new SkillAuthoringError('E_SKILL_HOST_PROFILE_UNDECLARED', `Host profile ${id}@${version} is declared by the skill but absent from host-profiles.json.`, {
        pointer: `host-profiles.json#/${key}`,
        repair: `Declare ${id}@${version} in host-profiles.json or correct the skill's hostProfiles list.`,
      });
    }
    return profile;
  });

  return Object.freeze({
    skillDir: realSkillDir,
    skillSource,
    moduleRegistry,
    hostProfileRegistry,
    skillSourceCustody: Object.freeze({ path: 'skill.json', digest: sha256(skillFile.bytes) }),
    modules,
    hostProfilesByKey,
    declaredProfiles,
    cursorTemplate: CURSOR_TEMPLATE,
    readSource,
  });
}
