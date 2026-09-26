import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256Hex } from '../src/canonical-json.mjs';

export const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const readJson = (path) => JSON.parse(readFileSync(resolve(workspaceRoot, path), 'utf8'));
const digest = (path) => `sha256:${sha256Hex(readFileSync(resolve(workspaceRoot, path)))}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function readCanonicalSkillRegistry() {
  const registry = readJson('skills/registry.json');
  assert(
    registry.kind === 'openplanr-skill-source-registry',
    'skills/registry.json has an invalid kind.',
  );
  assert(
    registry.schemaVersion === '1.0.0',
    'skills/registry.json has an unsupported schema version.',
  );
  assert(registry.sourceFormat === 'package-v1', 'skills/registry.json must select package-v1.');
  assert(
    Array.isArray(registry.skills) && registry.skills.length > 0,
    'skills/registry.json must declare canonical skills.',
  );

  const ids = registry.skills.map(({ skillId }) => skillId);
  assert(new Set(ids).size === ids.length, 'skills/registry.json contains duplicate skill IDs.');
  assert(
    ids.every((id) => /^planr-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)),
    'skills/registry.json contains a non-canonical skill ID.',
  );
  assert(
    JSON.stringify(ids) === JSON.stringify([...ids].sort()),
    'skills/registry.json skills must be sorted by ID.',
  );

  const sourceDirectories = readdirSync(resolve(workspaceRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('planr-'))
    .filter((entry) =>
      existsSync(resolve(workspaceRoot, 'skills', entry.name, 'openplanr.skill.json')),
    )
    .map((entry) => entry.name)
    .sort();
  assert(
    JSON.stringify(ids) === JSON.stringify(sourceDirectories),
    'skills/registry.json membership differs from standard skill packages.',
  );

  for (const row of registry.skills) {
    assert(
      row.source === `skills/${row.skillId}/openplanr.skill.json`,
      `${row.skillId} has a non-canonical source path.`,
    );
    assert(
      row.baseline === `skills/${row.skillId}/SKILL.md`,
      `${row.skillId} has a non-canonical baseline path.`,
    );
    assert(
      existsSync(resolve(workspaceRoot, row.source)),
      `${row.skillId} skill source is missing.`,
    );
    assert(
      existsSync(resolve(workspaceRoot, row.baseline)),
      `${row.skillId} markdown-v1 baseline is missing.`,
    );
  }
  return registry;
}

export function collectCanonicalModuleGraph(registry = readCanonicalSkillRegistry()) {
  void registry;
  // Protocol 1.6/1.7 composed-source registries remain readable historical
  // contracts. Protocol 1.8 standard packages no longer regenerate that graph.
  return {
    modules: readJson('packages/protocol/registries/skill-modules.json').modules,
    policies: readJson('packages/protocol/registries/skill-routing.json').policies,
  };
}

export function sourceDigest(path) {
  return digest(path);
}
