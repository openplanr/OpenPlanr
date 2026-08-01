import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { renderArtifactThemeAssets } from '../../scripts/generate-artifact-shell.mjs';
import { renderOperatingAssets } from '../../scripts/generate-operating-assets.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('generated role and adapter tables cover the canonical registries', () => {
  const roles = JSON.parse(readFileSync(join(root, 'registry', 'roles.json'), 'utf8'));
  const adapters = JSON.parse(readFileSync(join(root, 'registry', 'adapters.json'), 'utf8'));
  const roleDocs = readFileSync(join(root, 'docs', 'generated', 'roles.md'), 'utf8');
  const adapterDocs = readFileSync(join(root, 'docs', 'generated', 'adapters.md'), 'utf8');
  for (const role of roles.roles) {
    assert.match(roleDocs, new RegExp(`\\| ${role.id.replaceAll('-', '\\-')} \\|`));
    assert.match(roleDocs, new RegExp(role.capability));
  }
  for (const adapter of adapters.adapters) {
    assert.match(adapterDocs, new RegExp(`\\| ${adapter.id} \\| ${adapter.version.replaceAll('.', '\\.')} \\|`));
    assert.match(adapterDocs, new RegExp(adapter.capabilityLevel));
    assert.equal(adapter.capabilities.artifactReview, true);
    assert.match(adapterDocs, new RegExp(adapter.entrypoints.artifact.replaceAll('$', '\\$')));
  }
});

test('generated operating adapter assets and docs match their registries byte-for-byte', () => {
  const generated = renderOperatingAssets();
  for (const [target, expected] of Object.entries(generated)) {
    assert.equal(
      readFileSync(join(root, target), 'utf8'),
      expected,
      `${target} must be regenerated with npm run generate:operating-assets`,
    );
  }

  const roles = JSON.parse(readFileSync(join(root, 'registry', 'operating-roles.json'), 'utf8'));
  const providers = JSON.parse(readFileSync(join(root, 'registry', 'operating-providers.json'), 'utf8'));
  const roleDocs = readFileSync(join(root, 'docs/generated/operating-roles.md'), 'utf8');
  const providerDocs = readFileSync(join(root, 'docs/generated/operating-providers.md'), 'utf8');
  for (const role of roles.roles) {
    assert.match(roleDocs, new RegExp(`\\| ${role.id} \\|`));
    assert.match(roleDocs, new RegExp(role.displayLabel));
    assert.match(roleDocs, new RegExp(role.allowedProposalTypes.join(', ')));
    assert.match(roleDocs, new RegExp(String(role.budgets.maxProposals)));
    assert.match(roleDocs, new RegExp(role.forbiddenRecommendationCategories[0]));
  }
  for (const provider of providers.providers) {
    assert.match(providerDocs, new RegExp(`\\| ${provider.id} \\|`));
  }

  for (const target of [
    'adapters/codex/skills/planr-operate/SKILL.md',
    'adapters/cursor/rules/openplanr-operate.mdc',
    'commands/operate.md',
  ]) {
    const asset = readFileSync(join(root, target), 'utf8');
    for (const label of ['CEO', 'CTO', 'CPO', 'CMO', 'COO', 'Chair']) {
      assert.match(asset, new RegExp(`\\b${label}\\b`), `${target} must name the ${label} lens`);
    }
    // The mandate dispatch flow: name the operating-<role> agent, point at the
    // mandate, and forbid the retired pack-mode instructions.
    assert.match(asset, /mandatePointer/, `${target} must instruct the mandate dispatch`);
    assert.doesNotMatch(asset, /rolePacks?/, `${target} must not carry retired pack-mode text`);
    assert.doesNotMatch(asset, /empty-tool\s+isolation/, `${target} must not carry empty-tool isolation text`);
    assert.match(asset, /(?:improvise|role-play)/i);
  }
});

test('operating adapter generation normalizes CRLF templates to LF', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'planr-operating-assets-'));
  const paths = [
    'package.json',
    'registry/adapters.json',
    'registry/operating-roles.json',
    'registry/operating-providers.json',
    'templates/runtime/planr-operate-skill.md.tpl',
    'templates/runtime/planr-operate-cursor.mdc.tpl',
    'templates/runtime/planr-operate-command.md.tpl',
  ];
  try {
    for (const path of paths) {
      const target = join(projectRoot, path);
      mkdirSync(dirname(target), { recursive: true });
      const bytes = readFileSync(join(root, path), 'utf8');
      writeFileSync(target, bytes.replace(/\r\n?/gu, '\n').replace(/\n/gu, '\r\n'), 'utf8');
    }
    const generated = renderOperatingAssets({ projectRoot });
    for (const target of [
      'adapters/codex/skills/planr-operate/SKILL.md',
      'adapters/cursor/rules/openplanr-operate.mdc',
      'commands/operate.md',
    ]) {
      assert.doesNotMatch(generated[target], /\r/u, `${target} must remain LF-only`);
    }
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('packaged artifact theme assets match the canonical registry byte-for-byte', () => {
  const generated = renderArtifactThemeAssets();
  for (const [target, expected] of Object.entries(generated)) {
    assert.equal(
      readFileSync(join(root, target), 'utf8'),
      expected,
      `${target} must be regenerated with npm run generate:artifact-shell`,
    );
  }
});
