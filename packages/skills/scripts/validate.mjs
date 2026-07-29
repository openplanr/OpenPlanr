import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const names = new Set();
const errors = [];
const expectedPortableSkills = new Set([
  'openplanr-unified',
  'planr-artifact',
  'planr-plan',
  'planr-design',
  'planr-ship',
  'planr-dashboard',
  'planr-sync',
  'planr-doctor',
  'planr-operate',
]);
const operateSkillPath = join(root, 'skills', 'planr-operate', 'SKILL.md');

if (packageJson.version !== marketplace.metadata?.version) {
  errors.push(
    `Version drift: package.json=${packageJson.version} marketplace=${marketplace.metadata?.version}`,
  );
}

for (const plugin of marketplace.plugins ?? []) {
  for (const relative of plugin.skills ?? []) {
    const skillPath = join(root, relative, 'SKILL.md');
    if (!existsSync(skillPath)) {
      errors.push(`Missing skill: ${relative}`);
      continue;
    }
    const text = readFileSync(skillPath, 'utf8');
    const name = text.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    if (!name) errors.push(`${relative} has no frontmatter name`);
    else if (names.has(name)) errors.push(`Duplicate skill name: ${name}`);
    else names.add(name);
    if (/CLAUDE_PLUGIN_ROOT|Sonnet|Opus|persona role-shift/.test(text)) {
      errors.push(`${relative} contains a runtime-specific portable-workflow leak`);
    }
    if (/^\s*planr-pipeline\s+/m.test(text) || /`planr-pipeline\s+[^`]+`/.test(text)) {
      errors.push(`${relative} invokes the nested planr-pipeline executable`);
    }
  }
}

for (const expected of expectedPortableSkills) {
  if (!names.has(expected)) errors.push(`Marketplace is missing portable skill: ${expected}`);
}
for (const name of names) {
  if (!expectedPortableSkills.has(name)) errors.push(`Unexpected portable skill: ${name}`);
}

if (existsSync(operateSkillPath)) {
  const operateSkill = readFileSync(operateSkillPath, 'utf8');
  const commands = operateSkill.match(/`planr[^`]*`/g) ?? [];
  for (const command of commands) {
    if (
      /^`planr\s/.test(command) &&
      !/^`planr operate(?:\s|`)/.test(command) &&
      command !== '`planr-pipeline`'
    ) {
      errors.push(`planr-operate references a non-operate command: ${command}`);
    }
  }
  for (const required of [
    'public `planr operate` command surface',
    'schema-valid `questionnaire` and `actions`',
    'preserving question IDs and declared',
    'Never add `--yes`',
    '`planr operate evidence diagnose …`',
    'Never trial-edit sources',
    'Never invoke SHIP',
    'Do not edit `.planr/operate`',
  ]) {
    if (!operateSkill.includes(required)) {
      errors.push(`planr-operate is missing boundary guidance: ${required}`);
    }
  }

  const workspace = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(root, '..'));
  const canonicalPath = join(
    workspace,
    'planr-pipeline',
    'adapters',
    'codex',
    'skills',
    'planr-operate',
    'SKILL.md',
  );
  if (existsSync(canonicalPath) && readFileSync(canonicalPath, 'utf8') !== operateSkill) {
    errors.push(`Generated planr-operate skill drifts from ${canonicalPath}`);
  }
  const questionnairePath = join(
    workspace,
    'planr-pipeline',
    'conformance',
    'fixtures',
    'guided-runtime-parity',
    'questionnaire.json',
  );
  if (existsSync(questionnairePath)) {
    const questionnaire = JSON.parse(readFileSync(questionnairePath, 'utf8'));
    for (const question of questionnaire.questions ?? []) {
      if (typeof question.label === 'string' && operateSkill.includes(question.label)) {
        errors.push(`planr-operate copies a CLI-owned question label: ${question.label}`);
      }
    }
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`FAIL ${error}\n`);
  process.exit(1);
}
process.stdout.write(`PASS ${names.size} portable skills validated\n`);
