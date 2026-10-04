/** Committed document state and atomic filesystem recovery, independent of rendering. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { isProcessAlive } from '@openplanr/artifact/internal/server-util.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}
export function atomicJson(path, value) {
  atomicBytes(path, json(value));
}
function atomicBytes(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Recover the compatibility projection after a dead publisher; current.json is authoritative. */
export function recoverDesignPublication(root, { ownsRenderLock = false } = {}) {
  const journalPath = join(root, '.design/publication.json');
  let journal = readJson(journalPath, null);
  if (!journal) return;
  const lockPath = join(root, '.design/render.lock');
  let recoveryOwner;
  if (!ownsRenderLock) {
    const lock = readJson(lockPath, null);
    if (lock && isProcessAlive(lock.pid)) return;
    if (lock) rmSync(lockPath, { force: true });
    recoveryOwner = randomUUID();
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx', 0o600);
      writeFileSync(
        descriptor,
        json({ pid: process.pid, owner: recoveryOwner, createdAt: Date.now() }),
      );
    } catch (error) {
      if (error.code === 'EEXIST') return;
      throw error;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  }
  try {
    journal = readJson(journalPath, null);
    if (!journal) return;
    const pointer = readJson(join(root, '.design/current.json'), null);
    const manifestPath = join(root, 'finalized.json');
    if (pointer?.revision === journal.revision) atomicJson(manifestPath, journal.manifest);
    else if ((pointer?.revision ?? null) === journal.previousRevision) {
      if (journal.previousManifest === null) rmSync(manifestPath, { force: true });
      else atomicBytes(manifestPath, Buffer.from(journal.previousManifest, 'base64'));
    } else if (pointer?.revision && /^[a-f0-9]{64}$/u.test(pointer.revision)) {
      atomicJson(
        manifestPath,
        readJson(join(root, '.design/revisions', pointer.revision, 'render.json')).manifest,
      );
    } else
      throw new Error('Design publication recovery could not identify the committed revision.');
    rmSync(journalPath, { force: true });
  } finally {
    if (recoveryOwner && readJson(lockPath, null)?.owner === recoveryOwner)
      rmSync(lockPath, { force: true });
  }
}
export function designSpecPath(root) {
  return /(?:^|\/)output\/feats\/feat-[^/]+\/design$/u.test(root.replaceAll('\\', '/'))
    ? join(dirname(root), 'design-spec.md')
    : join(root, 'design-spec.md');
}
export function currentDesign(file, { recoverPublication = true } = {}) {
  // Review reads the committed revision even while an author is midway through
  // replacing the editable JSON, or its next draft is temporarily invalid.
  const root = realpathSync(dirname(resolve(file)));
  if (recoverPublication) recoverDesignPublication(root);
  else {
    try {
      lstatSync(join(root, '.design/publication.json'));
      throw Object.assign(
        new Error(
          'Design publication state is pending or needs recovery. Finish or recover it with the Design utility; repair or restore an invalid .design/publication.json before retrying Plan handoff inspection.',
        ),
        { code: 'E_DESIGN_PUBLICATION_PENDING', statusCode: 409 },
      );
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const pointer = readJson(join(root, '.design/current.json'), null);
  if (!pointer || !/^[a-f0-9]{64}$/u.test(pointer.revision))
    throw new Error('Design has no completed render. Run the render utility first.');
  const directory = join(root, '.design/revisions', pointer.revision);
  const prepared = readJson(join(directory, 'render.json'));
  return {
    ...prepared,
    root,
    directory,
    file: resolve(file),
    verification: readJson(join(root, '.design/verification', `${pointer.revision}.json`), {
      status: 'unverified',
      revision: pointer.revision,
    }),
  };
}
