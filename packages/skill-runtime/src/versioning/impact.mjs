import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';

import { describeAuthoringGraph } from '../authoring/command-contract.mjs';
import { loadComposedSkill } from '../authoring/loader.mjs';
import { readStandardSkillPackage } from '../catalog.mjs';

const GLOBAL_GENERATED_ASSETS = Object.freeze([
  'adapters/manifests/canonical-skills.json',
  'adapters/manifests/ecosystem-assets.json',
  'adapters/manifests/generated-assets.json',
  'packages/pipeline/registry/generated-skill-assets.json',
  'packages/protocol/registries/skill-modules.json',
  'packages/protocol/registries/skill-routing.json',
  'packages/protocol/registries/skills.json',
  'packages/protocol/src/generated/canonical-registries.mjs',
  'packages/skill-runtime/contributions/canonical-skills.json',
]);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeChange(change) {
  if (!change || !['module', 'host-profile'].includes(change.kind)) {
    throw new TypeError('Each impact change must have kind module or host-profile.');
  }
  if (!change.id && !change.source)
    throw new TypeError('Each impact change must select an id or source.');
  return {
    kind: change.kind,
    id: change.id ?? null,
    source: change.source ?? null,
    previousVersion: change.previousVersion ?? null,
    nextVersion: change.nextVersion ?? null,
  };
}

function matchesChange(change, graph) {
  const nodes = change.kind === 'module' ? graph.modules : graph.hostProfiles;
  return nodes.some(
    (node) =>
      (change.id && (node.moduleId === change.id || node.id === change.id)) ||
      (change.source && node.source === change.source),
  );
}

function resourceId(path) {
  const name = basename(path);
  return name.slice(0, name.length - extname(name).length);
}

function describeStandardPackage(repoRoot, registration) {
  const packageInfo = readStandardSkillPackage({ repoRoot, registryRow: registration });
  return Object.freeze({
    modules: Object.freeze(
      packageInfo.resources.map((resource) =>
        Object.freeze({
          moduleId: resourceId(resource.path),
          source: resource.path,
        }),
      ),
    ),
    // Protocol 1.8 packages are host-neutral sources. Host-specific metadata is
    // declared as an ordinary resource instead of an authored prompt overlay.
    hostProfiles: Object.freeze([]),
  });
}

function skillAssetPaths(assetManifest, skillId) {
  const slug = skillId.replace(/^planr-/u, '');
  const pathMarkers = [`/${skillId}/`, `/${skillId}.`, `/skills/${slug}/`, `/openplanr-${slug}.`];
  return assetManifest.assets
    .map(({ path }) => path)
    .filter((path) => pathMarkers.some((marker) => `/${path}`.includes(marker)));
}

export function analyzeSkillGraphImpact({ repoRoot, changes } = {}) {
  const root = resolve(repoRoot ?? '.');
  const registry = readJson(join(root, 'skills/registry.json'));
  const assetManifest = readJson(join(root, 'adapters/manifests/generated-assets.json'));
  if (!Array.isArray(changes) || changes.length === 0)
    throw new TypeError('changes must be a non-empty array.');
  const normalizedChanges = changes.map(normalizeChange);
  const skills = registry.skills.map((registration) => {
    const graph =
      registry.sourceFormat === 'package-v1'
        ? describeStandardPackage(root, registration)
        : describeAuthoringGraph(
            loadComposedSkill({ skillDir: dirname(join(root, registration.source)) }),
          );
    return { registration, graph };
  });
  const changeResults = normalizedChanges.map((change) => {
    const affectedSkills = skills
      .filter(({ graph }) => matchesChange(change, graph))
      .map(({ registration }) => registration.skillId)
      .sort();
    const generatedAssets = [
      ...new Set([
        ...GLOBAL_GENERATED_ASSETS,
        ...affectedSkills.flatMap((skillId) => skillAssetPaths(assetManifest, skillId)),
      ]),
    ].sort();
    return { ...change, affectedSkills, generatedAssets };
  });
  return Object.freeze({
    kind: 'skill-source-impact-report',
    schemaVersion: '1.0.0',
    changes: changeResults,
    allSkills: skills.map(({ registration }) => registration.skillId).sort(),
    affectedSkills: [
      ...new Set(changeResults.flatMap(({ affectedSkills }) => affectedSkills)),
    ].sort(),
    generatedAssets: [
      ...new Set(changeResults.flatMap(({ generatedAssets }) => generatedAssets)),
    ].sort(),
  });
}

export function planSkillGraphRollback({ impactReport, previousVersions } = {}) {
  if (impactReport?.kind !== 'skill-source-impact-report')
    throw new TypeError('impactReport must be a skill-source impact report.');
  if (
    !previousVersions ||
    typeof previousVersions !== 'object' ||
    Array.isArray(previousVersions)
  ) {
    throw new TypeError('previousVersions must be keyed by change selector.');
  }
  const changes = impactReport.changes.map((change) => {
    const key = `${change.kind}:${change.id ?? change.source}`;
    const targetVersion = previousVersions[key];
    if (typeof targetVersion !== 'string')
      throw new TypeError(`Missing previous version for ${key}.`);
    return {
      selector: key,
      targetVersion,
      affectedSkills: [...change.affectedSkills],
      regenerate: [...change.generatedAssets],
    };
  });
  const affected = new Set(impactReport.affectedSkills);
  return Object.freeze({
    kind: 'skill-source-rollback-plan',
    schemaVersion: '1.0.0',
    scope: 'affected-family-only',
    changes,
    unaffectedSkills: impactReport.allSkills.filter((skillId) => !affected.has(skillId)),
  });
}
