import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

// FR2 — the plugin command surface is frozen. registry/frozen-commands.json is the
// single, closed source of truth for exactly which commands/*.md files may exist.
// The list is a ceiling, not a cull: it may shrink by attrition but must never grow,
// so a new workflow is impossible to ship as a command and can only ship as a skill.
// These assertions fail on ANY drift — an extra file on disk, or a declared file that
// has gone missing — naming the offending slug so the break is actionable.

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const registryPath = join(root, 'registry/frozen-commands.json');
const commandsDir = join(root, 'commands');

const registry = JSON.parse(readFileSync(registryPath, 'utf8'));

const FROZEN_ALIAS_SLUGS = ['plan', 'ship', 'design', 'sync', 'dashboard'];

function onDiskSlugs() {
  return readdirSync(commandsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -'.md'.length))
    .sort();
}

function registrySlugs() {
  return registry.commands.map((entry) => entry.slug).sort();
}

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

test('frozen surface: on-disk commands/*.md set equals the frozen registry set', () => {
  const disk = onDiskSlugs();
  const declared = registrySlugs();

  // Directional diff #1 — a command file appeared that the freeze does not permit.
  // This is the guard that makes shipping a new workflow as a command impossible.
  const extraOnDisk = disk.filter((slug) => !declared.includes(slug));
  assert.deepEqual(
    extraOnDisk,
    [],
    `commands/ contains file(s) not in the frozen list: ${extraOnDisk.join(', ') || '(none)'}. `
      + 'The alias surface is frozen — new workflows ship as skills, never as commands.',
  );

  // Directional diff #2 — a frozen command was removed from disk without updating the registry.
  const missingFromDisk = declared.filter((slug) => !disk.includes(slug));
  assert.deepEqual(
    missingFromDisk,
    [],
    `frozen registry declares command(s) missing from commands/: ${missingFromDisk.join(', ') || '(none)'}.`,
  );

  // Exact-set equality (both directions collapsed) as the final backstop.
  assert.deepEqual(disk, declared, 'on-disk command slug set must exactly equal the frozen registry set');
});
