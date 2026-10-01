import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { AdapterError } from './generic.mjs';

// Native file tools receive only the exact private capsule directory.
// Never allow the private run root, profile directory, or an arbitrary path here.
export async function capsuleDirectory(path) {
  if (
    typeof path !== 'string' ||
    !isAbsolute(path) ||
    basename(path) !== 'capsule.json' ||
    basename(dirname(path)) !== 'capsule'
  ) {
    throw new AdapterError(
      'E_ADAPTER_ARGUMENTS',
      'Adapter requires an exact private capsule path.',
    );
  }
  try {
    const [physical, directory, file, folder] = await Promise.all([
      realpath(path),
      realpath(dirname(path)),
      lstat(path),
      lstat(dirname(path)),
    ]);
    if (
      physical !== join(directory, 'capsule.json') ||
      !file.isFile() ||
      !folder.isDirectory() ||
      file.size > 32 * 1024 * 1024 ||
      (file.mode & 0o077) !== 0 ||
      (folder.mode & 0o077) !== 0 ||
      (process.getuid && (file.uid !== process.getuid() || folder.uid !== process.getuid()))
    ) {
      throw new Error('invalid capsule');
    }
    return directory;
  } catch (error) {
    throw new AdapterError(
      'E_ADAPTER_ARGUMENTS',
      'Adapter capsule path is not a private regular file.',
      { cause: error.code ?? error.name },
    );
  }
}
