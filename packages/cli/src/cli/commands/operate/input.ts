import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type OperateCommandOptions = {
  json?: boolean;
  scope?: string;
  cycle?: string;
  domain?: string;
  domainVersion?: string;
  focus?: string;
  actor?: string;
  actorKind?: 'agent' | 'human';
  runtime?: string;
  assignment?: string;
  submission?: string;
  mediaType?: string;
  encoding?: 'utf-8' | 'binary';
  contentBase64?: string;
  contentFile?: string;
  framingJson?: string;
  framingFile?: string;
  representation?: 'raw' | 'canonical' | 'metadata' | 'decoded-json';
  owner?: string;
  route?: 'contained-execution' | 'planning-work' | 'human-external' | 'observe-only';
  choice?: string;
  choiceHash?: string;
  format?: 'json' | 'html';
  port?: string;
  watch?: boolean;
  confirm?: string;
};

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,127}$/u;
const UNSAFE_SYSTEM_ERROR_CODES = new Set([
  'EACCES',
  'EISDIR',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOTDIR',
  'EPERM',
]);

/**
 * Typed CLI boundary error. The original failure remains available as `cause`,
 * while `toJSON` deliberately exposes only the stable code and public problem.
 */
export class OperateCommandBoundaryError extends Error {
  readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'E_OPERATE_COMMAND_FAILED';
    this.code = code;
  }

  toJSON(): { ok: false; code: string; problem: string } {
    return { ok: false, code: this.code, problem: this.message };
  }
}

export function normalizeOperateCommandError(
  error: unknown,
  fallback: Readonly<{ code: string; message: string }>,
): OperateCommandBoundaryError {
  if (error instanceof OperateCommandBoundaryError) return error;
  const candidate =
    error !== null && typeof error === 'object'
      ? (error as {
          code?: unknown;
          message?: unknown;
          errno?: unknown;
          path?: unknown;
          syscall?: unknown;
        })
      : null;
  const candidateCode = typeof candidate?.code === 'string' ? candidate.code : '';
  const systemFailure =
    typeof candidate?.errno === 'number' ||
    typeof candidate?.path === 'string' ||
    typeof candidate?.syscall === 'string';
  const preserveTypedFailure =
    !systemFailure &&
    SAFE_ERROR_CODE.test(candidateCode) &&
    !UNSAFE_SYSTEM_ERROR_CODES.has(candidateCode);
  return new OperateCommandBoundaryError(
    preserveTypedFailure ? candidateCode : fallback.code,
    preserveTypedFailure && typeof candidate?.message === 'string' && candidate.message.trim()
      ? candidate.message
      : fallback.message,
    error,
  );
}

/** Read exact bytes from a path or stdin without re-encoding submission content. */
export async function readOperateContentInput(source: string): Promise<Buffer> {
  if (source !== '-') {
    try {
      return await readFile(resolve(source));
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
      throw new OperateCommandBoundaryError(
        missing ? 'E_OPERATE_CONTENT_FILE_NOT_FOUND' : 'E_OPERATE_CONTENT_FILE_UNREADABLE',
        missing
          ? 'The Operate content file does not exist.'
          : 'The Operate content file could not be read.',
        error,
      );
    }
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (error) {
    throw new OperateCommandBoundaryError(
      'E_OPERATE_CONTENT_STDIN_UNREADABLE',
      'Operate content could not be read from standard input.',
      error,
    );
  }
}

function invalidPlanningInput(message: string, cause?: unknown): Error {
  return Object.assign(new Error(message), {
    code: 'E_OPERATE_PLANNING_INVALID',
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Parse exact Planning framing. File/stdin bytes are decoded with a fatal UTF-8
 * decoder, and object keys are intentionally left untouched for closed-contract
 * validation by the Operate service.
 */
export async function readOperateFramingInput(
  options: OperateCommandOptions,
): Promise<Record<string, unknown> | undefined> {
  const inline = options.framingJson;
  const file = options.framingFile;
  if (inline === undefined && file === undefined) return undefined;

  let parsed: unknown;
  try {
    const source =
      inline ??
      new TextDecoder('utf-8', { fatal: true }).decode(await readOperateContentInput(file ?? ''));
    parsed = JSON.parse(source);
  } catch (error) {
    throw invalidPlanningInput('Planning framing must be valid UTF-8 JSON.', error);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidPlanningInput('Planning framing must be a closed JSON object.');
  }
  return parsed as Record<string, unknown>;
}
