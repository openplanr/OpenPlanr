#!/usr/bin/env node

/**
 * Generates the `claude plugin eval` routing suite from routing-corpus cases that set `claudePluginEval`.
 * Run as `node scripts/skills/generate-claude-plugin-evals.mjs --write` or `--check` (fails if stale).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST_PLUGIN_NAME, projectedSkillName } from './host-invocations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PLUGIN_EVAL_DIR = 'evaluation/claude-plugin-evals';
export const PLUGIN_DIR = 'dist/plugins/claude/openplanr';
const CORPUS_PATH = 'evaluation/skills/routing-corpus.json';
const REGISTRY_PATH = 'skills/registry.json';
const SCAFFOLD_DIR = 'evaluation/skills/claude-plugin-eval-scaffolds';
const OPTION_KEYS = new Set(['rivalSkillId', 'scaffold']);
const RESULTS_DIR = 'results';

const ROUTER_SKILL_ID = 'planr-openplanr';

// Claude may call a plugin skill by its bare name, so the namespace is optional.
const skillPattern = (skillIds) =>
  `"skill"\\s*:\\s*"(?:${HOST_PLUGIN_NAME}:)?(?:${skillIds.map(projectedSkillName).join('|')})"`;

function fail(message) {
  throw new Error(`E_CLAUDE_PLUGIN_EVALS: ${message}`);
}

/** Returns the opted-in corpus cases, rejecting a malformed `claudePluginEval` field. */
export function selectPluginEvalCases({ corpus, registry }) {
  const skillIds = new Set(registry.skills.map(({ skillId }) => skillId));
  const selected = corpus.cases.filter((fixture) => fixture.claudePluginEval !== undefined);
  for (const fixture of selected) {
    const options = fixture.claudePluginEval;
    if (options === null || typeof options !== 'object' || Array.isArray(options))
      fail(`case ${fixture.id}: claudePluginEval must be an object.`);
    const unknown = Object.keys(options).filter((key) => !OPTION_KEYS.has(key));
    if (unknown.length) fail(`case ${fixture.id}: unknown claudePluginEval keys ${unknown}.`);
    if (!/^[a-z0-9-]+$/u.test(fixture.id)) fail(`case ${fixture.id}: id is not a directory name.`);
    if (options.scaffold !== undefined && !/^[a-z0-9-]+\.sh$/u.test(options.scaffold))
      fail(
        `case ${fixture.id}: scaffold ${options.scaffold} must name a .sh file in ${SCAFFOLD_DIR}.`,
      );
    if (fixture.expectedSkillId === undefined) {
      if (fixture.kind !== 'negative')
        fail(`case ${fixture.id}: only negative cases may omit expectedSkillId.`);
      if (options.rivalSkillId !== undefined)
        fail(`case ${fixture.id}: a negative case asserts no skill, so it takes no rivalSkillId.`);
      continue;
    }
    if (!skillIds.has(options.rivalSkillId))
      fail(`case ${fixture.id}: rivalSkillId ${options.rivalSkillId} is not a registry skill.`);
    if (options.rivalSkillId === fixture.expectedSkillId)
      fail(`case ${fixture.id}: rivalSkillId must differ from expectedSkillId.`);
  }
  if (selected.length === 0) fail('no routing-corpus case sets claudePluginEval.');
  return selected;
}

// A case whose graders are all Skill graders is scored in full even in a two-arm run;
// `arm: both` keeps that true once a case gains a non-Skill grader.
function skillGrader({ skillPatternSource, min, max }) {
  return [
    '---',
    'type: tool_used',
    'tool: Skill',
    `input_match: '${skillPatternSource}'`,
    ...(min === undefined ? [] : [`min: ${min}`]),
    ...(max === undefined ? [] : [`max: ${max}`]),
    'arm: both',
    '---',
    '',
  ].join('\n');
}

/**
 * Renders the suite as a map of eval-dir-relative paths to file contents.
 * `skillIds` lists every registry skill; `readScaffold` returns a scaffold script's contents by file name.
 */
