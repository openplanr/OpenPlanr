import { open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpenPlanrConfig } from '../models/types.js';
import { ensureDir } from '../utils/fs.js';

export type PlanningIdKind = 'SPEC' | 'US' | 'T';
export type PlanningIdCounts = Partial<Record<PlanningIdKind, number>>;
export type PlanningIdReservation = Record<PlanningIdKind, string[]>;

type Sequence = {
  kind: 'planning-id-sequence';
  schemaVersion: '1.0.0';
  protocolVersion: '1.7.0';
  next: Record<PlanningIdKind, number>;
};

const EMPTY = Object.freeze({ SPEC: 1, US: 1, T: 1 });
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const format = (kind: PlanningIdKind, value: number) => `${kind}-${String(value).padStart(3, '0')}`;

function specsRoot(projectDir: string, config: OpenPlanrConfig): string {
  return path.join(projectDir, config.outputPaths.agile, 'specs');
}

async function scanMaxima(root: string): Promise<Record<PlanningIdKind, number>> {
  const maxima = { SPEC: 0, US: 0, T: 0 };
  const visit = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const match = /^(SPEC|US|T)-(\d{3,})(?:-|\.|$)/u.exec(entry.name);
      if (match) {
        const kind = match[1] as PlanningIdKind;
        maxima[kind] = Math.max(maxima[kind], Number.parseInt(match[2], 10));
      }
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        await visit(path.join(directory, entry.name));
    }
  };
  await visit(root);
  return maxima;
}

async function readSequence(root: string): Promise<Sequence | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(root, '.id-sequence.json'), 'utf8'),
    ) as Sequence;
    if (
      value.kind !== 'planning-id-sequence' ||
      value.protocolVersion !== '1.7.0' ||
      (Object.keys(EMPTY) as PlanningIdKind[]).some(
        (kind) => !Number.isSafeInteger(value.next?.[kind]) || value.next[kind] < 1,
      )
    )
      throw new Error('Invalid planning ID sequence.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function currentSequence(root: string): Promise<Sequence> {
  const [stored, maxima] = await Promise.all([readSequence(root), scanMaxima(root)]);
  return {
    kind: 'planning-id-sequence',
    schemaVersion: '1.0.0',
    protocolVersion: '1.7.0',
    next: {
      SPEC: Math.max(stored?.next.SPEC ?? EMPTY.SPEC, maxima.SPEC + 1),
      US: Math.max(stored?.next.US ?? EMPTY.US, maxima.US + 1),
      T: Math.max(stored?.next.T ?? EMPTY.T, maxima.T + 1),
    },
  };
}

function idsFor(sequence: Sequence, counts: PlanningIdCounts): PlanningIdReservation {
  return Object.fromEntries(
    (Object.keys(EMPTY) as PlanningIdKind[]).map((kind) => [
      kind,
      Array.from({ length: counts[kind] ?? 0 }, (_, index) =>
        format(kind, sequence.next[kind] + index),
      ),
    ]),
  ) as PlanningIdReservation;
}

async function writeSequence(root: string, sequence: Sequence): Promise<void> {
  const destination = path.join(root, '.id-sequence.json');
  const temporary = path.join(root, `.id-sequence.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(sequence, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await rename(temporary, destination);
}

export async function previewPlanningIds(
  projectDir: string,
  config: OpenPlanrConfig,
  counts: PlanningIdCounts,
): Promise<PlanningIdReservation> {
  return idsFor(await currentSequence(specsRoot(projectDir, config)), counts);
}

/** Atomically reserve project-global IDs. Failed operations intentionally leave gaps. */
export async function reservePlanningIds(
  projectDir: string,
  config: OpenPlanrConfig,
  counts: PlanningIdCounts,
): Promise<PlanningIdReservation> {
  const root = specsRoot(projectDir, config);
  await ensureDir(root);
  const lockPath = path.join(root, '.id-sequence.lock');
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await wait(25);
    }
  }
  if (!handle) throw new Error('Timed out waiting for the planning ID allocator.');
  try {
    const sequence = await currentSequence(root);
    const reservation = idsFor(sequence, counts);
    for (const kind of Object.keys(EMPTY) as PlanningIdKind[])
      sequence.next[kind] += counts[kind] ?? 0;
    await writeSequence(root, sequence);
    return reservation;
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => undefined);
  }
}
