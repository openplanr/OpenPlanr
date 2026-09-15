import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

type CustodyOptions = Readonly<{
  code: string;
  message: string;
  requireDirectory?: boolean;
  requireFile?: boolean;
}>;

const TREE_CUSTODY_MAX_ATTEMPTS = 32;

class TreeCustodyChangedError extends Error {
  constructor() {
    super('The Operate custody tree changed while it was being inspected.');
    this.name = 'TreeCustodyChangedError';
  }
}

function custodyError(options: CustodyOptions): Error & { code: string } {
  return Object.assign(new Error(options.message), { code: options.code });
}

/**
 * Proves that every existing component below the canonical project root is a
 * real directory/file rather than a symbolic-link redirect. Missing tail
 * components are allowed so callers can validate both before and after create.
 */
export async function assertOperatePathCustody(
  projectDir: string,
  target: string,
  options: CustodyOptions,
): Promise<void> {
  const project = path.resolve(projectDir);
  const selected = path.resolve(target);
  const planrRoot = path.join(project, '.planr');
  if (selected !== planrRoot && !selected.startsWith(`${planrRoot}${path.sep}`)) {
    throw custodyError(options);
  }

  let canonicalProject: string;
  try {
    canonicalProject = await realpath(project);
  } catch {
    throw custodyError(options);
  }
  const relative = path.relative(project, selected);
  let current = canonicalProject;
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let metadata: Stats;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (metadata.isSymbolicLink()) throw custodyError(options);
    const isLeaf = index === segments.length - 1;
    if (
      (!isLeaf && !metadata.isDirectory()) ||
      (isLeaf && options.requireDirectory && !metadata.isDirectory()) ||
      (isLeaf && options.requireFile && !metadata.isFile())
    ) {
      throw custodyError(options);
    }
    const canonical = await realpath(current);
    if (canonical !== canonicalProject && !canonical.startsWith(`${canonicalProject}${path.sep}`)) {
      throw custodyError(options);
    }
  }
}

/** Reject every symbolic link or special entry already present below a private root. */
export async function assertOperateTreeCustody(
  projectDir: string,
  root: string,
  options: CustodyOptions,
): Promise<void> {
  const walk = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new TreeCustodyChangedError();
      }
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      let metadata: Stats;
      try {
        metadata = await lstat(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new TreeCustodyChangedError();
        }
        throw error;
      }
      if (metadata.isSymbolicLink()) throw custodyError(options);
      if (metadata.isDirectory()) {
        await walk(target);
      } else if (!metadata.isFile()) {
        throw custodyError(options);
      }
    }
  };

  for (let attempt = 1; attempt <= TREE_CUSTODY_MAX_ATTEMPTS; attempt += 1) {
    await assertOperatePathCustody(projectDir, root, options);
    let rootMetadata: Stats;
    try {
      rootMetadata = await lstat(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw custodyError(options);
    try {
      await walk(root);
      return;
    } catch (error) {
      if (!(error instanceof TreeCustodyChangedError)) throw error;
      if (attempt === TREE_CUSTODY_MAX_ATTEMPTS) throw custodyError(options);
    }
  }
}
