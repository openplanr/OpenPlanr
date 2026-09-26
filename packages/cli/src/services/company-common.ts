export class CompanySyncError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CompanySyncError';
  }
}
/** Maps ENOENT from inspecting a held lock to null: its holder released it, so retry the link. */
export function releasedLock(error: unknown): null {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
  throw error;
}
export const DEFAULT_COMPANY_API_ORIGIN = 'https://api.openplanr.dev';
const fail = (code: string, message: string, cause?: unknown): never => {
  throw new CompanySyncError(code, message, cause === undefined ? undefined : { cause });
};
export function normalizeCompanyOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    return fail('E_COMPANY_URL', 'Supply an HTTPS company API origin.', cause);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    return fail(
      'E_COMPANY_URL',
      'Supply an HTTPS company API origin without credentials, path, or query.',
    );
  return url.origin;
}

/** Resolve the hosted OpenPlanr service unless an explicit development or self-hosted origin is supplied. */
export function resolveCompanyOrigin(value?: string): string {
  return normalizeCompanyOrigin(value ?? DEFAULT_COMPANY_API_ORIGIN);
}
