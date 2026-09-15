const PUBLIC_CODE = /^(?:E_[A-Z0-9_]+|[A-Z][A-Z0-9_]+|commander\.[A-Za-z0-9.]+)$/u;
const SYSTEM_CODES = new Set([
  'EACCES',
  'EISDIR',
  'EMFILE',
  'ENFILE',
  'ENOENT',
  'ENOTDIR',
  'EPERM',
]);
const MAX_PUBLIC_TEXT = 1_000;

export type CliFailureEnvelope = {
  ok: false;
  code: string;
  problem: string;
  recovery?: string;
  missing?: string[];
  diagnostics?: Array<{ path: string; rule: string; detail: string }>;
};

function boundedPublicText(value: unknown, fallback: string): string {
  const source = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return source
    .split(/\n\s*at\s/u, 1)[0]
    .replace(/(?:[A-Za-z]:\\|\/)(?:[^\s"'`,:]+[\\/])*[^\s"'`,:]*/gu, '<path>')
    .slice(0, MAX_PUBLIC_TEXT);
}

export class CliBoundaryError extends Error {
  readonly code: string;
  readonly recovery?: string;
  readonly missing?: string[];

  constructor(
    code: string,
    problem: string,
    options: { cause?: unknown; recovery?: string; missing?: string[] } = {},
  ) {
    super(problem, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = code;
    this.code = code;
    this.recovery = options.recovery;
    this.missing = options.missing;
  }

  toJSON(): CliFailureEnvelope {
    return {
      ok: false,
      code: this.code,
      problem: this.message,
      ...(this.recovery ? { recovery: this.recovery } : {}),
      ...(this.missing?.length ? { missing: [...this.missing] } : {}),
    };
  }
}

/** Convert any command failure into the one bounded public CLI envelope. */
export function toCliFailureEnvelope(
  error: unknown,
  fallback: Readonly<{ code?: string; problem?: string }> = {},
): CliFailureEnvelope {
  const record =
    error !== null && typeof error === 'object'
      ? (error as {
          code?: unknown;
          name?: unknown;
          message?: unknown;
          errno?: unknown;
          path?: unknown;
          syscall?: unknown;
          recovery?: unknown;
          fix?: unknown;
          missing?: unknown;
          details?: unknown;
          toJSON?: () => unknown;
        })
      : null;
  const declared = typeof record?.toJSON === 'function' ? record.toJSON() : record;
  const candidate =
    declared !== null && typeof declared === 'object'
      ? (declared as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const rawCode = [candidate.code, record?.code, record?.name, fallback.code].find(
    (value): value is string => typeof value === 'string' && PUBLIC_CODE.test(value),
  );
  const systemFailure =
    typeof record?.errno === 'number' ||
    typeof record?.path === 'string' ||
    typeof record?.syscall === 'string' ||
    (typeof rawCode === 'string' && SYSTEM_CODES.has(rawCode));
  const code = !systemFailure && rawCode ? rawCode : (fallback.code ?? 'E_CLI_UNEXPECTED');
  const problem = boundedPublicText(
    !systemFailure ? (candidate.problem ?? record?.message) : undefined,
    fallback.problem ?? 'The command failed unexpectedly.',
  );
  const recoveryValue = candidate.recovery ?? candidate.fix ?? record?.recovery;
  const rawMissing = candidate.missing ?? record?.missing;
  const missing = Array.isArray(rawMissing)
    ? rawMissing
        .filter(
          (value: unknown): value is string =>
            typeof value === 'string' && /^[a-z][A-Za-z0-9]{0,63}$/u.test(value),
        )
        .slice(0, 16)
    : [];
  const rawDetails = candidate.details ?? record?.details;
  const detailRecord =
    rawDetails !== null && typeof rawDetails === 'object'
      ? (rawDetails as Record<string, unknown>)
      : {};
  const rawDiagnostics = Array.isArray(detailRecord.diagnostics)
    ? detailRecord.diagnostics
    : Array.isArray(detailRecord.errors)
      ? detailRecord.errors
      : [];
  const diagnostics = rawDiagnostics
    .flatMap((diagnostic): Array<{ path: string; rule: string; detail: string }> => {
      if (diagnostic === null || typeof diagnostic !== 'object') return [];
      const value = diagnostic as Record<string, unknown>;
      if (
        typeof value.path !== 'string' ||
        typeof value.rule !== 'string' ||
        typeof value.detail !== 'string'
      )
        return [];
      if (!value.path.startsWith('$') || !/^[A-Za-z0-9:$._-]+$/u.test(value.rule)) return [];
      return [
        {
          path: value.path.slice(0, 256),
          rule: value.rule.slice(0, 64),
          detail: boundedPublicText(value.detail, 'The value is invalid.'),
        },
      ];
    })
    .slice(0, 16);
  return {
    ok: false,
    code,
    problem,
    ...(typeof recoveryValue === 'string' && recoveryValue.trim()
      ? { recovery: boundedPublicText(recoveryValue, 'Run command help and retry.') }
      : {}),
    ...(missing.length ? { missing } : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
  };
}
