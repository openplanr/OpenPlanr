import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCompanyCommand } from '../../src/cli/commands/company.js';
import { loginCompany, logoutCompany } from '../../src/services/company-auth-service.js';
import { CompanySyncError } from '../../src/services/company-common.js';
import { logger } from '../../src/utils/logger.js';

vi.mock('../../src/services/company-auth-service.js', () => ({
  loginCompany: vi.fn(),
  logoutCompany: vi.fn(),
  storeCompanyManualToken: vi.fn(),
}));
vi.mock('../../src/utils/logger.js', () => ({
  logger: { success: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

function loginResult(
  overrides: Partial<Awaited<ReturnType<typeof loginCompany>>> = {},
): Awaited<ReturnType<typeof loginCompany>> {
  return {
    ok: true,
    action: 'company.login',
    apiUrl: 'https://api.openplanr.dev',
    status: 'signed-in',
    expiresAt: '2026-10-02T12:00:00.000Z',
    credentialStorage: 'keychain',
    environmentOverride: false,
    notice: 'Tokens are stored in the operating-system keychain.',
    ...overrides,
  };
}
function logoutResult(
  overrides: Partial<Awaited<ReturnType<typeof logoutCompany>>> = {},
): Awaited<ReturnType<typeof logoutCompany>> {
  return {
    ok: true,
    action: 'company.logout',
    apiUrl: 'https://api.openplanr.dev',
    status: 'signed-out',
    revocation: 'confirmed',
    credentialCleanup: 'confirmed',
    environmentOverride: false,
    notice: 'Stored company sign-in is disabled. This does not sign you out of the browser.',
    ...overrides,
  };
}
async function company(...args: string[]) {
  const program = new Command().exitOverride().option('--project-dir <path>', '', '/project');
  registerCompanyCommand(program);
  await program.parseAsync(['node', 'planr', 'company', ...args]);
}

const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.mocked(loginCompany).mockResolvedValue(loginResult());
  vi.mocked(logoutCompany).mockResolvedValue(logoutResult());
  process.exitCode = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

describe('company authentication output', () => {
  it('confirms a normal sign-in without dumping storage and expiry metadata', async () => {
    await company('login');
    expect(logger.success).toHaveBeenCalledWith('Signed in to OpenPlanr.');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(process.stdout.write).not.toHaveBeenCalled();
  });

  it('keeps the complete sign-in result in JSON mode and the browser URL on stderr', async () => {
    const result = loginResult();
    vi.mocked(loginCompany).mockImplementationOnce(async (_origin, options) => {
      options?.onAuthorization?.('https://identity.test/authorize');
      return result;
    });
    await company('login', '--json', '--no-open');
    expect(process.stdout.write).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify(result, null, 2) + '\n',
    );
    expect(process.stderr.write).toHaveBeenCalledWith(
      'Open this link to sign in:\nhttps://identity.test/authorize\n',
    );
    expect(loginCompany).toHaveBeenCalledWith(
      'https://api.openplanr.dev',
      expect.objectContaining({ open: false }),
    );
    expect(logger.success).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('gives a short logout instruction for an existing sign-in and keeps a failing exit', async () => {
    const error = new CompanySyncError(
      'E_COMPANY_AUTH_EXISTS',
      'Sign out first with `planr company logout`, then sign in again.',
    );
    vi.mocked(loginCompany).mockRejectedValueOnce(error);
    const signals = ['SIGINT', 'SIGTERM'] as const;
    const listeners = signals.map((signal) => process.listenerCount(signal));
    await company('login');
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(error.message);
    expect(logger.success).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(signals.map((signal) => process.listenerCount(signal))).toEqual(listeners);
  });

  it('preserves the typed existing-sign-in error for the JSON error boundary', async () => {
    const error = new CompanySyncError('E_COMPANY_AUTH_EXISTS', 'Sign out first.');
    vi.mocked(loginCompany).mockRejectedValueOnce(error);
    await expect(company('login', '--json')).rejects.toBe(error);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not hide other authorization failures', async () => {
    const error = new CompanySyncError('E_COMPANY_AUTH_REAUTH', 'Authorization expired.');
    vi.mocked(loginCompany).mockRejectedValueOnce(error);
    await expect(company('login')).rejects.toBe(error);
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.success).not.toHaveBeenCalled();
  });

  it('still discloses encrypted-file storage when the keychain is unavailable', async () => {
    const result = loginResult({
      credentialStorage: 'encrypted-file',
      notice: 'The OS keychain is unavailable. Tokens use encrypted local storage.',
    });
    vi.mocked(loginCompany).mockResolvedValueOnce(result);
    await company('login');
    expect(logger.success).toHaveBeenCalledWith('Signed in to OpenPlanr.');
    expect(logger.warn).toHaveBeenCalledWith(result.notice);
  });

  it('explains an environment override after sign-in', async () => {
    vi.mocked(loginCompany).mockResolvedValueOnce(loginResult({ environmentOverride: true }));
    await company('login');
    expect(logger.warn).toHaveBeenCalledWith(
      'PLANR_COMPANY_TOKEN is set and overrides this sign-in.',
    );
  });

  it.each(['confirmed', 'no-session'] as const)(
    'confirms a normal sign-out with %s revocation',
    async (revocation) => {
      vi.mocked(logoutCompany).mockResolvedValueOnce(logoutResult({ revocation }));
      await company('logout');
      expect(logger.success).toHaveBeenCalledExactlyOnceWith('Signed out of OpenPlanr.');
      expect(logger.warn).not.toHaveBeenCalled();
      expect(process.stdout.write).not.toHaveBeenCalled();
    },
  );

  it('keeps the complete sign-out result in JSON mode', async () => {
    const result = logoutResult();
    await company('logout', '--json');
    expect(process.stdout.write).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify(result, null, 2) + '\n',
    );
    expect(logger.success).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    {
      credentialCleanup: 'incomplete',
      notice: 'Retry logout when the credential store is available.',
    },
    {
      revocation: 'unknown',
      notice: 'Review the application authorization in the identity provider.',
    },
    { revocation: 'partially-confirmed', notice: 'Some remote authorization remains uncertain.' },
  ] as const)('retains sign-out recovery guidance: $notice', async (overrides) => {
    vi.mocked(logoutCompany).mockResolvedValueOnce(logoutResult(overrides));
    await company('logout');
    expect(logger.success).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(overrides.notice);
  });

  it('reports both skipped remote revocation and a remaining environment override', async () => {
    const result = logoutResult({
      revocation: 'not-requested',
      environmentOverride: true,
      notice: 'Local sign-in was disabled. Remote token revocation was not requested.',
    });
    vi.mocked(logoutCompany).mockResolvedValueOnce(result);
    await company('logout', '--local-only');
    expect(logoutCompany).toHaveBeenCalledWith('https://api.openplanr.dev', { localOnly: true });
    expect(logger.success).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(result.notice);
    expect(logger.warn).toHaveBeenCalledWith(
      'PLANR_COMPANY_TOKEN remains set. Unset it to finish signing out.',
    );
  });

  it('does not repeat an environment override already explained by the service', async () => {
    const result = logoutResult({
      environmentOverride: true,
      notice: 'PLANR_COMPANY_TOKEN remains set and must be unset separately.',
    });
    vi.mocked(logoutCompany).mockResolvedValueOnce(result);
    await company('logout');
    expect(logger.success).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(result.notice);
  });
});
