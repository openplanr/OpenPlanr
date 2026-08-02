import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
const pluginManifestPath = join(root, '.claude-plugin', 'plugin.json');
const pluginManifest = existsSync(pluginManifestPath)
  ? JSON.parse(readFileSync(pluginManifestPath, 'utf8'))
  : null;
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

if (!pluginManifest) {
  errors.push('Missing stable Claude plugin manifest: .claude-plugin/plugin.json');
} else {
  if (pluginManifest.$schema !== 'https://json.schemastore.org/claude-code-plugin.json') {
    errors.push('Claude plugin manifest has an invalid $schema');
  }
  if (pluginManifest.name !== 'openplanr') {
    errors.push(`Claude plugin identity drift: expected openplanr, got ${pluginManifest.name}`);
  }
  if (pluginManifest.version !== packageJson.version) {
    errors.push(
      `Version drift: package.json=${packageJson.version} plugin.json=${pluginManifest.version}`,
    );
  }
  if (pluginManifest.repository !== 'https://github.com/openplanr/skills') {
    errors.push(`Claude plugin repository drift: ${pluginManifest.repository}`);
  }
}

if ((marketplace.plugins ?? []).length !== 1 || marketplace.plugins[0]?.name !== 'openplanr') {
  errors.push('Marketplace must expose exactly one stable openplanr plugin identity');
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
    '# Planr Operate — Codex-native workflow',
    '## Default invocation',
    'planr operate inspect --json',
    'Never invoke another vendor runtime',
    'inspect the workspace first',
    'Never dump a questionnaire',
    'If the user says “find it from the project,” continue investigating',
    'CEO, CTO, CPO, CMO, COO, then',
    'flexible `analysisMarkdown` plus',
    'planr operate report',
    'planr operate drafts',
    '`runtime: codex`',
    '`crossRuntimeFallback: false`',
    'Codex advisory isolation is supported',
    'planr operate harness prepare|record|finalize|resume|cancel',
    'operating-advisor-response@1.4',
    'E_OPERATE_DRAFT_UNAPPROVED',
    'Never deploy, publish, spend',
  ]) {
    // Wrap-insensitive: the skill is a generated mirror and its paragraph
    // wrapping may change between pipeline releases without changing meaning.
    const normalize = (text) => text.replace(/\s+/g, ' ');
    if (!normalize(operateSkill).includes(normalize(required))) {
      errors.push(`planr-operate is missing boundary guidance: ${required}`);
    }
  }

  for (const retired of [
    'rolePackPointer',
    'missionPacketPointer',
    'rolePack.roleBrief.output.jsonSchema',
    'operating-advisor-response@1.2.0',
    'operating-advisor-response@1.3.0',
    'planr operate adapter prepare',
    'planr operate evidence diagnose',
    'planr operate evidence classify',
    'planr operate sources test',
    'JSON/CSV import paths',
    'dispatch-mode-override',
  ]) {
    if (operateSkill.includes(retired)) {
      errors.push(`planr-operate references retired Protocol v1.2 guidance: ${retired}`);
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
