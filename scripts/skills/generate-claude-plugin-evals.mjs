#!/usr/bin/env node

/**
 * Generates the `claude plugin eval` routing suite from routing-corpus cases that set `claudePluginEval`.
 * Run as `node scripts/skills/generate-claude-plugin-evals.mjs --write` or `--check` (fails if stale).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PLUGIN_EVAL_DIR = 'evaluation/claude-plugin-evals';
export const PLUGIN_DIR = 'dist/plugins/claude/openplanr';
const CORPUS_PATH = 'evaluation/skills/routing-corpus.json';
const REGISTRY_PATH = 'skills/registry.json';
const RESULTS_DIR = 'results';

const pluginSkillName = (skillId) => `planr:${skillId.replace(/^planr-/u, '')}`;
const skillPattern = (skillId) => `"skill"\\s*:\\s*"${pluginSkillName(skillId)}"`;

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
    const unknown = Object.keys(options).filter((key) => key !== 'rivalSkillId');
    if (unknown.length) fail(`case ${fixture.id}: unknown claudePluginEval keys ${unknown}.`);
    if (!/^[a-z0-9-]+$/u.test(fixture.id)) fail(`case ${fixture.id}: id is not a directory name.`);
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

// Without `arm: both`, a Skill grader is an unscored indicator in a two-arm run,
// so a case would pass even when the expected skill never fires.
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

/** Renders the suite as a map of eval-dir-relative paths to file contents. */
export function renderPluginEvalFiles(cases) {
  const files = new Map();
  for (const fixture of cases) {
    const caseDir = join(PLUGIN_EVAL_DIR, fixture.id);
    const plugin = relative(caseDir, PLUGIN_DIR);
    files.set(
      join(fixture.id, 'prompt.md'),
      [
        '---',
        `description: Generated from ${CORPUS_PATH} case ${fixture.id}.`,
        'max_turns: 3',
        'allowed_tools: [Read, Glob, Grep, Skill]',
        `plugins: ["${plugin}"]`,
        '---',
        '',
        fixture.input,
        '',
      ].join('\n'),
    );
    if (fixture.expectedSkillId === undefined) {
      files.set(
        join(fixture.id, 'graders', 'no-planr-skill.md'),
        skillGrader({ skillPatternSource: '"skill"\\s*:\\s*"planr:', min: 0, max: 0 }),
      );
      continue;
    }
    const { rivalSkillId } = fixture.claudePluginEval;
    files.set(
      join(fixture.id, 'graders', `${fixture.expectedSkillId}-fires.md`),
      skillGrader({ skillPatternSource: skillPattern(fixture.expectedSkillId) }),
    );
    files.set(
      join(fixture.id, 'graders', `${rivalSkillId}-does-not-fire.md`),
      skillGrader({ skillPatternSource: skillPattern(rivalSkillId), min: 0, max: 0 }),
    );
  }
  return files;
}

function listFiles(directory, prefix = '') {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(prefix, entry.name);
    if (!prefix && entry.name === RESULTS_DIR) return [];
    return entry.isDirectory() ? listFiles(join(directory, entry.name), path) : [path];
  });
}

/** Builds the expected suite for a repository root. */
export function buildPluginEvalSuite(root = repoRoot) {
  const read = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  return renderPluginEvalFiles(
    selectPluginEvalCases({ corpus: read(CORPUS_PATH), registry: read(REGISTRY_PATH) }),
  );
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
