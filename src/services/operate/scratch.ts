import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalize, sha256Digest } from './canonical.js';
import { redactSensitiveText } from './redaction.js';
import { OperateError } from './types.js';
import type { OperatingPaths } from './workspace.js';

/**
 * FR7 (T-006): OpenPlanr-owned scratch storage.
 *
 * The reproduction lost four completed advisor analyses because the runtime
 * invented its own transport — scratch JSON under a system temp directory plus a
 * hand-written recovery script — since nothing owned scratch. This module makes
 * scratch a sanctioned, OpenPlanr-owned surface: it lives under the machine-local
 * `localRoot` (already project-and-machine-keyed), is keyed by cycle, is written
 * atomically at mode `0600`, and is recorded in a per-cycle ownership manifest.
 *
 * The manifest is the ownership proof. `cleanOperatingScratch` and
 * `listAbandonedOperatingScratch` (the doctor/`--fix` surface) ONLY ever touch
 * files a valid `openplanr-operate-scratch` manifest confirms this project wrote.
 * An arbitrary file merely present under the scratch directory is never removed —
 * a false positive there would destroy a user's unrelated data.
 */
export const OPERATING_SCRATCH_IMPLEMENTATION = 'openplanr-operate-scratch';

const SCRATCH_MANIFEST_FILE = 'manifest.json';

/**
 * Default scratch lease window, mirroring the adapter session lease default (15
 * minutes, `config.ts`). Scratch still carrying an owned manifest past this
 * window without a cleanup is scratch a session left behind by never finalizing —
 * exactly what the doctor's abandoned-scratch diagnostic reports.
 */
const DEFAULT_SCRATCH_LEASE_MS = 15 * 60 * 1_000;

/**
 * A cycle id or scratch key must be a single safe path segment: it starts with an
 * alphanumeric and contains only alphanumerics, dot, dash, or underscore. This
 * forecloses `..` traversal, a path separator, or an absolute path ever selecting
 * a write or removal target outside the project-and-machine-keyed scratch root.
 */
const SAFE_SCRATCH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeSegment(kind: 'cycle' | 'key', value: string): string {
  if (!SAFE_SCRATCH_SEGMENT.test(value) || value.includes('..')) {
    throw new OperateError(
      'E_OPERATE_PATH_ESCAPE',
      `Operating scratch ${kind} must be a single safe path segment (no separators or traversal).`,
    );
  }
  return value;
}

interface OperatingScratchManifestEntry {
  key: string;
  file: string;
  digest: `sha256:${string}`;
  bytes: number;
  writtenAt: string;
}

interface OperatingScratchManifest {
  implementation: typeof OPERATING_SCRATCH_IMPLEMENTATION;
  cycleId: string;
  createdAt: string;
  expiresAt: string;
  entries: OperatingScratchManifestEntry[];
}

function scratchCycleDir(paths: OperatingPaths, cycleId: string): string {
  return path.join(paths.scratch, assertSafeSegment('cycle', cycleId));
}

/**
 * Resolve the absolute path of one scratch file, keyed by project (via the
 * machine-local `localRoot`), cycle, and key. Never returns a path outside the
 * cycle scratch directory — both segments are validated.
 */
export function resolveOperatingScratchPath(
  paths: OperatingPaths,
  cycleId: string,
  key: string,
): string {
  return path.join(scratchCycleDir(paths, cycleId), `${assertSafeSegment('key', key)}.json`);
}

async function atomicScratchWrite(target: string, body: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, body, { mode: 0o600 });
  await rename(temporary, target);
}

async function readScratchManifest(target: string): Promise<OperatingScratchManifest | null> {
  const raw = await readFile(target, 'utf8').catch(() => null);
  if (raw === null) return null;
  let parsed: OperatingScratchManifest;
  try {
    parsed = JSON.parse(raw) as OperatingScratchManifest;
  } catch {
    return null;
  }
  // Ownership gate: only a manifest carrying the exact OpenPlanr implementation
  // tag and a well-formed entry list is ever trusted as owned scratch.
  if (
    parsed.implementation !== OPERATING_SCRATCH_IMPLEMENTATION ||
    !Array.isArray(parsed.entries) ||
    typeof parsed.expiresAt !== 'string'
  ) {
    return null;
  }
  return parsed;
}

export interface OperatingScratchWriteResult {
  /** Absolute path of the written scratch file. Internal — never emit to a log. */
  path: string;
  digest: `sha256:${string}`;
  bytes: number;
  /**
   * The only string a caller may emit to a log referencing this write. It names
   * the cycle, key, size, and content digest — never the project path, a secret,
   * or prompt/payload content — and is passed through the shared redactor so even
   * a caller that mis-supplied path-like text cannot leak a home path or secret.
   */
  logLine: string;
}

/**
 * Atomically write one scratch file at mode `0600` and record it in the cycle's
 * ownership manifest, refreshing the manifest's lease window. The payload is
 * serialized canonically; the returned `logLine` is the only log-safe reference.
 */
