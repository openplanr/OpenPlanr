import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { withDocumentDigest } from '../../packages/protocol/src/canonical-json.mjs';
import { ProtocolError } from '../../packages/protocol/src/errors.mjs';
import {
  CANONICAL_REGISTRIES, getRole, resolveLegacyRoleAlias, routeLegacyTask, validateCanonicalRegistries,
} from '../../packages/protocol/src/registries.mjs';

const clone = () => structuredClone(CANONICAL_REGISTRIES);
const redigest = (value) => {
  const copy = { ...value };
  delete copy.documentDigest;
  return withDocumentDigest(copy);
};

test('role registry has exact canonical/legacy parity and fixed authority boundaries', () => {
  const roles = CANONICAL_REGISTRIES['roles.json'].roles;
  assert.equal(roles.length, 9);
  assert.deepEqual(roles.map(({ roleId }) => roleId), [
    'planr-backend', 'planr-database', 'planr-designer', 'planr-devops', 'planr-documentation',
    'planr-entity-scaffold', 'planr-frontend', 'planr-qa', 'planr-specification',
  ]);
  assert.equal(resolveLegacyRoleAlias('db-agent').roleId, 'planr-database');
  assert.equal(resolveLegacyRoleAlias('doc-gen-agent').roleId, 'planr-documentation');
  assert.equal(getRole('planr-qa').writeBoundary.repositoryAccess, 'read-only');
  assert.ok(getRole('planr-devops').writeBoundary.forbiddenEffects.includes('deploy'));
  assert.equal(getRole('planr-database').writeBoundary.externalDataAccess, 'read-only');
  assert.deepEqual(getRole('planr-backend').outputContracts, [{ id: 'implementation-result', version: '1.0.0' }]);
  assert.deepEqual(getRole('planr-frontend').outputContracts, [{ id: 'implementation-result', version: '1.0.0' }]);
  for (const roleId of ['planr-database', 'planr-devops', 'planr-documentation', 'planr-entity-scaffold', 'planr-qa']) {
    assert.deepEqual(getRole(roleId).outputContracts, [{ id: 'task-output-manifest', version: '1.0.0' }], roleId);
  }
});

test('alias collision fails with a stable typed diagnostic', () => {
  const values = clone();
  values['roles.json'].roles[1].legacyAliases[0].id = values['roles.json'].roles[0].legacyAliases[0].id;
  values['roles.json'] = redigest(values['roles.json']);
  assert.throws(() => validateCanonicalRegistries(values), (error) => (
    error instanceof ProtocolError && error.code === 'E_PROTOCOL_DUPLICATE_ID'
  ));
});

test('task-kind routing is exact and never inferred from prose', () => {
  assert.equal(routeLegacyTask({ legacyType: 'UI', legacyAgent: 'frontend-agent' }).taskKind, 'frontend');
  assert.equal(routeLegacyTask({ legacyType: 'Tech', legacyAgent: 'db-agent' }).taskKind, 'database');
  assert.equal(routeLegacyTask({ legacyType: 'Tech', legacyAgent: 'backend-agent' }).taskKind, 'backend');
  assert.equal(routeLegacyTask({ legacyType: 'Tech' }).taskKind, 'backend');
  assert.throws(() => routeLegacyTask({ legacyType: 'UI', legacyAgent: null }), (error) => error.code === 'E_PROTOCOL_REFERENCE_INVALID');
  assert.throws(() => routeLegacyTask({ legacyType: 'Tech', legacyAgent: 'qa-agent', prose: 'database' }), (error) => error.code === 'E_PROTOCOL_REFERENCE_INVALID');
  const bindings = CANONICAL_REGISTRIES['task-kinds.json'].bindings;
  for (const binding of bindings) {
    const expected = ['backend', 'frontend'].includes(binding.taskKind)
      ? 'implementation-result'
      : 'task-output-manifest';
    assert.deepEqual(binding.outputContracts, [{ id: expected, version: '1.0.0' }], binding.taskKind);
  }
});

test('catalog floors classify commands, skills, rules, and Class A-D outputs', () => {
  const commands = CANONICAL_REGISTRIES['commands.json'];
  assert.equal(commands.inventory.rootCommandModules, 39);
  assert.equal(commands.inventory.pipelineMachineLeaves, 31);
  assert.equal(commands.inventory.frozenClaudeDocuments, 8);
  assert.ok(commands.commands.some(({ argv }) => argv.length === 1 && argv[0] === 'operate'));
  assert.ok(commands.negativeContracts.some(({ forbiddenArgvPrefix }) => forbiddenArgvPrefix.join(' ') === 'pipeline operate'));
  assert.ok(!commands.commands.some(({ argv }) => argv[0] === 'pipeline' && argv[1] === 'operate'));

  const skills = CANONICAL_REGISTRIES['skills.json'];
  assert.equal(skills.skills.length, 27);
  assert.ok(skills.skills.some(({ skillId }) => skillId === 'planr-status'));
  assert.ok(skills.skills.some(({ skillId }) => skillId === 'planr-openplanr'));
  assert.ok(skills.skills.some(({ skillId }) => skillId === 'planr-design-loop'));
  assert.ok(skills.skills.some(({ skillId }) => skillId === 'planr-design-review'));
  assert.ok(skills.skills.some(({ skillId }) => skillId === 'planr-diagram'));
  assert.deepEqual(
    skills.skills.find(({ skillId }) => skillId === 'planr-ship').contracts.outputs,
    [{ id: 'implementation-result', version: '1.0.0' }],
  );
  for (const skillId of [
    'planr-ceo-review',
    'planr-chair-review',
    'planr-challenger-review',
    'planr-cmo-review',
    'planr-coo-review',
    'planr-cpo-review',
    'planr-cto-review',
  ]) {
    const skill = skills.skills.find((candidate) => candidate.skillId === skillId);
    assert.equal(skill.skillVersion, '2.0.0', skillId);
    assert.equal(skill.contracts.outputs[0].version, '2.0.0', skillId);
  }
  const operate = skills.skills.find(({ skillId }) => skillId === 'planr-operate');
  assert.equal(operate.skillVersion, '2.1.0');
  assert.equal(operate.contracts.outputs[0].version, '2.0.0');
  assert.deepEqual(skills.compatibilityAliases, []);

  assert.deepEqual(CANONICAL_REGISTRIES['rules.json'].rules.map(({ ruleId }) => ruleId), ['R1', 'R10', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']);
  assert.deepEqual([...new Set(CANONICAL_REGISTRIES['outputs.json'].outputs.map(({ outputClass }) => outputClass))].sort(), ['A', 'B', 'C', 'D']);
});

test('every declared skill CLI binding resolves to a registered command visible from root help', () => {
  const commands = CANONICAL_REGISTRIES['commands.json'];
  const byId = new Map(commands.commands.map((command) => [command.commandId, command]));
  const cli = fileURLToPath(new URL('../../packages/cli/bin/planr.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  for (const skill of CANONICAL_REGISTRIES['skills.json'].skills) {
    for (const requirement of skill.cliRequirements) {
      const command = byId.get(requirement.commandId);
      assert.ok(command, `${skill.skillId} references missing ${requirement.commandId}`);
      assert.equal(command.surface, requirement.commandId.startsWith('cli-') ? 'cli-root' : command.surface);
      assert.deepEqual(requirement.argv, command.argv, `${skill.skillId}:${requirement.commandId}`);
      assert.match(result.stdout, new RegExp(`^  ${requirement.argv[0]}(?:[ \\[]|$)`, 'mu'), skill.skillId);
    }
  }
});
