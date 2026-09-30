import { createHash } from 'node:crypto';
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELPER_SNAPSHOT_VERSION = '1.0.0';

export class HelperSnapshotError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HelperSnapshotError';
    this.code = code;
  }
}

async function filesBelow(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new HelperSnapshotError('E_DELEGATE_HELPER_UNSAFE', 'Helper contains a symbolic link.');
    if (entry.isDirectory()) files.push(...await filesBelow(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
    else throw new HelperSnapshotError('E_DELEGATE_HELPER_UNSAFE', 'Helper contains an unsupported file.');
  }
  return files.sort();
}

async function digestTree(root) {
  const paths = await filesBelow(root);
  const hash = createHash('sha256');
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes);
  }
  return hash.digest('hex');
}

export async function snapshotHelper(runPath) {
  const source = dirname(fileURLToPath(import.meta.url));
  const directory = join(runPath, 'helper');
  await mkdir(directory, { mode: 0o700 });
  for (const path of await filesBelow(source)) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(join(source, path), target);
    await chmod(target, 0o600);
  }
  return {
    schemaVersion: HELPER_SNAPSHOT_VERSION,
    directory,
    digest: await digestTree(directory),
    runnerPath: join(directory, 'runner.mjs'),
    integrationPath: join(directory, 'integrate.mjs'),
  };
}

export async function verifiedHelper(record) {
  if (!record.helper) return null; // Existing runs predate helper pinning.
  const helper = record.helper;
  if (helper.schemaVersion !== HELPER_SNAPSHOT_VERSION ||
    helper.directory !== join(record.runPath, 'helper') ||
    helper.runnerPath !== join(helper.directory, 'runner.mjs') ||
    helper.integrationPath !== join(helper.directory, 'integrate.mjs') ||
    !/^[a-f0-9]{64}$/u.test(helper.digest ?? ''))
    throw new HelperSnapshotError('E_DELEGATE_HELPER_FORMAT', 'Recorded helper identity is invalid.');
  const physical = await realpath(helper.directory).catch(() => null);
  if (physical !== resolve(helper.directory))
    throw new HelperSnapshotError('E_DELEGATE_HELPER_UNSAFE', 'Pinned helper path has changed.');
  const info = await lstat(physical);
  if (!info.isDirectory() || (info.mode & 0o077) !== 0)
    throw new HelperSnapshotError('E_DELEGATE_HELPER_UNSAFE', 'Pinned helper directory is not private.');
  for (const path of await filesBelow(physical)) {
    const file = await lstat(join(physical, path));
    if ((file.mode & 0o077) !== 0)
      throw new HelperSnapshotError('E_DELEGATE_HELPER_UNSAFE', 'Pinned helper file is not private.');
  }
  if (await digestTree(physical) !== helper.digest)
    throw new HelperSnapshotError('E_DELEGATE_HELPER_DRIFT', 'Pinned helper changed after preparation.');
  return helper;
}
