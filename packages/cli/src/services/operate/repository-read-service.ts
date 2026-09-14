import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const BLOCKED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'generated',
  'vendor',
  '.next',
  '.cache',
]);

const SECRET_FILE_PATTERNS = Object.freeze([
  /^\.env(?:\..+)?$/u,
  /^\.npmrc$/u,
  /^\.pypirc$/u,
  /^credentials(?:\..+)?$/iu,
  /^secrets?(?:\..+)?$/iu,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/u,
  /\.(?:key|pem|p12|pfx)$/iu,
]);

const PRIVATE_OPERATE_PREFIXES = Object.freeze([
  ['.planr', 'operate', 'state'],
  ['.planr', 'operate', 'packets'],
  ['.planr', 'operate', 'archive'],
  ['.planr', 'operate-v2'],
]);

function refuse(message: string, context: Record<string, unknown> = {}): never {
  throw Object.assign(new Error(message), {
    code: 'E_OPERATE_REPOSITORY_PATH_DENIED',
    context,
  });
}

function normalizedSegments(relativePath: string): string[] {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    refuse('Repository evidence paths must be non-empty project-relative paths.');
  }
  const portable = relativePath.replaceAll('\\', '/');
  const segments = portable.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) {
    refuse('Repository evidence paths cannot traverse outside the project.', { relativePath });
  }
  return segments;
}

function startsWithSegments(value: string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => value[index] === segment);
}

function assertPublicSegments(segments: string[]): void {
  const securitySegments = segments.map((segment) => segment.normalize('NFKC').toLowerCase());
  const blocked = securitySegments.find((segment) => BLOCKED_SEGMENTS.has(segment));
  if (blocked) refuse(`Repository evidence path enters blocked tree ${blocked}.`);
  if (PRIVATE_OPERATE_PREFIXES.some((prefix) => startsWithSegments(securitySegments, prefix))) {
    refuse('Repository evidence path enters private Operate storage.');
  }
  const fileName = securitySegments.at(-1) ?? '';
  if (SECRET_FILE_PATTERNS.some((pattern) => pattern.test(fileName))) {
    refuse('Repository evidence path names a credential or secret file.');
  }
}

async function assertNoSymlink(root: string, segments: string[]): Promise<void> {
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) {
      refuse('Repository evidence paths cannot cross symbolic links.');
    }
  }
}

/**
 * Resolve one bounded repository evidence file. Adapters may grant repository.read
 * only when all reads are forced through this boundary; native shell adapters do not qualify.
 */
export async function resolveScreenedRepositoryFile(
  projectDir: string,
  relativePath: string,
): Promise<string> {
  const segments = normalizedSegments(relativePath);
  assertPublicSegments(segments);
  const root = await realpath(path.resolve(projectDir));
  await assertNoSymlink(root, segments);
  const candidate = await realpath(path.join(root, ...segments));
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    refuse('Repository evidence path resolves outside the project.');
  }
  const metadata = await stat(candidate);
  if (!metadata.isFile()) refuse('Repository evidence path must identify one regular file.');
  return candidate;
}

export async function readScreenedRepositoryText(
  projectDir: string,
  relativePath: string,
  options: { maxBytes?: number } = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? 256 * 1024;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    refuse('Repository evidence file exceeds the bounded read limit.', {
      maxBytes,
    });
  }
  const segments = normalizedSegments(relativePath);
  assertPublicSegments(segments);
  const root = await realpath(path.resolve(projectDir));
  await assertNoSymlink(root, segments);
  const target = path.join(root, ...segments);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes) {
      refuse('Repository evidence file exceeds the bounded read limit.', {
        byteLength: before.size,
        maxBytes,
      });
    }
    const resolved = await realpath(target);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      refuse('Repository evidence path resolves outside the project.');
    }
    const resolvedMetadata = await stat(resolved);
    if (resolvedMetadata.dev !== before.dev || resolvedMetadata.ino !== before.ino) {
      refuse('Repository evidence path changed while it was being opened.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      bytes.byteLength > maxBytes
    ) {
      refuse('Repository evidence file changed during the bounded read.', {
        byteLength: bytes.byteLength,
        maxBytes,
      });
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      refuse('Repository evidence text must be verified UTF-8.');
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ELOOP') {
      refuse('Repository evidence paths cannot cross symbolic links.');
    }
    throw cause;
  } finally {
    await handle?.close();
  }
  refuse('Repository evidence read did not complete.');
}

export function adapterRepositoryReadCapabilities(input: {
  adapterId: string;
  enforcesScreenedBoundary: boolean;
}): readonly string[] {
  return input.enforcesScreenedBoundary ? Object.freeze(['repository.read']) : Object.freeze([]);
}
