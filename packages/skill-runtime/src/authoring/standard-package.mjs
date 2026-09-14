import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
  listRegularFiles,
  readSkillSourceRegistry,
  readStandardSkillPackage,
} from '../catalog.mjs';
import { parseMarkdownAsset, sha256Bytes } from '../compiler/index.mjs';
import { SkillAuthoringError } from './diagnostics.mjs';
import { runOperation } from './operation-result.mjs';

const HOST_OUTPUT_ROOTS = Object.freeze({
  'claude-code': 'dist/plugins/claude/openplanr/skills',
  codex: 'dist/plugins/openai/openplanr/skills',
  chatgpt: 'dist/plugins/openai/openplanr/skills',
  cursor: 'dist/plugins/cursor/openplanr/rules',
});

const DORMANT_COMPOSED_FILES = new Set([
  'compatibility.json',
  'host-profiles.json',
  'modules.json',
]);

function isDormantComposedFile(path) {
  return DORMANT_COMPOSED_FILES.has(path) || path.startsWith('dist/');
}

function packageContext(skillDir) {
  const directory = resolve(skillDir);
  const manifestPath = resolve(directory, 'openplanr.skill.json');
  if (!existsSync(manifestPath)) return null;
  if (basename(dirname(directory)) !== 'skills') {
    throw new SkillAuthoringError(
      'E_SKILL_PACKAGE_LOCATION_INVALID',
      'A standard skill package must be a direct child of skills/.',
      { path: directory, repair: 'Move the package to skills/planr-{name}/.' },
    );
  }
  const repoRoot = resolve(directory, '..', '..');
  const registry = readSkillSourceRegistry({ repoRoot });
  const row = registry.skills.find(({ skillId }) => skillId === basename(directory));
  if (!row) {
    throw new SkillAuthoringError(
      'E_SKILL_PACKAGE_UNREGISTERED',
      `${basename(directory)} is not declared in skills/registry.json.`,
      { path: 'skills/registry.json', repair: 'Add one canonical, sorted registry row for the package.' },
    );
  }
  return { directory, repoRoot, row };
}

function inspectPackage(skillDir) {
  const context = packageContext(skillDir);
  if (!context) return null;
  const packageInfo = readStandardSkillPackage({
    repoRoot: context.repoRoot,
    registryRow: context.row,
  });
  const parsed = parseMarkdownAsset(packageInfo.markdown, { expectedName: context.row.skillId });
  if (/\{\{[A-Z][A-Z0-9_]*\}\}/u.test(packageInfo.markdown)) {
    throw new SkillAuthoringError(
      'E_SKILL_PACKAGE_TEMPLATE_TOKEN',
      `${context.row.skillId} contains an unresolved custom template token.`,
      { path: 'SKILL.md', repair: 'Replace custom variables with direct host-readable instructions.' },
    );
  }
  const declared = new Set([
    packageInfo.manifest.entrypoint,
    'openplanr.skill.json',
    ...packageInfo.resources.map(({ path }) => path),
  ]);
  const actual = listRegularFiles(packageInfo.skillDir, { relativeTo: packageInfo.skillDir });
  const legacyFiles = actual.filter(isDormantComposedFile);
  const undeclared = actual.filter((path) => !declared.has(path) && !isDormantComposedFile(path));
  const missing = [...declared].filter((path) => !actual.includes(path));
  if (undeclared.length > 0 || missing.length > 0) {
    throw new SkillAuthoringError(
      'E_SKILL_PACKAGE_RESOURCE_DRIFT',
      `${context.row.skillId} package files differ from its Protocol 1.8 resource declarations.`,
      {
        path: 'openplanr.skill.json',
        undeclared,
        missing,
        repair: 'Declare every support file exactly once and remove stale resource declarations.',
      },
    );
  }
  const resources = packageInfo.resources.map(({ absolute, ...resource }) => ({
    ...resource,
    byteLength: readFileSync(absolute).byteLength,
    digest: sha256Bytes(readFileSync(absolute)),
  }));
  return {
    skillId: context.row.skillId,
    skillVersion: context.row.skillVersion,
    sourceFormat: 'package-v1',
    description: parsed.fields.description,
    entrypoint: packageInfo.manifest.entrypoint,
    entrypointDigest: sha256Bytes(packageInfo.markdown),
    entrypointBytes: Buffer.byteLength(packageInfo.markdown),
    execution: packageInfo.manifest.execution,
    hosts: [...packageInfo.manifest.hosts],
    resources,
    legacyFiles,
  };
}

export function isStandardSkillPackage(skillDir) {
  return existsSync(resolve(skillDir, 'openplanr.skill.json'));
}

/** Validate or inspect one direct Protocol 1.8 skill package without rendering prompts. */
export function inspectStandardSkill({ skillDir, command }) {
  return runOperation(command, () => {
    const inspected = inspectPackage(skillDir);
    if (!inspected) {
      throw new SkillAuthoringError(
        'E_SKILL_PACKAGE_MANIFEST_MISSING',
        `openplanr.skill.json is required in ${resolve(skillDir)}.`,
        { path: 'openplanr.skill.json', repair: 'Add a Protocol 1.8 standard skill-package manifest.' },
      );
    }
    return {
      ...inspected,
      outputs: inspected.hosts.map((host) => ({
        host,
        root: HOST_OUTPUT_ROOTS[host],
        entrypoint: host === 'cursor'
          ? `${HOST_OUTPUT_ROOTS.cursor}/${inspected.skillId}.mdc`
          : `${HOST_OUTPUT_ROOTS[host]}/${inspected.skillId}/SKILL.md`,
      })),
    };
  });
}
