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

const workspace = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(root, '..'));

// The package must name exactly one planr-pipeline version it mirrors. That
// declaration is a version pin only — the byte-parity mirror below carries the
// behaviour; no engine lifecycle is reimplemented here. It must agree with the
// checkout the mirror is generated from, the CI pins, and the implementation
// note, so the compatibility claim can never silently drift from reality.
const pipelineCompatibility = packageJson.pipelineCompatibility;
const compatMatch = /^planr-pipeline@(\d+\.\d+\.\d+)$/.exec(pipelineCompatibility ?? '');
if (!compatMatch) {
  errors.push(
    `package.json must declare "pipelineCompatibility": "planr-pipeline@<version>" (got ${JSON.stringify(pipelineCompatibility)})`,
  );
} else {
  const declaredPipelineVersion = compatMatch[1];
  const siblingPackagePath = join(workspace, 'planr-pipeline', 'package.json');
  if (existsSync(siblingPackagePath)) {
    const siblingVersion = JSON.parse(readFileSync(siblingPackagePath, 'utf8')).version;
    if (siblingVersion !== declaredPipelineVersion) {
      errors.push(
        `pipelineCompatibility names planr-pipeline@${declaredPipelineVersion} but the mirrored checkout is ${siblingVersion}`,
      );
    }
  }
  for (const workflow of ['validate.yml', 'release-check.yml']) {
    const workflowPath = join(root, '.github', 'workflows', workflow);
    if (
      existsSync(workflowPath) &&
      !readFileSync(workflowPath, 'utf8').includes(`ref: v${declaredPipelineVersion}`)
    ) {
      errors.push(`${workflow} does not pin planr-pipeline ref v${declaredPipelineVersion}`);
    }
  }
  const specNotePath = join(root, 'docs', 'implementation', 'OPERATE-SPEC-008.md');
  if (
    existsSync(specNotePath) &&
    !readFileSync(specNotePath, 'utf8').includes(`planr-pipeline@${declaredPipelineVersion}`)
  ) {
    errors.push(`OPERATE-SPEC-008.md does not name planr-pipeline@${declaredPipelineVersion}`);
  }
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
  // Wrap-insensitive: the skill is a generated mirror and its paragraph
  // wrapping may change between pipeline releases without changing meaning.
  const normalize = (text) => text.replace(/\s+/g, ' ');
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
    // FR1 / FR6 — each advisor result is recorded the instant its role returns,
    // and a still-running role renews its session with the heartbeat action.
    'record each result the instant that role returns',
    'a slow lens cannot strand a finished one',
    'issue `harness heartbeat` to renew the session',
  ]) {
    if (!normalize(operateSkill).includes(normalize(required))) {
      errors.push(`planr-operate is missing boundary guidance: ${required}`);
    }
  }

  // FR1 — the recording contract must never reintroduce a batch/serial barrier
  // that waits for the whole board before recording any completed role.
  for (const barrier of [
    'record results serially',
    'record their exact results serially',
    'results serially against',
    'wait for all',
  ]) {
    if (normalize(operateSkill).includes(normalize(barrier))) {
      errors.push(`planr-operate reintroduces a batch recording barrier: ${barrier}`);
    }
  }

  // No engine lifecycle (lease/heartbeat/retry timing) may be reimplemented in
  // the skill prose — it names harness actions, it does not compute their math.
  if (/\b\d+\s*(?:ms|milliseconds?|seconds?|minutes?|hours?)\b/i.test(operateSkill)) {
    errors.push('planr-operate embeds a concrete lease/heartbeat duration; timing belongs in the engine');
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
