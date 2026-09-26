import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  EXPECTED_ROLE_IDS,
  EXPECTED_SKILL_IDS,
  SkillRuntimeError,
  assertSafeRelativePath,
  readContributionGraph,
  validateContributionGraph,
} from '../../packages/skill-runtime/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('contribution graph matches the canonical packages, zero aliases or commands, and nine roles', () => {
  const graph = readContributionGraph({ repoRoot: root });
  assert.deepEqual(
    graph.skills.map(({ id }) => id),
    EXPECTED_SKILL_IDS,
  );
  assert.deepEqual(
    graph.roles.map(({ id }) => id),
    EXPECTED_ROLE_IDS,
  );
  assert.equal(graph.skills.length, EXPECTED_SKILL_IDS.length);
  assert.ok(graph.skills.some(({ id }) => id === 'planr-release'));
  assert.deepEqual(graph.aliases.aliases, []);
  assert.deepEqual(graph.frozenCommands.commands, []);
});

test('duplicate skill ownership and unsafe contribution paths fail closed', () => {
  const manifest = {
    kind: 'openplanr-skill-contribution',
    schemaVersion: '1.0.0',
    id: 'fixture',
    skills: [
      {
        id: 'planr-fixture',
        source: 'skills/fixture/SKILL.md',
        authorityClass: 'fixture',
        commands: [],
      },
      {
        id: 'planr-fixture',
        source: 'skills/fixture/SKILL.md',
        authorityClass: 'fixture',
        commands: [],
      },
    ],
  };
  assert.throws(
    () => validateContributionGraph([manifest], { expectedSkillIds: ['planr-fixture'] }),
    (error) => error instanceof SkillRuntimeError && error.code === 'E_SKILL_ID_DUPLICATE',
  );
  assert.throws(
    () => assertSafeRelativePath('../outside.md'),
    (error) => error instanceof SkillRuntimeError && error.code === 'E_SKILL_PATH_INVALID',
  );
});

test('skill runtime is declarative and does not import workflow implementations', () => {
  const files = [
    'catalog.mjs',
    'errors.mjs',
    'index.mjs',
    'operate-review-contract.mjs',
    'operate-review-note.mjs',
    'protocol.mjs',
    'render.mjs',
  ];
  for (const file of files) {
    const source = readFileSync(resolve(root, 'packages/skill-runtime/src', file), 'utf8');
    assert.doesNotMatch(source, /packages\/(?:cli|pipeline|operate|artifact|design)/u, file);
    assert.doesNotMatch(source, /@openplanr\/(?:operate|artifact|design)/u, file);
  }
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages/skill-runtime/package.json'), 'utf8'),
  );
  const protocol = JSON.parse(
    readFileSync(resolve(root, 'packages/protocol/package.json'), 'utf8'),
  );
  assert.deepEqual(manifest.dependencies, { '@openplanr/protocol': protocol.version });
  const protocolSource = readFileSync(
    resolve(root, 'packages/skill-runtime/src/protocol.mjs'),
    'utf8',
  );
  assert.match(protocolSource, /from '@openplanr\/protocol\/registries'/u);
});
