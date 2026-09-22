import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readContributionGraph } from '../../../skill-runtime/src/catalog.mjs';

// The frozen Protocol registry remains a compatibility contract. Current
// package-v1 distributions expose workflows as skills and have no command tree.
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const registry = JSON.parse(readFileSync(join(root, 'packages/protocol/registry/frozen-commands.json'), 'utf8'));

const FROZEN_ALIAS_SLUGS = ['plan', 'ship', 'design', 'sync', 'dashboard'];

test('frozen surface: registry is well-formed (8 entries, 5 skill aliases)', () => {
  assert.equal(
    registry.kind,
    'frozen-command-registry',
    'registry/frozen-commands.json must declare kind "frozen-command-registry"',
  );
  assert.ok(Array.isArray(registry.commands), 'registry.commands must be an array');
  assert.equal(
    registry.commands.length,
    8,
    `frozen registry must declare exactly 8 commands; found ${registry.commands.length}`,
  );

  const aliasEntries = registry.commands.filter((entry) => entry.hasSkillAlias);
  assert.equal(
    aliasEntries.length,
    5,
    `exactly 5 commands must be FR1 workflow aliases (hasSkillAlias: true); found ${aliasEntries.length}`,
  );

  const aliasSlugs = aliasEntries.map((entry) => entry.slug).sort();
  assert.deepEqual(
    aliasSlugs,
    [...FROZEN_ALIAS_SLUGS].sort(),
    'the 5 skill-aliased commands must be exactly {plan, ship, design, sync, dashboard}',
  );

  // Each entry's shape is coherent: aliases name a planr-* skill; non-aliases name none.
  for (const entry of registry.commands) {
    if (entry.hasSkillAlias) {
      assert.equal(
        entry.skillName,
        `planr-${entry.slug}`,
        `alias "${entry.slug}" must point at skill "planr-${entry.slug}"; found ${JSON.stringify(entry.skillName)}`,
      );
    } else {
      assert.equal(
        entry.skillName,
        null,
        `non-alias command "${entry.slug}" must have skillName null; found ${JSON.stringify(entry.skillName)}`,
      );
    }
  }

  // No duplicate slugs — a duplicate would let the count checks pass while the set drifts.
  const slugs = registry.commands.map((entry) => entry.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'frozen registry must not declare duplicate slugs');
});

test('current packages expose the frozen workflows as skills without reviving commands', () => {
  const graph = readContributionGraph({ repoRoot: root });
  assert.equal(graph.registry.sourceFormat, 'package-v1');
  assert.deepEqual(graph.frozenCommands.commands, []);
  assert.deepEqual(graph.aliases.aliases, []);

  const skillIds = new Set(graph.skills.map(({ id }) => id));
  for (const { slug } of registry.commands) {
    assert.ok(skillIds.has(`planr-${slug}`), `${slug} must remain available as a canonical skill`);
  }

  for (const host of ['openai', 'claude', 'cursor']) {
    const pluginRoot = join(root, 'dist/plugins', host, 'openplanr');
    assert.ok(existsSync(pluginRoot), `${host} distribution must have been generated`);
    assert.equal(existsSync(join(pluginRoot, 'commands')), false, `${host} must not revive the retired command surface`);
    for (const { slug } of registry.commands) {
      const entrypoint = host === 'cursor'
        ? join(pluginRoot, 'rules', `planr-${slug}.mdc`)
        : join(pluginRoot, 'skills', slug, 'SKILL.md');
      assert.ok(readFileSync(entrypoint, 'utf8').length > 80, `${host} must ship the ${slug} workflow`);
    }
  }
});
