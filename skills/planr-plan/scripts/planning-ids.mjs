#!/usr/bin/env node

import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const KINDS = Object.freeze(['SPEC', 'US', 'T']);
const EMPTY = Object.freeze({ SPEC: 1, US: 1, T: 1 });
const wait = (milliseconds) => new Promise((done) => setTimeout(done, milliseconds));
const format = (kind, value) => `${kind}-${String(value).padStart(3, '0')}`;

async function scanMaxima(root) {
  const maxima = { SPEC: 0, US: 0, T: 0 };
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const match = /^(SPEC|US|T)-(\d{3,})(?:-|\.|$)/u.exec(entry.name);
      if (match) maxima[match[1]] = Math.max(maxima[match[1]], Number(match[2]));
      if (entry.isDirectory() && !entry.name.startsWith('.')) await visit(resolve(directory, entry.name));
    }
  };
  await visit(root);
  return maxima;
}

async function readSequence(root) {
  try {
    const value = JSON.parse(await readFile(resolve(root, '.id-sequence.json'), 'utf8'));
    if (
      value.kind !== 'planning-id-sequence'
      || value.protocolVersion !== '1.7.0'
      || KINDS.some((kind) => !Number.isSafeInteger(value.next?.[kind]) || value.next[kind] < 1)
    ) throw new Error('Invalid planning ID sequence.');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function currentSequence(root) {
  const [stored, maxima] = await Promise.all([readSequence(root), scanMaxima(root)]);
  return {
    kind: 'planning-id-sequence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.7.0',
    next: Object.fromEntries(
      KINDS.map((kind) => [kind, Math.max(stored?.next[kind] ?? EMPTY[kind], maxima[kind] + 1)]),
    ),
  };
}

function parseArgs(argv) {
  const options = { root: '.planr/specs', preview: false, counts: { SPEC: 0, US: 0, T: 0 } };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--root') options.root = argv[++index];
    else if (value === '--preview') options.preview = true;
    else if (value === '--spec' || value === '--stories' || value === '--tasks') {
      const kind = value === '--spec' ? 'SPEC' : value === '--stories' ? 'US' : 'T';
      const count = Number(argv[++index]);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error(`${value} must be a non-negative integer.`);
      options.counts[kind] = count;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  return options;
}

async function reserve({ root, preview, counts }) {
  const planningRoot = resolve(root);
  if (!preview) await mkdir(planningRoot, { recursive: true });
  const run = async () => {
    const sequence = await currentSequence(planningRoot);
    const ids = Object.fromEntries(
      KINDS.map((kind) => [kind, Array.from(
        { length: counts[kind] },
        (_, index) => format(kind, sequence.next[kind] + index),
      )]),
    );
    if (!preview) {
      for (const kind of KINDS) sequence.next[kind] += counts[kind];
      const temporary = resolve(planningRoot, `.id-sequence.${process.pid}.${Date.now()}.tmp`);
      await writeFile(temporary, `${JSON.stringify(sequence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, resolve(planningRoot, '.id-sequence.json'));
    }
    return { kind: 'planning-id-reservation', schemaVersion: '1.0.0', preview, ids };
  };

  if (preview) return run();
  const lockPath = resolve(planningRoot, '.id-sequence.lock');
  let handle;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await wait(25);
    }
  }
  if (!handle) throw new Error('Timed out waiting for the planning ID allocator.');
  try {
    return await run();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

try {
  process.stdout.write(`${JSON.stringify(await reserve(parseArgs(process.argv.slice(2))), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`E_PLANNING_ID_RESERVATION: ${error.message}\n`);
  process.exitCode = 1;
}
