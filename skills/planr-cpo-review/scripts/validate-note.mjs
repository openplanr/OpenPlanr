#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectOperateReviewNote } from './operate-review-note.mjs';

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

export async function runOperateReviewNoteValidator(argv = process.argv.slice(2)) {
  const file = argv[0];
  if (!file) throw new Error('Usage: validate-note.mjs <markdown> --profile <profile> [--contract-version <version>]');
  const result = inspectOperateReviewNote(await readFile(resolve(file), 'utf8'), {
    profile: option(argv, '--profile', 'board-report'),
    contractVersion: option(argv, '--contract-version', 'auto'),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runOperateReviewNoteValidator().catch((error) => {
    process.stderr.write(`${error.code ?? 'E_OPERATE_NOTE'}: ${error.message}\n`);
    process.exitCode = 1;
  });
}
