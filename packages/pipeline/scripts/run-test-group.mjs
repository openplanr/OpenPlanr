#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

function collect(target) {
  const absolute = resolve(target);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => resolve(absolute, entry.name));
}

const SERIAL_DIRECTIVE = '// @planr-test-group serial';

function requiresSerialExecution(file) {
  const [firstLine] = readFileSync(file, 'utf8').split(/\r?\n/u, 1);
  return firstLine === SERIAL_DIRECTIVE;
}

function run(files) {
  if (files.length === 0) return 0;
  const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const targets = [];
const excluded = new Set();
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === '--exclude') {
    const path = process.argv[index + 1];
    if (!path) throw new Error('--exclude requires a test-file path');
    excluded.add(resolve(path));
    index += 1;
    continue;
  }
  targets.push(argument);
}

const files = targets
  .flatMap(collect)
  .filter((file) => !excluded.has(file))
  .sort();
if (files.length === 0) {
  process.stderr.write('No test files were found.\n');
  process.exit(2);
}

const serialFiles = [];
const parallelFiles = [];
for (const file of files) {
  (requiresSerialExecution(file) ? serialFiles : parallelFiles).push(file);
}
let status = run(parallelFiles);
for (const file of serialFiles) {
  const serialStatus = run([file]);
  if (status === 0 && serialStatus !== 0) status = serialStatus;
}
process.exit(status);
