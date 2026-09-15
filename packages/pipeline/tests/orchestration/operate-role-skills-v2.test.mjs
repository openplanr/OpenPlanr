import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { projectedSkillName, renderNamespacedSkill } from '../../../../scripts/skills/host-invocations.mjs';
import { fileURLToPath } from 'node:url';

import { compileOperateContractRegistry } from '../../lib/operate/contracts/compiler.mjs';
import {
  BUSINESS_EXECUTIVE_SKILL_BINDINGS,
  businessExecutiveRoles,
} from '../../lib/operate/contracts/role-skills.mjs';
import {
  deriveOperatingChairLedgerIdV2,
  deriveOperatingRoleLocalPositionIdV2,
  deriveOperatingRoleLocalRecommendationIdV2,
} from '../../lib/operate/intelligence-output-identities-v2.mjs';
import { OPERATE_CONTRACT_CATALOG_V2 } from '../../lib/protocol/generated/contract-catalog-v2.mjs';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKSPACE_ROOT = resolve(PIPELINE_ROOT, '../..');
const RETIRED_CEREMONY = /packetId|assignmentId|resultPath|templatePath|evidence-digest|idempotenc|content-base64|data\.continuation|allowedActions/iu;
const GOVERNANCE_PROSE = /Human gate|named cycle owner|correction (?:pass|loop|attempt)|retry loop|Evidence index|Audit note|receipt|sha-?256|digest-bound/iu;
const MODEL_OR_PIPELINE_SUBPROCESS = /\b(?:planr-pipeline|planr plan|planr spec decompose|ANTHROPIC_API_KEY|OPENAI_API_KEY|OLLAMA_HOST)\b/iu;

function readWorkspace(path) {
  return readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/iu);
  assert.ok(match, 'skill frontmatter exists');
  return Object.fromEntries(match[1].split('\n').map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^"|"$/gu, '')];
  }));
}

function stripCursorFrontmatter(markdown) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n\n?/u, '');
}