export async function writeOperatingScratch(input: {
  paths: OperatingPaths;
  cycleId: string;
  key: string;
  payload: unknown;
  now?: () => Date;
  leaseDurationMs?: number;
}): Promise<OperatingScratchWriteResult> {
  const cycleId = assertSafeSegment('cycle', input.cycleId);
  const key = assertSafeSegment('key', input.key);
  const dir = scratchCycleDir(input.paths, cycleId);
  const fileName = `${key}.json`;
  const target = path.join(dir, fileName);
  const body = `${canonicalize(input.payload)}\n`;
  const bytes = Buffer.byteLength(body, 'utf8');
  const digest = sha256Digest(body);
  await atomicScratchWrite(target, body);

  const nowDate = input.now?.() ?? new Date();
  const writtenAt = nowDate.toISOString();
  const expiresAt = new Date(
    nowDate.getTime() + (input.leaseDurationMs ?? DEFAULT_SCRATCH_LEASE_MS),
  ).toISOString();
  const manifestPath = path.join(dir, SCRATCH_MANIFEST_FILE);
  const existing = await readScratchManifest(manifestPath);
  const entries = [
    ...(existing?.entries.filter((entry) => entry.key !== key) ?? []),
    { key, file: fileName, digest, bytes, writtenAt },
  ].sort((left, right) => left.key.localeCompare(right.key));
  const manifest: OperatingScratchManifest = {
    implementation: OPERATING_SCRATCH_IMPLEMENTATION,
    cycleId,
    createdAt: existing?.createdAt ?? writtenAt,
    expiresAt,
    entries,
  };
  await atomicScratchWrite(manifestPath, `${canonicalize(manifest)}\n`);

  const logLine = redactSensitiveText(
    `operate scratch write cycle=${cycleId} key=${key} bytes=${bytes} digest=${digest}`,
  ).value;
  return { path: target, digest, bytes, logLine };
}

/**
 * Remove the OpenPlanr-owned scratch for one cycle. Called after a successful
 * `record`/`finalize` (the durable commit makes the scratch handoff redundant).
 *
 * Only files the cycle's owned manifest lists are unlinked, each resolved
 * strictly under the cycle scratch directory; the manifest itself is then
 * removed, and the directory is removed ONLY if it is empty. An unowned file left
 * under the directory keeps the directory and is never touched. When no valid
 * owned manifest exists, nothing is removed.
 */
export async function cleanOperatingScratch(
  paths: OperatingPaths,
  cycleId: string,
): Promise<{ removed: number }> {
  const dir = scratchCycleDir(paths, cycleId);
  const manifestPath = path.join(dir, SCRATCH_MANIFEST_FILE);
  const manifest = await readScratchManifest(manifestPath);
  if (!manifest) return { removed: 0 };
  let removed = 0;
  for (const entry of manifest.entries) {
    const fileName = path.basename(entry.file);
    const fileTarget = path.join(dir, fileName);
    // A manifest entry that resolves outside its cycle directory is ignored.
    if (path.dirname(fileTarget) !== dir) continue;
    try {
      await unlink(fileTarget);
      removed += 1;
    } catch {
      // Already gone or unremovable — not counted, never fatal.
    }
  }
  await unlink(manifestPath).catch(() => undefined);
  // rmdir refuses a non-empty directory, so any unowned residue keeps it.
  await rmdir(dir).catch(() => undefined);
  return { removed };
}

export interface AbandonedOperatingScratch {
  cycleId: string;
  dir: string;
  expiresAt: string;
  files: string[];
}

/**
 * List OpenPlanr-owned scratch left behind by a session that never finalized:
 * every cycle scratch directory carrying a valid owned manifest whose lease
 * window has lapsed. A directory with no valid owned manifest (for example an
 * unrelated file that happened to land under the scratch root) is never reported,
 * and therefore never removed by the doctor's `--fix`. In-window scratch (an
 * active dispatch) is likewise excluded.
 */
export async function listAbandonedOperatingScratch(
  paths: OperatingPaths,
  options: { now?: () => Date } = {},
): Promise<AbandonedOperatingScratch[]> {
  const nowMs = (options.now?.() ?? new Date()).getTime();
  const entries = await readdir(paths.scratch, { withFileTypes: true }).catch(() => []);
  const abandoned: AbandonedOperatingScratch[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SAFE_SCRATCH_SEGMENT.test(entry.name)) continue;
    const dir = path.join(paths.scratch, entry.name);
    const manifest = await readScratchManifest(path.join(dir, SCRATCH_MANIFEST_FILE));
    if (!manifest) continue;
    if (Date.parse(manifest.expiresAt) > nowMs) continue;
    const present: string[] = [];
    for (const item of manifest.entries) {
      const fileName = path.basename(item.file);
      const exists = await readFile(path.join(dir, fileName)).then(
        () => true,
        () => false,
      );
      if (exists) present.push(fileName);
    }
    abandoned.push({
      cycleId: manifest.cycleId,
      dir,
      expiresAt: manifest.expiresAt,
      files: present.sort(),
    });
  }
  return abandoned.sort((left, right) => left.cycleId.localeCompare(right.cycleId));
}
