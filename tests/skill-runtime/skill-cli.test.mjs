import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertPinServesSkills,
  fillSkillCliTokens,
  readSkillCliContracts,
  SKILL_CLI_CONTRACTS,
  SKILL_CLI_MINIMUM,
} from '../../scripts/skills/skill-cli.mjs';

test('the minimum is the newest contract version any runtime command needs', () => {
  assert.equal(SKILL_CLI_MINIMUM, '3.7.0');
  assert.deepEqual(SKILL_CLI_CONTRACTS['sync tracker'], { contract: 1, since: '3.7.0' });
  assert.deepEqual(
    readSkillCliContracts({
      a: { contracts: { 1: '3.7.0', 2: '3.9.0' } },
      b: { contracts: { 1: '3.8.0' } },
    }),
    { a: { contract: 2, since: '3.9.0' }, b: { contract: 1, since: '3.8.0' } },
  );
});

test('a contract change without a later CLI version is refused', () => {
  assert.throws(
    () => readSkillCliContracts({ a: { contracts: { 1: '3.7.0', 2: '3.7.0' } } }),
    /contract 2 ships in 3\.7\.0, not after contract 1/u,
  );
  assert.throws(
    () => readSkillCliContracts({ a: { contracts: { 1: '^3.7.0' } } }),
    /exact "since" version/u,
  );
  assert.throws(() => readSkillCliContracts({ a: { contracts: {} } }), /lists no contracts/u);
});

test('a release cannot pin a CLI older than its runtime skills need', () => {
  assert.throws(() => assertPinServesSkills('3.6.0', '3.7.0'), /openplanr@3\.6\.0.*3\.7\.0/u);
  assert.doesNotThrow(() => assertPinServesSkills('3.7.0', '3.7.0'));
  assert.doesNotThrow(() => assertPinServesSkills('4.0.1', '3.7.0'));
  assert.throws(() => assertPinServesSkills('not-a-version', '3.7.0'), /openplanr@not-a-version/u);
});

test('each CLI reference names its own command minimum, not the highest one', () => {
  const contracts = readSkillCliContracts({
    delegate: { contracts: { 1: '3.7.0' } },
    'sync tracker': { contracts: { 1: '3.7.0', 2: '3.8.0' } },
  });
  const text = 'Pin {{PLUGIN_VERSION}}; needs {{SKILL_CLI_MINIMUM}}.';
  assert.equal(fillSkillCliTokens(text, '3.9.0', 'delegate', contracts), 'Pin 3.9.0; needs 3.7.0.');
  assert.equal(
    fillSkillCliTokens(text, '3.9.0', 'sync tracker', contracts),
    'Pin 3.9.0; needs 3.8.0.',
  );
  assert.throws(() => fillSkillCliTokens(text, '3.9.0', undefined, contracts), /names no command/u);
  assert.throws(() => fillSkillCliTokens(text, '3.9.0', 'design', contracts), /"design"/u);
  assert.equal(fillSkillCliTokens('Pin {{PLUGIN_VERSION}}.', '3.9.0'), 'Pin 3.9.0.');
});

test('the rendered CLI references name their own command minimum', () => {
  for (const [skill, command, phrase] of [
    ['planr-sync', 'sync tracker', 'need {minimum} or later'],
    ['planr-delegate', 'delegate', 'version {minimum} or later'],
  ]) {
    const reference = readFileSync(
      join(import.meta.dirname, '../..', `skills/${skill}/references/openplanr-cli.md`),
      'utf8',
    );
    assert.ok(
      reference.includes(phrase.replace('{minimum}', SKILL_CLI_CONTRACTS[command].since)),
      skill,
    );
    assert.doesNotMatch(reference, /\{\{/u, skill);
  }
});