test('canonical Operate role skills bind every Protocol-owned executive role', () => {
  const bound = businessExecutiveRoles(OPERATE_CONTRACT_CATALOG_V2);
  assert.deepEqual(
    bound.map(({ roleId, skillName, outputFile }) => ({ roleId, skillName, outputFile })),
    BUSINESS_EXECUTIVE_SKILL_BINDINGS.map(({ roleId, skillName, outputFile }) => ({
      roleId,
      skillName,
      outputFile,
    })),
  );

  for (const binding of BUSINESS_EXECUTIVE_SKILL_BINDINGS) {
    const markdown = readWorkspace(`skills/${binding.skillName}/SKILL.md`);
    const manifest = JSON.parse(readWorkspace(`skills/${binding.skillName}/openplanr.skill.json`));
    const role = bound.find(({ roleId }) => roleId === binding.roleId).role;

    assert.equal(parseFrontmatter(markdown).name, binding.skillName);
    assert.equal(manifest.kind, 'openplanr-skill-package');
    assert.equal(manifest.protocolVersion, '1.8.0');
    assert.equal(manifest.skillId, binding.skillName);
    assert.equal(manifest.execution, 'host-agent');
    assert.ok(manifest.hosts.includes('claude-code'));
    assert.ok(manifest.hosts.includes('codex'));
    assert.ok(markdown.includes(binding.roleId), `${binding.skillName}: role identity`);
    assert.ok(markdown.split('\n').length < 220, `${binding.skillName}: progressive disclosure`);
    assert.doesNotMatch(markdown, RETIRED_CEREMONY, binding.skillName);
    assert.doesNotMatch(markdown, GOVERNANCE_PROSE, binding.skillName);
    assert.doesNotMatch(markdown, MODEL_OR_PIPELINE_SUBPROCESS, binding.skillName);

    if (role.roleKind === 'advisor') {
      const contract = readWorkspace(
        `skills/${binding.skillName}/references/operate-advisor-contract.md`,
      );
      assert.match(markdown, /references\/operate-advisor-contract\.md/u, binding.skillName);
      assert.ok(
        manifest.resources.some(({ path, kind }) => (
          path === 'references/operate-advisor-contract.md' && kind === 'reference'
        )),
        `${binding.skillName}: declares shared contract`,
      );
      assert.match(contract, /## Recommended next move/u, binding.skillName);
      assert.match(contract, /\*\*Suggested owner:\*\*/u, binding.skillName);
      assert.match(contract, /\*\*Check:\*\*/u, binding.skillName);
      assert.match(contract, /## Sources consulted/u, binding.skillName);
      assert.doesNotMatch(contract, MODEL_OR_PIPELINE_SUBPROCESS, binding.skillName);
    } else if (role.roleKind === 'challenger') {
      assert.match(markdown, /## Material exceptions/u, binding.skillName);
      assert.match(markdown, /## Decisions that still hold/u, binding.skillName);
      assert.match(markdown, /## Risks and dissent/u, binding.skillName);
    } else {
      assert.match(markdown, /## Decision queue/u, binding.skillName);
      assert.match(markdown, /## Action plan/u, binding.skillName);
      assert.match(markdown, /## Review coverage/u, binding.skillName);
    }
  }
});

test('OpenAI and Claude package canonical role skills while Cursor preserves their bodies', () => {
  for (const { skillName } of BUSINESS_EXECUTIVE_SKILL_BINDINGS) {
    const hostSkillName = projectedSkillName(skillName);
    const canonical = readWorkspace(`skills/${skillName}/SKILL.md`);
    assert.equal(
      readWorkspace(`dist/plugins/openai/openplanr/skills/${hostSkillName}/SKILL.md`),
      renderNamespacedSkill(canonical, skillName),
      `${skillName}: OpenAI projection`,
    );
    assert.equal(
      readWorkspace(`dist/plugins/claude/openplanr/skills/${hostSkillName}/SKILL.md`),
      renderNamespacedSkill(canonical, skillName),
      `${skillName}: Claude projection`,
    );
    assert.equal(
      stripCursorFrontmatter(readWorkspace(`dist/plugins/cursor/openplanr/rules/${skillName}.mdc`)),
      canonical.replace(/^---\n[\s\S]*?\n---\n\n?/u, ''),
      `${skillName}: Cursor projection`,
    );
  }
});

test('the parent Operate skill runs all seven lenses in-session and produces actions', () => {
  const parent = readWorkspace('skills/planr-operate/SKILL.md');
  assert.equal(parseFrontmatter(parent).name, 'planr-operate');
  assert.match(parent, /native structured-question UI/u);
  assert.match(parent, /Dispatch only the selected independent advisors/u);
  assert.match(parent, /in parallel when subagents are\s+available/u);
  assert.match(parent, /## Decision queue/u);
  assert.match(parent, /## Action plan/u);
  assert.match(parent, /## Risks and dissent/u);
  assert.match(parent, /## Issues/u);
  assert.match(parent, /If the directory is ignored by Git, continue locally/u);
  assert.doesNotMatch(parent, /must be un-ignored|Ask these in one message/iu);
  assert.doesNotMatch(parent, RETIRED_CEREMONY);
  assert.doesNotMatch(parent, GOVERNANCE_PROSE);
  assert.doesNotMatch(parent, MODEL_OR_PIPELINE_SUBPROCESS);

  for (const { skillName } of BUSINESS_EXECUTIVE_SKILL_BINDINGS) {
    assert.match(parent, new RegExp(`\\b${skillName}\\b`, 'u'), skillName);
  }
});

test('generated identity formulas retain exact runtime compatibility', () => {
  const assignmentId = 'asg_formula_contract_001';
  assert.equal(deriveOperatingRoleLocalPositionIdV2('analysis', assignmentId, 2), `analysis:${assignmentId}:2`);
  assert.equal(deriveOperatingRoleLocalPositionIdV2('finding', assignmentId, 3), `finding:${assignmentId}:3`);
  assert.equal(deriveOperatingRoleLocalPositionIdV2('decision', assignmentId, 4), `decision:${assignmentId}:4`);
  assert.equal(deriveOperatingRoleLocalPositionIdV2('action-hypothesis', assignmentId, 5), `action-hypothesis:${assignmentId}:5`);
  assert.equal(deriveOperatingRoleLocalRecommendationIdV2(assignmentId), `recommendation:${assignmentId}:1`);
  assert.equal(deriveOperatingChairLedgerIdV2(assignmentId), 'ldg_formula_contract_001');
  assert.throws(
    () => deriveOperatingRoleLocalPositionIdV2('foreign', assignmentId, 1),
    /declared record prefix/u,
  );
});

test('compiled Operate registry and static role bindings cannot drift', () => {
  const sourceRegistry = JSON.parse(readFileSync(
    join(PIPELINE_ROOT, 'registry/operate-v2-contracts.json'),
    'utf8',
  ));
  const expected = businessExecutiveRoles(compileOperateContractRegistry(sourceRegistry));
  assert.deepEqual(
    expected.map(({ roleId, skillName }) => [roleId, skillName]),
    BUSINESS_EXECUTIVE_SKILL_BINDINGS.map(({ roleId, skillName }) => [roleId, skillName]),
  );
});
