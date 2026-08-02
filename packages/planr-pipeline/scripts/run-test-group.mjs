#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function collect(target) {
  const absolute = resolve(target);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
    .map((entry) => resolve(absolute, entry.name));
}

const files = process.argv.slice(2).flatMap(collect).sort();
if (files.length === 0) {
  process.stderr.write('No test files were found.\n');
  process.exit(2);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
