import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

import { DIAGRAM_ERROR_CODES, diagramFail } from '../errors.mjs';
import { digestBytes } from './bytes.mjs';
import { assertDiagramRenderManifest } from './manifest.mjs';
import {
  assertContainedPath,
  diagramRelativeDirectory,
} from './paths.mjs';

const DEFAULT_ABANDONED_MS = 24 * 60 * 60 * 1_000;
const SOURCE_SUFFIXES = Object.freeze({
  '.planr-diagram.json': 'ir',
  '.mmd': 'mermaid',
  '.excalidraw': 'excalidraw',
});

async function exists(target) {
  try { await access(target, constants.F_OK); return true; } catch { return false; }
}

function sourceBranch(path) {
  return Object.entries(SOURCE_SUFFIXES).find(([suffix]) => path.endsWith(suffix))?.[1] ?? null;
}

async function assertRegularFile(target) {
  const info = await lstat(target);
  if (!info.isFile()) diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Diagram output member is not a regular file.', { path: target });
}

async function ensureOwnedDirectory(target) {
  await mkdir(target, { recursive: true });
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE, 'Diagram runtime directory must be a real directory.', { path: target });
  }
}

export async function readDiagramSet(root, slug) {
  const relativeDirectory = diagramRelativeDirectory(slug);
  const directory = assertContainedPath(root, join(root, relativeDirectory));
  if (!await exists(directory)) return null;
  const info = await lstat(directory);
  if (!info.isDirectory()) diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Diagram output target is not a directory.', { path: directory });
  const manifestName = `${slug}.manifest.json`;
  const manifestPath = assertContainedPath(directory, join(directory, manifestName));
  if (!await exists(manifestPath)) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Existing diagram output has no OpenPlanr manifest.', {
      path: directory,
      repair: 'Choose a new slug or remove/move the unowned output explicitly.',
    });
  }
  await assertRegularFile(manifestPath);
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (error) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Existing diagram manifest is unreadable.', { cause: error.message });
  }
  try { assertDiagramRenderManifest(manifest, { slug }); } catch (error) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Existing diagram manifest is invalid.', { cause: error.message });
  }
  const expected = new Set([manifestName]);
  const files = new Map();
  const sourceChanges = [];
  const generatedChanges = [];
  for (const output of manifest.outputs) {
    const target = assertContainedPath(root, join(root, output.path));
    if (relative(directory, target).startsWith('..')) {
      diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_CONFLICT, 'Manifest output escapes its diagram directory.', { path: output.path });
    }
    expected.add(basename(target));
    if (!await exists(target)) {
      const branch = sourceBranch(output.path);
      (branch ? sourceChanges : generatedChanges).push({ path: output.path, reason: 'missing', branch });
      continue;
    }
    await assertRegularFile(target);
    const bytes = await readFile(target);
    const actualDigest = digestBytes(bytes);
    files.set(output.path, bytes);
    if (actualDigest !== output.digest) {
      const branch = sourceBranch(output.path);
      (branch ? sourceChanges : generatedChanges).push({ path: output.path, reason: 'digest-mismatch', branch });
    }
  }
  const unexpected = (await readdir(directory)).filter((name) => !expected.has(name));
  if (unexpected.length > 0) generatedChanges.push(...unexpected.map((name) => ({ path: `${relativeDirectory}/${name}`, reason: 'unowned' })));
  return Object.freeze({ directory, files, generatedChanges, manifest, sourceChanges });
}

export async function cleanupAbandonedDiagramStages(root, { maximumAgeMs = DEFAULT_ABANDONED_MS } = {}) {
  const stagingRoot = assertContainedPath(root, join(root, '.openplanr-diagram-staging'));
  if (!await exists(stagingRoot)) return 0;
  const stagingInfo = await lstat(stagingRoot);
  if (stagingInfo.isSymbolicLink() || !stagingInfo.isDirectory()) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE, 'Diagram staging root must be a real directory.', { path: stagingRoot });
  }
  let removed = 0;
  for (const entry of await readdir(stagingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const target = assertContainedPath(stagingRoot, join(stagingRoot, entry.name));
    const info = await stat(target);
    if (Date.now() - info.mtimeMs <= maximumAgeMs) continue;
    await rm(target, { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

export async function recoverInterruptedDiagramPromotion(root, slug) {
  const diagramsRoot = assertContainedPath(root, join(root, 'diagrams'));
  if (!await exists(diagramsRoot)) return false;
  const diagramsInfo = await lstat(diagramsRoot);
  if (diagramsInfo.isSymbolicLink() || !diagramsInfo.isDirectory()) {
    diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE, 'Diagram output collection must be a real directory.', { path: diagramsRoot });
  }
  const finalDirectory = assertContainedPath(diagramsRoot, join(diagramsRoot, slug));
  if (await exists(finalDirectory)) return false;
  const prefix = `.${slug}.backup-`;
  const backups = (await readdir(diagramsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(prefix))
    .map((entry) => assertContainedPath(diagramsRoot, join(diagramsRoot, entry.name)))
    .sort();
  if (backups.length !== 1) return false;
  await rename(backups[0], finalDirectory);
  return true;
}

async function setsAreEqual(current, files) {
  if (!current || current.manifest.outputs.length + 1 !== files.size) return false;
  for (const [name, bytes] of files) {
    const target = join(current.directory, name);
    if (!await exists(target)) return false;
    const existing = await readFile(target);
    if (!existing.equals(bytes)) return false;
  }
  return true;
}

export async function promoteDiagramSet(root, slug, contentId, files, { current = null } = {}) {
  const stagingRoot = assertContainedPath(root, join(root, '.openplanr-diagram-staging'));
  await ensureOwnedDirectory(stagingRoot);
  const nonce = randomBytes(8).toString('hex');
  const stageDirectory = assertContainedPath(stagingRoot, join(stagingRoot, `${slug}-${contentId.slice(0, 16)}-${nonce}`));
  await mkdir(stageDirectory);
  try {
    for (const [name, bytes] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (basename(name) !== name) diagramFail(DIAGRAM_ERROR_CODES.OUTPUT_ESCAPE, 'Staged diagram members must be direct filenames.', { name });
      const target = assertContainedPath(stageDirectory, join(stageDirectory, name));
      await writeFile(target, bytes, { flag: 'wx' });
      if (digestBytes(await readFile(target)) !== digestBytes(bytes)) throw new Error(`Staged byte verification failed: ${name}`);
    }
    if (await setsAreEqual(current, files)) return Object.freeze({ status: 'unchanged', directory: current.directory });
    const diagramsRoot = assertContainedPath(root, join(root, 'diagrams'));
    await ensureOwnedDirectory(diagramsRoot);
    const finalDirectory = assertContainedPath(diagramsRoot, join(diagramsRoot, slug));
    const backupDirectory = assertContainedPath(diagramsRoot, join(diagramsRoot, `.${slug}.backup-${nonce}`));
    const replacing = await exists(finalDirectory);
    if (replacing) await rename(finalDirectory, backupDirectory);
    try {
      await rename(stageDirectory, finalDirectory);
    } catch (error) {
      if (replacing && await exists(backupDirectory) && !await exists(finalDirectory)) await rename(backupDirectory, finalDirectory);
      throw error;
    }
    if (replacing) await rm(backupDirectory, { recursive: true, force: true });
    return Object.freeze({ status: replacing ? 'replaced' : 'created', directory: finalDirectory });
  } finally {
    if (await exists(stageDirectory)) await rm(stageDirectory, { recursive: true, force: true });
  }
}
