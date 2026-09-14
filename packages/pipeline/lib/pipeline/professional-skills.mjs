import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertProtocolArtifact } from '../protocol/contracts.mjs';
import { sha256Jcs } from '../protocol/jcs.mjs';
import { PipelineError } from './errors.mjs';

export const PROFESSIONAL_SKILLS_CATALOG_PATH = 'registry/professional-skills.json';
export const PROFESSIONAL_SKILLS_MANIFEST_PATH = 'conformance/fixtures/professional-skills/generated-assets.json';
export const PROFESSIONAL_SKILL_IDS = Object.freeze([
  'planr-browser-qa',
  'planr-investigate',
  'planr-plan-review',
  'planr-spec',
]);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOSTS = Object.freeze(['claude-code', 'codex', 'cursor']);
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ACTIVE_SOURCE_SKILL_IDS = Object.freeze(new Set(PROFESSIONAL_SKILL_IDS));
const ACTIVE_VIEW = Symbol('openplanr.professional-skills.active-view');
const LEGACY_CATALOG = Symbol('openplanr.professional-skills.legacy-catalog');
const ACTIVE_SOURCES = Symbol('openplanr.professional-skills.active-sources');
const FORBIDDEN_PORTABLE_PATTERNS = Object.freeze([
  Object.freeze({ label: 'unresolved token', pattern: /\{\{[^}]+\}\}|<%[^%]+%>/u }),
  Object.freeze({ label: 'absolute or home path', pattern: /(?:\/Users\/|\/home\/|~\/\.|[A-Za-z]:\\)/u }),
  Object.freeze({ label: 'sibling traversal', pattern: /(?:^|[\s`'"])(?:\.\.\/)+/mu }),
  Object.freeze({ label: 'nested pipeline executable', pattern: /^\s*(?:[$>]\s*)?planr-pipeline(?:\s|$)/mu }),
  Object.freeze({ label: 'nested coding runtime', pattern: /^\s*(?:[$>]\s*)?(?:claude|codex|cursor)\s+(?:run|exec|--)/mu }),
  Object.freeze({ label: 'vendor model selection', pattern: /(?:sonnet|opus|gpt-[0-9]|gemini-[0-9])/iu }),
  Object.freeze({ label: 'prompt-authored lifecycle truth', pattern: /(?:write|create|touch|mark)\s+[^\n]*(?:\.pipeline-shipped|qa-report\.md|provenance|compatibility manifest)/iu }),
]);

function canonicalText(value) {
  return value.replace(/\r\n/gu, '\n');
}

function sha256Text(value) {
  return `sha256:${createHash('sha256').update(canonicalText(value), 'utf8').digest('hex')}`;
}

function fail(code, message, details = {}) {
  throw new PipelineError(code, message, details);
}

function splitSkillMarkdown(skillId, sourceSnapshot) {
  const match = canonicalText(sourceSnapshot).match(
    /^---\nname: ([a-z][a-z0-9-]*)\ndescription: ([^\n]+)\n(?:license: ([^\n]+)\n)?---\n\n([\s\S]+)$/u,
  );
  if (!match || match[1] !== skillId || (match[3] !== undefined && match[3] !== 'MIT')
    || !match[4].endsWith('\n')) {
    fail('E_PROFESSIONAL_SKILL_SOURCE_INVALID', `Skill ${skillId} has invalid canonical SKILL.md bytes.`);
  }
  const description = match[2].startsWith('"')
    ? JSON.parse(match[2])
    : match[2];
  if (typeof description !== 'string' || !description) {
    fail('E_PROFESSIONAL_SKILL_SOURCE_INVALID', `Skill ${skillId} has an invalid description.`);
  }
  return Object.freeze({ name: match[1], description, license: match[3], body: match[4] });
}

function assertPortable(path, bytes) {
  const hit = FORBIDDEN_PORTABLE_PATTERNS.find(({ pattern }) => pattern.test(bytes));
  if (hit) {
    fail(
      'E_PROFESSIONAL_SKILL_PORTABILITY_INVALID',
      `Generated professional skill asset ${path} contains ${hit.label}.`,
      { path, violation: hit.label },
    );
  }
}

function expectedHostPath(skillId, host) {
  const suffix = skillId.slice('planr-'.length);
  if (host === 'claude-code') return `skills/${skillId}/SKILL.md`;
  if (host === 'codex') return `adapters/codex/skills/${skillId}/SKILL.md`;
  return `adapters/cursor/rules/openplanr-${suffix}.mdc`;
}

export function assertProfessionalSkillsCatalog(catalog) {
  assertProtocolArtifact('professional-skills', catalog, { protocolVersion: '1.1.0' });
  const ids = catalog.skills.map(({ skillId }) => skillId);
  if (JSON.stringify(ids) !== JSON.stringify(PROFESSIONAL_SKILL_IDS)) {
    fail('E_PROFESSIONAL_SKILL_MEMBERSHIP_INVALID', 'Professional skill membership must match the canonical sorted manifest.', { expected: PROFESSIONAL_SKILL_IDS, actual: ids });
  }
  const cliIds = new Set();
  for (const row of catalog.skills) {
    if (sha256Text(row.sourceSnapshot) !== row.sourceDigest) {
      fail('E_PROFESSIONAL_SKILL_SOURCE_DIGEST_INVALID', `Skill ${row.skillId} source snapshot digest is stale.`, { skillId: row.skillId });
    }
    splitSkillMarkdown(row.skillId, row.sourceSnapshot);
    const hosts = row.hosts.map(({ host }) => host);
    if (JSON.stringify(hosts) !== JSON.stringify(HOSTS)) {
      fail('E_PROFESSIONAL_SKILL_HOST_INVALID', `Skill ${row.skillId} must map every host exactly once in canonical order.`, { skillId: row.skillId, hosts });
    }
    for (const host of row.hosts) {
      if (host.path !== expectedHostPath(row.skillId, host.host)) {
        fail('E_PROFESSIONAL_SKILL_PATH_INVALID', `Skill ${row.skillId} has a non-canonical ${host.host} path.`, { skillId: row.skillId, host: host.host, path: host.path });
      }
    }
    for (const requirement of row.cliRequirements) {
      if (cliIds.has(requirement.id)) fail('E_PROFESSIONAL_SKILL_CLI_INVALID', `Duplicate professional skill CLI requirement ${requirement.id}.`);
      cliIds.add(requirement.id);
    }
  }
  return catalog;
}

function assertActiveProfessionalSkillsCatalog(catalog) {
  if (!catalog || catalog[ACTIVE_VIEW] !== true
    || !catalog[LEGACY_CATALOG] || !(catalog[ACTIVE_SOURCES] instanceof Map)) {
    fail('E_PROFESSIONAL_SKILL_ACTIVE_VIEW_INVALID', 'Professional skill active view metadata is missing.');
  }
  const legacy = assertProfessionalSkillsCatalog(catalog[LEGACY_CATALOG]);
  const activeHeader = { ...catalog, skills: legacy.skills };
  if (JSON.stringify(activeHeader) !== JSON.stringify(legacy)) {
    fail('E_PROFESSIONAL_SKILL_ACTIVE_VIEW_INVALID', 'Professional skill active view changed legacy catalog metadata.');
  }
  const legacyById = new Map(legacy.skills.map((row) => [row.skillId, row]));
  if (JSON.stringify(catalog.skills.map(({ skillId }) => skillId))
    !== JSON.stringify(PROFESSIONAL_SKILL_IDS)) {
    fail('E_PROFESSIONAL_SKILL_MEMBERSHIP_INVALID', 'Professional skill active view membership drifted.');
  }
  for (const row of catalog.skills) {
    const legacyRow = legacyById.get(row.skillId);
    if (!ACTIVE_SOURCE_SKILL_IDS.has(row.skillId)) {
      if (JSON.stringify(row) !== JSON.stringify(legacyRow)) {
      fail('E_PROFESSIONAL_SKILL_ACTIVE_VIEW_INVALID', `Skill ${row.skillId} changed outside the active-source overlay.`, { skillId: row.skillId });
      }
      continue;
    }
    const source = catalog[ACTIVE_SOURCES].get(row.skillId);
    if (typeof source !== 'string' || row.sourceSnapshot !== source
      || row.sourceDigest !== sha256Text(source)
      || !Array.isArray(row.cliRequirements) || row.cliRequirements.length !== 0) {
      fail('E_PROFESSIONAL_SKILL_ACTIVE_VIEW_INVALID', `Skill ${row.skillId} does not match canonical prompt custody.`, { skillId: row.skillId });
    }
    splitSkillMarkdown(row.skillId, row.sourceSnapshot);
    assertPortable(expectedHostPath(row.skillId, 'claude-code'), row.sourceSnapshot);
    const preserved = {
      ...row,
      sourceSnapshot: legacyRow.sourceSnapshot,
      sourceDigest: legacyRow.sourceDigest,
      cliRequirements: legacyRow.cliRequirements,
    };
    if (JSON.stringify(preserved) !== JSON.stringify(legacyRow)) {
      fail('E_PROFESSIONAL_SKILL_ACTIVE_VIEW_INVALID', `Skill ${row.skillId} changed metadata outside its active prompt overlay.`, { skillId: row.skillId });
    }
  }
  return catalog;
}

function assertUsableProfessionalSkillsCatalog(catalog) {
  return catalog?.[ACTIVE_VIEW] === true
    ? assertActiveProfessionalSkillsCatalog(catalog)
    : assertProfessionalSkillsCatalog(catalog);
}

function legacyCatalogFor(catalog) {
  return catalog?.[ACTIVE_VIEW] === true ? catalog[LEGACY_CATALOG] : catalog;
}

export function readProfessionalSkillsCatalog({
  projectRoot = packageRoot,
  view = 'active',
} = {}) {
  const catalog = assertProfessionalSkillsCatalog(JSON.parse(
    readFileSync(resolve(projectRoot, PROFESSIONAL_SKILLS_CATALOG_PATH), 'utf8'),
  ));
  if (view === 'legacy') return catalog;
  if (view !== 'active') {
    fail('E_PROFESSIONAL_SKILL_VIEW_INVALID', `Unsupported professional skill catalog view ${String(view)}.`);
  }
  const activeSources = new Map();
  const skills = catalog.skills.map((row) => {
    const activeRow = JSON.parse(JSON.stringify(row));
    if (!ACTIVE_SOURCE_SKILL_IDS.has(row.skillId)) return activeRow;
    const path = expectedHostPath(row.skillId, 'claude-code');
    const absolute = resolve(projectRoot, path);
    if (!existsSync(absolute) || lstatSync(absolute).isSymbolicLink() || !lstatSync(absolute).isFile()) {
      fail('E_PROFESSIONAL_SKILL_SOURCE_INVALID', `Canonical skill source ${path} is missing or unsafe.`, { skillId: row.skillId, path });
    }
    const sourceSnapshot = canonicalText(readFileSync(absolute, 'utf8'));
    splitSkillMarkdown(row.skillId, sourceSnapshot);
    assertPortable(path, sourceSnapshot);
    activeSources.set(row.skillId, sourceSnapshot);
    return {
      ...activeRow,
      sourceSnapshot,
      sourceDigest: sha256Text(sourceSnapshot),
      cliRequirements: [],
    };
  });
  const active = { ...catalog, skills };
  Object.defineProperties(active, {
    [ACTIVE_VIEW]: { value: true },
    [LEGACY_CATALOG]: { value: catalog },
    [ACTIVE_SOURCES]: { value: activeSources },
  });
  return assertActiveProfessionalSkillsCatalog(active);
}

export function renderProfessionalSkillAssets(catalog) {
  assertUsableProfessionalSkillsCatalog(catalog);
  const assets = {};
  for (const row of catalog.skills) {
    const source = canonicalText(row.sourceSnapshot);
    const { description, body } = splitSkillMarkdown(row.skillId, source);
    for (const host of row.hosts) {
      const bytes = host.host === 'cursor'
        ? `---\ndescription: ${JSON.stringify(description)}\nalwaysApply: false\n---\n\n${body}`
        : source;
      assertPortable(host.path, bytes);
      assets[host.path] = bytes;
    }
  }
  return Object.fromEntries(Object.entries(assets).sort(([left], [right]) => left.localeCompare(right)));
}

export function buildProfessionalSkillsManifest(
  catalog,
  assets = renderProfessionalSkillAssets(catalog),
  { activeRegistrationsBySkill = new Map() } = {},
) {
  assertUsableProfessionalSkillsCatalog(catalog);
  const skillIds = [...PROFESSIONAL_SKILL_IDS];
  const skills = catalog.skills.map((row) => {
    const canonicalSourcePath = expectedHostPath(row.skillId, 'claude-code');
    const canonicalSource = assets[canonicalSourcePath];
    if (typeof canonicalSource !== 'string') {
      fail(
        'E_PROFESSIONAL_SKILL_ASSET_MISSING',
        `Generated professional skill asset ${canonicalSourcePath} is missing.`,
        { path: canonicalSourcePath },
      );
    }
    const registration = activeRegistrationsBySkill.get(row.skillId);
    const cliRequirements = registration
      ? registration.cliRequirements.map((requirement) => ({
          id: requirement.commandId,
          argv: requirement.argv,
          requiredOptions: requirement.requiredOptions,
        }))
      : row.cliRequirements;
    if (!Array.isArray(cliRequirements)) {
      fail(
        'E_PROFESSIONAL_SKILL_CLI_INVALID',
        `Skill ${row.skillId} has an invalid generated CLI requirement override.`,
        { skillId: row.skillId, cliRequirements },
      );
    }
    return {
      skillId: row.skillId,
      sourceOwner: row.sourceOwner,
      sourceVersion: registration?.skillVersion ?? row.sourceVersion,
      sourceDigest: sha256Text(canonicalSource),
      contracts: registration?.contracts ?? row.contracts,
      authorityClass: registration?.authorityClass ?? row.authorityClass,
      triggerPolicy: registration?.triggerPolicy ?? row.triggerPolicy,
      cliRequirements,
      assets: row.hosts.map(({ host, entrypoint, path }) => {
        const bytes = assets[path];
        if (typeof bytes !== 'string') fail('E_PROFESSIONAL_SKILL_ASSET_MISSING', `Generated professional skill asset ${path} is missing.`, { path });
        assertPortable(path, bytes);
        return { host, entrypoint, path, digest: sha256Text(bytes) };
      }),
    };
  });
  const catalogIdentity = {
    path: PROFESSIONAL_SKILLS_CATALOG_PATH,
    catalogVersion: catalog.catalogVersion,
    digest: sha256Jcs(legacyCatalogFor(catalog)),
  };
  const manifest = {
    kind: 'professional-skill-assets',
    schemaVersion: '1.0.0',
    protocolVersion: '1.1.0',
    catalog: catalogIdentity,
    digestAlgorithm: 'sha256',
    skillIds,
    membershipDigest: sha256Jcs(skillIds),
    skills,
  };
  return Object.freeze({
    ...manifest,
    bundleDigest: sha256Jcs({ catalog: catalogIdentity, skillIds, skills }),
  });
}

export function renderProfessionalSkillsBundle({ projectRoot = packageRoot } = {}) {
  const catalog = readProfessionalSkillsCatalog({ projectRoot });
  const assets = renderProfessionalSkillAssets(catalog);
  const skillRegistry = JSON.parse(
    readFileSync(resolve(projectRoot, 'registry/v1.5.0/skills.json'), 'utf8'),
  );
  const activeRegistrationsBySkill = new Map(
    skillRegistry.skills
      .filter(({ skillId }) => PROFESSIONAL_SKILL_IDS.includes(skillId))
      .map((registration) => [registration.skillId, registration]),
  );
  const manifest = buildProfessionalSkillsManifest(catalog, assets, {
    activeRegistrationsBySkill,
  });
  return Object.freeze({
    ...assets,
    [PROFESSIONAL_SKILLS_MANIFEST_PATH]: `${JSON.stringify(manifest, null, 2)}\n`,
  });
}

export function professionalSkillCliRequirements(catalog) {
  assertUsableProfessionalSkillsCatalog(catalog);
  return catalog.skills.flatMap(({ skillId, cliRequirements }) => (
    cliRequirements.map((requirement) => Object.freeze({ ...requirement, skillId }))
  ));
}

export function professionalSkillDigest(value) {
  if (typeof value !== 'string') fail('E_PROFESSIONAL_SKILL_DIGEST_INVALID', 'Professional skill digest input must be text.');
  const digest = sha256Text(value);
  if (!DIGEST.test(digest)) fail('E_PROFESSIONAL_SKILL_DIGEST_INVALID', 'Professional skill digest could not be computed.');
  return digest;
}
