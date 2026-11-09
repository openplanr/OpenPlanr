import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPinServesSkills,
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
