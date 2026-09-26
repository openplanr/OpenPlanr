#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(packageRoot, '../..');
const entrypoint = resolve(packageRoot, 'dist/cli/index.js');
const source = JSON.parse(
  readFileSync(resolve(packageRoot, 'command-boundary-source.json'), 'utf8'),
);
const outputPath = resolve(workspaceRoot, 'docs/generated/utility-command-catalog.json');
const mode = process.argv[2] === '--write' ? 'write' : 'check';

if (!existsSync(entrypoint))
  throw new Error('Build the CLI before generating its command catalog.');

function invoke(args) {
  const result = spawnSync(process.execPath, [entrypoint, ...args, '--help'], {
    cwd: packageRoot,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', NO_COLOR: '1' },
  });
  if (result.status !== 0) {
    throw new Error(`Could not inspect planr ${args.join(' ')}: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function childNames(help) {
  const lines = help.split('\n');
  const marker = lines.findIndex((line) => line === 'Commands:');
  if (marker < 0) return [];
  const block = [];
  for (const line of lines.slice(marker + 1)) {
    if (line.trim() === '') break;
    block.push(line);
  }
  return block
    .filter((line) => /^  [a-z][a-z0-9-]*(?:\s|$)/u.test(line))
    .map((line) => line.trim().split(/[\s<[]/u)[0])
    .filter((name) => name !== 'help');
}

function inventory(path = [], depth = 0) {
  if (depth > 5) throw new Error(`Command nesting exceeds five levels at ${path.join(' ')}.`);
  return childNames(invoke(path)).flatMap((name) => {
    const child = [...path, name];
    return [child.join(' '), ...inventory(child, depth + 1)];
  });
}

const activePaths = inventory();
const activeRoots = [...new Set(activePaths.map((path) => path.split(' ')[0]))].sort();
const classifiedRoots = Object.keys(source.active).sort();
if (JSON.stringify(activeRoots) !== JSON.stringify(classifiedRoots)) {
  throw new Error(
    `Active command roots are not fully classified: ${JSON.stringify({ activeRoots, classifiedRoots })}`,
  );
}
for (const retired of Object.keys(source.retired)) {
  if (activePaths.includes(retired))
    throw new Error(`Retired command is still callable: planr ${retired}`);
}

const output = `${JSON.stringify(
  {
    kind: 'openplanr-utility-command-catalog',
    schemaVersion: '1.0.0',
    protocolVersion: '1.8.0',
    semanticBoundary: 'host-agent',
    utilityBoundary: 'deterministic-cli',
    active: activePaths.map((path) => ({
      path,
      classification: source.active[path.split(' ')[0]],
    })),
    retired: Object.entries(source.retired).map(([path, classification]) => ({
      path,
      classification,
    })),
  },
  null,
  2,
)}\n`;

if (mode === 'write') writeFileSync(outputPath, output);
else if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
  throw new Error(
    'docs/generated/utility-command-catalog.json is stale; run npm run generate:command-catalog --workspace=openplanr.',
  );
}

process.stdout.write(
  `${mode === 'write' ? 'Generated' : 'Checked'} ${activePaths.length} active command paths and ${Object.keys(source.retired).length} retired paths.\n`,
);