export function renderPluginEvalFiles(cases, { skillIds, readScaffold } = {}) {
  if (!skillIds?.length) fail('no registry skill ids were supplied.');
  const files = new Map();
  for (const fixture of cases) {
    const caseDir = posix.join(PLUGIN_EVAL_DIR, fixture.id);
    const plugin = posix.relative(caseDir, PLUGIN_DIR);
    files.set(
      posix.join(fixture.id, 'prompt.md'),
      [
        '---',
        `description: Generated from ${CORPUS_PATH} case ${fixture.id}.`,
        'max_turns: 10',
        'allowed_tools: [Read, Glob, Grep, Skill]',
        `plugins: ["${plugin}"]`,
        '---',
        '',
        fixture.input,
        '',
      ].join('\n'),
    );
    const { scaffold } = fixture.claudePluginEval;
    if (scaffold !== undefined) {
      if (!readScaffold) fail(`case ${fixture.id}: no scaffold reader was supplied.`);
      files.set(
        posix.join(fixture.id, 'case.yaml'),
        [
          'schema_version: "1.1"',
          `name: ${fixture.id}`,
          'context:',
          '  scaffold_script: scaffold.sh',
          '',
        ].join('\n'),
      );
      files.set(posix.join(fixture.id, 'scaffold.sh'), readScaffold(scaffold));
    }
    if (fixture.expectedSkillId === undefined) {
      files.set(
        posix.join(fixture.id, 'graders', 'no-planr-skill.md'),
        skillGrader({ skillPatternSource: skillPattern(skillIds), min: 0, max: 0 }),
      );
      continue;
    }
    const { rivalSkillId } = fixture.claudePluginEval;
    files.set(
      posix.join(fixture.id, 'graders', `${fixture.expectedSkillId}-fires.md`),
      skillGrader({ skillPatternSource: skillPattern([fixture.expectedSkillId]) }),
    );
    files.set(
      posix.join(fixture.id, 'graders', `${rivalSkillId}-does-not-fire.md`),
      skillGrader({ skillPatternSource: skillPattern([rivalSkillId]), min: 0, max: 0 }),
    );
    // The router hands off to the expected skill, so calling it is not a misroute.
    const otherSkillIds = skillIds.filter(
      (skillId) => skillId !== fixture.expectedSkillId && skillId !== ROUTER_SKILL_ID,
    );
    files.set(
      posix.join(fixture.id, 'graders', 'other-planr-skills-do-not-fire.md'),
      skillGrader({
        skillPatternSource: skillPattern(otherSkillIds),
        min: 0,
        max: 0,
      }),
    );
  }
  return files;
}

function listFiles(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(prefix, entry.name);
    if (!prefix && entry.name === RESULTS_DIR) return [];
    return entry.isDirectory() ? listFiles(join(directory, entry.name), path) : [path];
  });
}

/** Builds the expected suite for a repository root. */
export function buildPluginEvalSuite(root = repoRoot) {
  const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  const registry = read(REGISTRY_PATH);
  const readScaffold = (name) => {
    const path = resolve(root, SCAFFOLD_DIR, name);
    if (!existsSync(path)) fail(`scaffold ${name} does not exist in ${SCAFFOLD_DIR}.`);
    return readFileSync(path, 'utf8');
  };
  return renderPluginEvalFiles(selectPluginEvalCases({ corpus: read(CORPUS_PATH), registry }), {
    skillIds: registry.skills.map(({ skillId }) => skillId),
    readScaffold,
  });
}

/** Lists eval-dir paths whose contents differ from the expected suite. */
export function findPluginEvalDrift(root, files) {
  const directory = resolve(root, PLUGIN_EVAL_DIR);
  const drift = listFiles(directory).filter((path) => !files.has(path));
  for (const [path, content] of files) {
    const target = join(directory, path);
    if (!existsSync(target) || readFileSync(target, 'utf8') !== content) drift.push(path);
  }
  return drift.sort();
}

/** Writes the expected suite and removes case files the corpus no longer selects. */
export function writePluginEvalSuite(root, files) {
  const directory = resolve(root, PLUGIN_EVAL_DIR);
  for (const entry of existsSync(directory) ? readdirSync(directory) : [])
    if (entry !== RESULTS_DIR) rmSync(join(directory, entry), { recursive: true, force: true });
  for (const [path, content] of files) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), content);
  }
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const [mode] = process.argv.slice(2);
  try {
    if (process.argv.length !== 3 || !['--write', '--check'].includes(mode))
      fail('Use exactly one of --write or --check.');
    const files = buildPluginEvalSuite();
    if (mode === '--write') {
      writePluginEvalSuite(repoRoot, files);
      process.stdout.write(`Wrote ${files.size} files to ${PLUGIN_EVAL_DIR}.\n`);
    } else {
      const drift = findPluginEvalDrift(repoRoot, files);
      if (drift.length)
        fail(`${PLUGIN_EVAL_DIR} is stale; run npm run generate. Drift: ${drift.join(', ')}`);
      process.stdout.write(`${PLUGIN_EVAL_DIR} is current (${files.size} files).\n`);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
