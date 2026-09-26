#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMAND_PREFIX =
  /^(?:npm|npx|pnpm|yarn|bun|node|deno|cargo|go|make|just|pytest|python(?:3)?\s+-m|dotnet|mvn|gradle|\.\/gradlew)\b/u;
const SCRIPT_PRIORITY = Object.freeze([
  'test',
  'test:unit',
  'test:integration',
  'typecheck',
  'check',
  'lint',
  'build',
]);

function read(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
}

function commandCandidates(markdown) {
  const candidates = [];
  let order = 0;
  const fenced = markdown.matchAll(/```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)```/gu);
  for (const match of fenced) {
    const block = match[1];
    for (const line of block.split('\n').map((entry) => entry.trim())) {
      if (COMMAND_PREFIX.test(line))
        candidates.push({ command: line, index: match.index, order: order++ });
    }
  }
  for (const match of markdown.matchAll(/`([^`\n]+)`/gu)) {
    const command = match[1].trim();
    if (COMMAND_PREFIX.test(command))
      candidates.push({ command, index: match.index, order: order++ });
  }
  return candidates
    .sort((left, right) => left.index - right.index || left.order - right.order)
    .map(({ command }) => command);
}

function section(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`^## ${escaped}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'mu').exec(
    markdown,
  );
  return match?.[1] ?? '';
}

function packageManager(projectRoot) {
  if (existsSync(resolve(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(resolve(projectRoot, 'yarn.lock'))) return 'yarn';
  if (existsSync(resolve(projectRoot, 'bun.lockb')) || existsSync(resolve(projectRoot, 'bun.lock')))
    return 'bun';
  return 'npm';
}

function packageChecks(projectRoot) {
  const packagePath = resolve(projectRoot, 'package.json');
  if (!existsSync(packagePath)) return [];
  const manifest = JSON.parse(read(packagePath));
  const scripts = manifest.scripts ?? {};
  const manager = packageManager(projectRoot);
  const names = Object.keys(scripts).sort((left, right) => {
    const leftRank = SCRIPT_PRIORITY.indexOf(left);
    const rightRank = SCRIPT_PRIORITY.indexOf(right);
    if (leftRank !== rightRank)
      return (
        (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) -
        (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank)
      );
    return left.localeCompare(right);
  });
  return names
    .filter(
      (name) =>
        SCRIPT_PRIORITY.includes(name) || /^(?:test|check|lint|build|typecheck)(?::|$)/u.test(name),
    )
    .map((name) => `${manager} run ${name}`);
}

function filesBelow(directory, predicate) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => resolve(directory, entry.name))
    .sort();
}

function configuredChecks(projectRoot) {
  const paths = [
    ...filesBelow(resolve(projectRoot, '.github/workflows'), (name) => /\.ya?ml$/u.test(name)),
    ...filesBelow(resolve(projectRoot, '.husky'), (name) => !name.startsWith('.')),
    ...['.gitlab-ci.yml', '.pre-commit-config.yaml', 'Makefile', 'justfile']
      .map((name) => resolve(projectRoot, name))
      .filter(existsSync),
  ];
  return paths.flatMap((path) => {
    const content = read(path);
    const runCommands = [...content.matchAll(/^\s*(?:run|script):\s*(.+?)\s*$/gmu)]
      .map(([, command]) => command.replace(/^['"]|['"]$/gu, '').trim())
      .filter((command) => COMMAND_PREFIX.test(command));
    return [...runCommands, ...commandCandidates(content)];
  });
}

function instructionChecks(projectRoot) {
  return ['AGENTS.md', 'CLAUDE.md', '.planr/rules.md']
    .map((path) => resolve(projectRoot, path))
    .filter(existsSync)
    .flatMap((path) => commandCandidates(read(path)));
}

function uniqueChecks(groups) {
  const seen = new Set();
  return groups.flatMap(({ source, commands }) =>
    commands.flatMap((command) => {
      if (seen.has(command)) return [];
      seen.add(command);
      return [{ command, source }];
    }),
  );
}

export function discoverVerificationChecks({ projectRoot, taskPath } = {}) {
  const root = resolve(projectRoot ?? '.');
  const resolvedTask = taskPath ? resolve(root, taskPath) : null;
  const taskExists = resolvedTask ? existsSync(resolvedTask) : false;
  const taskMarkdown = taskExists ? read(resolvedTask) : '';
  const checks = uniqueChecks([
    {
      source: 'task-requirements',
      commands: commandCandidates(section(taskMarkdown, 'Test Requirements')),
    },
    { source: 'repository-instructions', commands: instructionChecks(root) },
    { source: 'package-task-runner', commands: packageChecks(root) },
    { source: 'ci-pre-commit', commands: configuredChecks(root) },
  ]);
  return Object.freeze({
    kind: 'verification-discovery',
    schemaVersion: '1.0.0',
    projectRoot: root,
    taskPath: resolvedTask,
    checks,
    diagnostics: [
      ...(resolvedTask && !taskExists ? [`Task file not found: ${resolvedTask}`] : []),
      ...(checks.length === 0
        ? [
            'No verification commands were discovered. Inspect the repository before choosing checks.',
          ]
        : []),
    ],
  });
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--project') options.projectRoot = argv[++index];
    else if (argument === '--task') options.taskPath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(discoverVerificationChecks(parseArgs(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`E_VERIFICATION_DISCOVERY: ${error.message}\n`);
    process.exitCode = 1;
  }
}
