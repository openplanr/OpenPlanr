import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { projectedSkillName } from '../../../../scripts/skills/host-invocations.mjs';

const workspace = resolve(import.meta.dirname, '..', '..', '..', '..');

const json = (path) => JSON.parse(readFileSync(join(workspace, path), 'utf8'));
const directories = (path) => readdirSync(join(workspace, path), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

test('host packages contain every canonical Protocol 1.8 skill without extra registrations', () => {
  const catalog = json('adapters/manifests/canonical-skills.json');
  const expected = json('skills/registry.json').skills.map(({ skillId }) => skillId).sort();
  assert.equal(catalog.protocolVersion, '1.8.0');
  assert.equal(catalog.sourceFormat, 'package-v1');
  assert.equal(new Set(expected).size, expected.length);
  assert.deepEqual([...catalog.skillIds].sort(), expected);
  assert.deepEqual(catalog.aliases, []);
  for (const host of ['openai', 'claude']) {
    assert.deepEqual(
      directories(`dist/plugins/${host}/openplanr/skills`),
      expected.map(projectedSkillName).sort(),
    );
    assert.equal(existsSync(join(workspace, `dist/plugins/${host}/openplanr/commands`)), false);
    assert.equal(existsSync(join(workspace, `dist/plugins/${host}/openplanr/codex-skills`)), false);
  }
});

test('Claude package has nine native agents and pipeline-owned prompt copies never ship', () => {
  const agents = readdirSync(join(workspace, 'dist/plugins/claude/openplanr/agents'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
  assert.equal(agents.length, 9);
  const packageManifest = json('packages/pipeline/package.json');
  for (const obsolete of ['adapters', 'commands', 'plugins', 'skills']) {
    assert.equal(
      packageManifest.files.some((path) => path === obsolete || path.startsWith(`${obsolete}/`)),
      false,
      obsolete,
    );
  }
});

test('Plan and Ship packages are host-native and provider-independent', () => {
  for (const skillId of ['planr-plan', 'planr-spec', 'planr-ship']) {
    const bytes = readFileSync(join(workspace, 'skills', skillId, 'SKILL.md'), 'utf8');
    assert.doesNotMatch(
      bytes,
      /`planr\s+(?:plan|spec\s+decompose)(?:\s|`)|`planr-pipeline(?:\s|`)/iu,
    );
    assert.doesNotMatch(bytes, /ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA/iu);
    assert.match(bytes, /active\s+(?:coding\s+session|host\s+agent)|current coding session/iu);
  }
});
