import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';
import { assertContainedPath } from './paths.mjs';

const DEFAULT_STALE_MS = 5 * 60 * 1_000;

async function removeIfStale(lockPath, staleMs) {
  try {
    const info = await lstat(lockPath);
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
    if (Date.now() - info.mtimeMs <= staleMs) return false;
    await rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    return false;
  }
}

export async function acquireDiagramLock(root, slug, { staleMs = DEFAULT_STALE_MS } = {}) {
  const lockRoot = assertContainedPath(root, join(root, '.openplanr-diagram-locks'));
  const lockPath = assertContainedPath(lockRoot, join(lockRoot, `${slug}.lock`));
  await mkdir(lockRoot, { recursive: true });
  const lockRootInfo = await lstat(lockRoot);
  if (lockRootInfo.isSymbolicLink() || !lockRootInfo.isDirectory()) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE, 'Diagram lock root must be a real directory.', { path: lockRoot });
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, { flag: 'wx' });
      return Object.freeze({
        path: lockPath,
        async release() {
          await rm(lockPath, { recursive: true, force: true });
        },
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (attempt === 0 && await removeIfStale(lockPath, staleMs)) continue;
      let owner = null;
      try { owner = JSON.parse(await readFile(join(lockPath, 'owner.json'), 'utf8')); } catch { /* bounded diagnostic only */ }
      diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_LOCKED, `Diagram output is already locked: ${slug}`, {
        slug,
        ownerPid: owner?.pid ?? null,
        repair: 'Wait for the active render to finish or retry after the stale-lock interval.',
      });
    }
  }
  throw new Error('Unreachable diagram lock state.');
}

export async function withDiagramLock(root, slug, operation) {
  const lock = await acquireDiagramLock(root, slug);
  try {
    await new Promise((resolve) => setImmediate(resolve));
    return await operation();
  } finally {
    await lock.release();
  }
}
