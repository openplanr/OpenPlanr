#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const COMMAND = /^(?:npm|npx|pnpm|yarn|bun|node|deno|cargo|go|make|just|pytest|python(?:3)?\s+-m|dotnet|mvn|gradle|\.\/gradlew)\b/u;
const PRIORITY = Object.freeze(['test', 'test:unit', 'test:integration', 'typecheck', 'check', 'lint', 'build']);
const read = (path) => readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');

function commands(markdown) {
  const rows = [];
  for (const match of markdown.matchAll(/```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)```/gu)) {
    for (const line of match[1].split('\n').map((value) => value.trim())) {
      if (COMMAND.test(line)) rows.push(line);
    }
  }
  for (const match of markdown.matchAll(/`([^`\n]+)`/gu)) {
    const value = match[1].trim();
    if (COMMAND.test(value)) rows.push(value);
  }
  return rows;
}

function section(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'mu').exec(markdown)?.[1] ?? '';
}

function files(directory, predicate) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

function packageChecks(root) {
  const packagePath = resolve(root, 'package.json');
  if (!existsSync(packagePath)) return [];
  const scripts = JSON.parse(read(packagePath)).scripts ?? {};
  const manager = existsSync(resolve(root, 'pnpm-lock.yaml')) ? 'pnpm'
    : existsSync(resolve(root, 'yarn.lock')) ? 'yarn'
      : existsSync(resolve(root, 'bun.lock')) || existsSync(resolve(root, 'bun.lockb')) ? 'bun'
        : 'npm';
  return Object.keys(scripts)
    .filter((name) => PRIORITY.includes(name) || /^(?:test|check|lint|build|typecheck)(?::|$)/u.test(name))
    .sort((left, right) => {
      const a = PRIORITY.indexOf(left);
      const b = PRIORITY.indexOf(right);
      return (a < 0 ? 99 : a) - (b < 0 ? 99 : b) || left.localeCompare(right);
    })
    .map((name) => `${manager} run ${name}`);
}

function parseArgs(argv) {
  const options = { project: '.', task: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--project') options.project = argv[++index];
    else if (argv[index] === '--task') options.task = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function discover({ project, task }) {
  const root = resolve(project);
  const taskPath = task ? resolve(root, task) : null;
  const groups = [
    ['task-requirements', taskPath && existsSync(taskPath) ? commands(section(read(taskPath), 'Test Requirements')) : []],
    ['repository-instructions', ['AGENTS.md', 'CLAUDE.md', '.planr/rules.md'].flatMap((name) => {
      const path = resolve(root, name);
      return existsSync(path) ? commands(read(path)) : [];
    })],
    ['package-task-runner', packageChecks(root)],
    ['ci-pre-commit', [
      ...files(resolve(root, '.github/workflows'), (name) => /\.ya?ml$/u.test(name)),
      ...files(resolve(root, '.husky'), (name) => !name.startsWith('.')),
      ...['.gitlab-ci.yml', '.pre-commit-config.yaml', 'Makefile', 'justfile']
        .map((name) => resolve(root, name))
        .filter(existsSync),
    ].flatMap((path) => commands(read(path)))],
  ];
  const seen = new Set();
  const checks = groups.flatMap(([source, values]) => values.flatMap((command) => {
    if (seen.has(command)) return [];
    seen.add(command);
    return [{ command, source }];
  }));
  return {
    kind: 'verification-discovery',
    schemaVersion: '1.0.0',
    projectRoot: root,
    taskPath,
    checks,
    diagnostics: [
      ...(taskPath && !existsSync(taskPath) ? [`Task file not found: ${taskPath}`] : []),
      ...(checks.length === 0 ? ['No verification commands were discovered; inspect the repository directly.'] : []),
    ],
  };
}

try {
  process.stdout.write(`${JSON.stringify(discover(parseArgs(process.argv.slice(2))), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`E_VERIFICATION_DISCOVERY: ${error.message}\n`);
  process.exitCode = 1;
}
