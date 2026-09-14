import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import {
  CompanyAuthStore,
  type CompanyCredentialStore,
  type StoredCredentialSource,
} from './company-auth-store.js';
import { CompanySyncError, normalizeCompanyOrigin } from './company-common.js';
import {
  clearCredential,
  readStoredCredential,
  removeStoredCredential,
  resolveApiKey,
  saveCredential,
  saveRecordedCredential,
} from './credentials-service.js';

const REQUIRED_SCOPES = ['openid', 'email', 'offline_access', 'user:org:read', 'openplanr:company'];
const reject = (code: string, message: string): never => {
  throw new CompanySyncError(code, message);
};
const tokenText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 16384 &&
  /^[\x21-\x7e]+$/.test(value);
const credentialProvider = (origin: string) =>
  `company-oauth:${createHash('sha256').update(origin).digest('hex')}:`;
interface AuthConfiguration {
  apiUrl: string;
  issuer: string;
  clientId: string;
  scopes: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
}
interface TokenSet {
  schemaVersion: '1.0.0';
  apiUrl: string;
  issuer: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}
interface AuthRecord extends AuthConfiguration {
  schemaVersion: '1.0.0';
  status: 'active' | 'login-pending' | 'refresh-pending' | 'reauth-required' | 'logout-pending';
  credential?: { provider: string; source: StoredCredentialSource };
  pendingProvider?: string;
  revocationConfirmed?: boolean;
}
type AuthState =
  | AuthRecord
  | { schemaVersion: '1.0.0'; apiUrl: string; status: 'signed-out' }
  | { schemaVersion: '1.0.0'; apiUrl: string; status: 'manual' };
interface LoginOptions {
  open?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  onAuthorization?: (url: string) => void | Promise<void>;
}
interface AuthDependencies {
  storage?: CompanyAuthStore;
  credentials?: CompanyCredentialStore;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => Promise<void>;
  now?: () => number;
}

function sameOriginEndpoint(value: unknown, issuer: string): string {
  if (typeof value !== 'string')
    return reject(
      'E_COMPANY_AUTH_DISCOVERY',
      'The issuer did not advertise the required OAuth endpoints.',
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return reject('E_COMPANY_AUTH_DISCOVERY', 'An OAuth endpoint is invalid.');
  }
  if (
    url.origin !== issuer ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return reject(
      'E_COMPANY_AUTH_DISCOVERY',
      'OAuth endpoints must remain on the configured HTTPS issuer origin.',
    );
  return url.href;
}
function validateScopes(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    !value.every((scope) => typeof scope === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(scope)) ||
    new Set(value).size !== value.length ||
    REQUIRED_SCOPES.some((scope) => !value.includes(scope))
  )
    return reject(
      'E_COMPANY_AUTH_SCOPE',
      'Company sign-in requires the configured identity, organization, offline and company scopes.',
    );
  // The public company contract intentionally requests this bounded permission set.
  if (value.some((scope) => !REQUIRED_SCOPES.includes(scope)))
    return reject(
      'E_COMPANY_AUTH_SCOPE',
      'The service requested unsupported additional permissions.',
    );
  return [...value];
}
function validateConfiguration(value: unknown, origin: string): AuthConfiguration {
  if (!value || typeof value !== 'object')
    return reject('E_COMPANY_AUTH_DISCOVERY', 'Company authentication configuration is invalid.');
  const config = value as AuthConfiguration;
  if (
    config.apiUrl !== origin ||
    typeof config.issuer !== 'string' ||
    !config.issuer.startsWith('https://') ||
    normalizeCompanyOrigin(config.issuer) !== config.issuer ||
    !tokenText(config.clientId) ||
    config.clientId.length > 512
  )
    return reject(
      'E_COMPANY_AUTH_DISCOVERY',
      'Company authentication issuer or client is invalid.',
    );
  return {
    ...config,
    scopes: validateScopes(config.scopes),
    authorizationEndpoint: sameOriginEndpoint(config.authorizationEndpoint, config.issuer),
    tokenEndpoint: sameOriginEndpoint(config.tokenEndpoint, config.issuer),
    revocationEndpoint: sameOriginEndpoint(config.revocationEndpoint, config.issuer),
  };
}
function validateTokens(value: unknown, config: AuthConfiguration): TokenSet {
  const tokens = value as TokenSet;
  if (
    !tokens ||
    tokens.schemaVersion !== '1.0.0' ||
    tokens.apiUrl !== config.apiUrl ||
    tokens.issuer !== config.issuer ||
    tokens.clientId !== config.clientId ||
    !tokenText(tokens.accessToken) ||
    !tokenText(tokens.refreshToken) ||
    !Number.isSafeInteger(tokens.expiresAt) ||
    tokens.expiresAt < 1
  )
    return reject(
      'E_COMPANY_AUTH_STORE',
      'The stored session is invalid. Sign out and sign in again.',
    );
  validateScopes(tokens.scopes);
  return tokens;
}

/** No shell is involved; the URL is an argument to the platform browser launcher. */
async function openBrowser(url: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
        : ['xdg-open', url];
  await new Promise<void>((resolve, failure) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: 'ignore',
      shell: false,
      detached: true,
      windowsHide: true,
    });
    child.once('error', () =>
      failure(
        new CompanySyncError(
          'E_COMPANY_AUTH_BROWSER',
          'The browser could not open. Retry with --no-open and open the printed URL on this computer.',
        ),
      ),
    );
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function callbackListener(issuer: string, state: string, options: LoginOptions) {
  let redirectUri = '';
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, rejectPromise) => {
    resolveCode = resolve;
    rejectCode = rejectPromise;
  });
  // Cancellation may race the caller attaching its await after browser startup.
  void code.catch(() => {});
  const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; sandbox",
    );
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Connection', 'close');
    const bad = () => {
      response.statusCode = 400;
      response.end(
        'This callback does not match the pending sign-in. Return to the original browser window.',
      );
    };
    if (
      completed ||
      !redirectUri ||
      request.method !== 'GET' ||
      request.headers.host !== new URL(redirectUri).host ||
      !request.url?.startsWith('/callback?') ||
      request.url.length > 8192
    )
      return bad();
    const url = new URL(request.url, redirectUri);
    if (
      url.pathname !== '/callback' ||
      url.hash ||
      ['state', 'code', 'iss', 'error'].some((key) => url.searchParams.getAll(key).length > 1)
    )
      return bad();
    const returnedState = url.searchParams.get('state') ?? '';
    if (
      Buffer.byteLength(returnedState) !== Buffer.byteLength(state) ||
      !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state)) ||
      url.searchParams.get('iss') !== issuer
    )
      return bad();
    const returnedCode = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (
      (!returnedCode && !error) ||
      (returnedCode && error) ||
      (returnedCode && !tokenText(returnedCode))
    )
      return bad();
    completed = true;
    response.end(
      error
        ? 'Sign-in was not completed. Return to the terminal.'
        : 'Authorization received. Return to the terminal to finish signing in.',
      () => {
        if (error)
          rejectCode(
            new CompanySyncError(
              'E_COMPANY_AUTH_DENIED',
              'Sign-in was declined or cancelled by the identity provider.',
            ),
          );
        else if (returnedCode) resolveCode(returnedCode);
        close();
      },
    );
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  const cancel = () => {
    if (!completed) {
      completed = true;
      rejectCode(new CompanySyncError('E_COMPANY_AUTH_CANCELLED', 'Sign-in was cancelled.'));
    }
    close();
  };
  const close = () => {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    server.close();
    server.closeAllConnections();
  };
  await new Promise<void>((resolve, failure) => {
    server.once('error', failure);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', failure);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    close();
    return reject('E_COMPANY_AUTH_CALLBACK', 'The local sign-in callback could not start.');
  }
  redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const timeout = options.timeoutMs ?? 300000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 600000) {
    close();
    return reject(
      'E_COMPANY_AUTH_INPUT',
      'Sign-in timeout must be between one millisecond and ten minutes.',
    );
  }
  timer = setTimeout(() => {
    if (!completed) {
      completed = true;
      rejectCode(
        new CompanySyncError(
          'E_COMPANY_AUTH_TIMEOUT',
          'Sign-in timed out. Run company login again.',
        ),
      );
    }
    close();
  }, timeout);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  return { redirectUri, code, close };
}

export function createCompanyAuth(dependencies: AuthDependencies = {}) {
  const store = dependencies.storage ?? new CompanyAuthStore();
  const credentials: CompanyCredentialStore = dependencies.credentials ?? {
    save: async (provider, content) => saveRecordedCredential(provider, content),
    read: readStoredCredential,
    remove: removeStoredCredential,
    manual: (origin) => resolveApiKey(`company:${origin}`),
    saveManual: async (origin, token) =>
      saveCredential(`company:${origin}`, token) as Promise<StoredCredentialSource>,
    clearManual: (origin) => clearCredential(`company:${origin}`),
  };
  const request = dependencies.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = dependencies.now ?? Date.now;

  async function response(url: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await request(url, {
        ...init,
        redirect: 'error',
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
    } catch {
      if (init.signal?.aborted) return reject('E_COMPANY_AUTH_CANCELLED', 'Sign-in was cancelled.');
      return reject(
        'E_COMPANY_AUTH_UNAVAILABLE',
        'The sign-in service could not be reached. No credential or server response was logged.',
      );
    }
  }
  async function readJson(result: Response): Promise<Record<string, unknown>> {
    if (Number(result.headers.get('content-length')) > 65536) {
      await result.body?.cancel();
      return reject(
        'E_COMPANY_AUTH_RESPONSE',
        'The authentication response exceeded its supported size.',
      );
    }
    let text = '';
    let length = 0;
    try {
      const reader = result.body?.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      if (!reader) throw new Error('empty');
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.length;
          if (length > 65536) throw new Error('size');
          text += decoder.decode(next.value, { stream: true });
        }
        text += decoder.decode();
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      const value = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
      return value;
    } catch {
      return reject(
        'E_COMPANY_AUTH_RESPONSE',
        'The authentication service returned an invalid response. No response content was logged.',
      );
    }
  }
  async function discovery(origin: string): Promise<AuthConfiguration> {
    const initial = await response(`${origin}/.well-known/openplanr-company-auth`);
    if (!initial.ok) {
      await initial.body?.cancel();
      return reject(
        'E_COMPANY_AUTH_DISCOVERY',
        'Browser sign-in is not configured for this company service. Contact its administrator; no token was sent.',
      );
    }
    const config = await readJson(initial);
    if (
      config.schemaVersion !== '1.0.0' ||
      config.flow !== 'authorization-code-pkce' ||
      typeof config.issuer !== 'string' ||
      !config.issuer.startsWith('https://') ||
      normalizeCompanyOrigin(config.issuer) !== config.issuer ||
      !tokenText(config.clientId)
    )
      return reject(
        'E_COMPANY_AUTH_DISCOVERY',
        'The company sign-in configuration is invalid or unsupported.',
      );
    const scopes = validateScopes(config.scopes);
    const metadataResponse = await response(
      `${config.issuer}/.well-known/oauth-authorization-server`,
    );
    if (!metadataResponse.ok) {
      await metadataResponse.body?.cancel();
      return reject(
        'E_COMPANY_AUTH_DISCOVERY',
        'The configured issuer did not provide OAuth metadata.',
      );
    }
    const metadata = await readJson(metadataResponse);
    const includes = (field: string, value: string) =>
      Array.isArray(metadata[field]) && (metadata[field] as unknown[]).includes(value);
    if (
      metadata.issuer !== config.issuer ||
      !includes('response_types_supported', 'code') ||
      !includes('grant_types_supported', 'authorization_code') ||
      !includes('grant_types_supported', 'refresh_token') ||
      !includes('token_endpoint_auth_methods_supported', 'none') ||
      !includes('code_challenge_methods_supported', 'S256')
    )
      return reject(
        'E_COMPANY_AUTH_DISCOVERY',
        'The configured issuer must support public clients, authorization code, refresh and S256 PKCE.',
      );
    return validateConfiguration(
      {
        apiUrl: origin,
        issuer: config.issuer,
        clientId: config.clientId,
        scopes,
        authorizationEndpoint: metadata.authorization_endpoint,
        tokenEndpoint: metadata.token_endpoint,
        revocationEndpoint: metadata.revocation_endpoint,
      },
      origin,
    );
  }
  async function load(origin: string): Promise<AuthState | undefined> {
    const value = await store.read(origin);
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return reject('E_COMPANY_AUTH_STORE', 'Stored sign-in state is invalid.');
    const record = value as AuthState;
    if (
      record.schemaVersion !== '1.0.0' ||
      ![
        'active',
        'login-pending',
        'refresh-pending',
        'reauth-required',
        'logout-pending',
        'signed-out',
        'manual',
      ].includes(record.status)
    )
      return reject('E_COMPANY_AUTH_STORE', 'Stored sign-in state is invalid or unsupported.');
    if (record.apiUrl !== origin)
      return reject(
        'E_COMPANY_AUTH_STORE',
        'The saved sign-in belongs to a different company service.',
      );
    if (record.status === 'signed-out' || record.status === 'manual') return record;
    if (record.revocationConfirmed !== undefined && typeof record.revocationConfirmed !== 'boolean')
      return reject('E_COMPANY_AUTH_STORE', 'Stored revocation state is invalid.');
    validateConfiguration(record, origin);
    const validProvider = (provider: unknown) =>
      typeof provider === 'string' &&
      provider.startsWith(credentialProvider(origin)) &&
      /^[a-f0-9-]{36}$/.test(provider.slice(credentialProvider(origin).length));
    if (
      record.credential &&
      (!validProvider(record.credential.provider) ||
        !['keychain', 'encrypted-file'].includes(record.credential.source))
    )
      return reject('E_COMPANY_AUTH_STORE', 'The stored credential reference is invalid.');
    if (record.pendingProvider !== undefined && !validProvider(record.pendingProvider))
      return reject('E_COMPANY_AUTH_STORE', 'The pending credential reference is invalid.');
    return record;
  }
  async function storedTokens(record: AuthRecord): Promise<TokenSet> {
    if (!record.credential)
      return reject('E_COMPANY_AUTH_REQUIRED', 'Run company login to sign in.');
    const content = await credentials.read(record.credential.provider, record.credential.source);
    if (!content)
      return reject(
        'E_COMPANY_AUTH_STORE',
        'The saved session is unavailable in its recorded credential store. Unlock the store or sign in again.',
      );
    try {
      return validateTokens(JSON.parse(content), record);
    } catch {
      return reject(
        'E_COMPANY_AUTH_STORE',
        'The saved session is invalid. Sign out and sign in again.',
      );
    }
  }
  async function exchange(
    config: AuthConfiguration,
    body: URLSearchParams,
    previous?: TokenSet,
    signal?: AbortSignal,
  ): Promise<TokenSet> {
    const result = await response(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal,
    });
    const value = await readJson(result);
    if (!result.ok) {
      if (
        ['invalid_grant', 'invalid_scope', 'invalid_client', 'unauthorized_client'].includes(
          String(value.error),
        )
      )
        return reject(
          'E_COMPANY_AUTH_REAUTH',
          'The saved authorization is no longer valid. Run company logout, then company login.',
        );
      return reject(
        'E_COMPANY_AUTH_UNAVAILABLE',
        'Token renewal was not confirmed. The prior credentials remain available for logout; retry sign-in.',
      );
    }
    if (
      String(value.token_type).toLowerCase() !== 'bearer' ||
      !tokenText(value.access_token) ||
      !Number.isSafeInteger(value.expires_in) ||
      Number(value.expires_in) < 1 ||
      Number(value.expires_in) > 31_536_000
    )
      return reject('E_COMPANY_AUTH_RESPONSE', 'The issuer returned an invalid token response.');
    const refresh =
      value.refresh_token === undefined ? previous?.refreshToken : value.refresh_token;
    if (!tokenText(refresh))
      return reject(
        'E_COMPANY_AUTH_RESPONSE',
        'The issuer did not issue a renewable session. Ensure offline access is enabled.',
      );
    const scopes =
      value.scope === undefined
        ? (previous?.scopes ?? config.scopes)
        : typeof value.scope === 'string'
          ? value.scope.split(' ').filter(Boolean)
          : [];
    return validateTokens(
      {
        schemaVersion: '1.0.0',
        apiUrl: config.apiUrl,
        issuer: config.issuer,
        clientId: config.clientId,
        accessToken: value.access_token,
        refreshToken: refresh,
        expiresAt: now() + Number(value.expires_in) * 1000,
        scopes: validateScopes(scopes),
      },
      config,
    );
  }
  async function verifyAccess(
    config: AuthConfiguration,
    tokens: TokenSet,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await response(`${config.apiUrl}/v1/projects`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
      signal,
    });
    await result.body?.cancel();
    if (!result.ok)
      return reject(
        'E_COMPANY_AUTH_ACCESS',
        'The company service did not accept this account and selected organization. Run company logout, then sign in with an authorized organization.',
      );
  }
  async function commitTokens(record: AuthRecord, tokens: TokenSet): Promise<AuthRecord> {
    const provider = record.pendingProvider;
    if (!provider) return reject('E_COMPANY_AUTH_STORE', 'Pending credential provider is missing.');
    const source = await credentials.save(provider, JSON.stringify(tokens));
    const active: AuthRecord = {
      ...record,
      status: 'active',
      credential: { provider, source },
      pendingProvider: undefined,
    };
    await store.write(record.apiUrl, active);
    if (record.credential && record.credential.provider !== provider)
      await credentials
        .remove(record.credential.provider, record.credential.source)
        .catch(() => false);
    return active;
  }
  async function recoverPending(record: AuthRecord): Promise<AuthRecord> {
    if (!record.pendingProvider) return record;
    let unavailable = false;
    for (const source of ['keychain', 'encrypted-file'] as const) {
      let content: string | undefined;
      try {
        content = await credentials.read(record.pendingProvider, source);
      } catch {
        unavailable = true;
        continue;
      }
      if (!content) continue;
      let tokens: TokenSet;
      try {
        tokens = validateTokens(JSON.parse(content), record);
      } catch {
        return reject(
          'E_COMPANY_AUTH_STORE',
          'Pending token rotation is invalid. No refresh token was reused.',
        );
      }
      if (record.status === 'login-pending') await verifyAccess(record, tokens);
      const active: AuthRecord = {
        ...record,
        status: 'active',
        credential: { provider: record.pendingProvider, source },
        pendingProvider: undefined,
      };
      await store.write(record.apiUrl, active);
      if (record.credential && record.credential.provider !== record.pendingProvider)
        await credentials
          .remove(record.credential.provider, record.credential.source)
          .catch(() => false);
      return active;
    }
    if (unavailable)
      return reject(
        'E_COMPANY_AUTH_STORE',
        'A credential backend is unavailable while recovering token rotation. Unlock it and retry; no old refresh token was reused.',
      );
    return reject(
      'E_COMPANY_AUTH_REAUTH',
      'An earlier token exchange was interrupted before its result was saved. No old refresh token was reused. Run company logout, then company login.',
    );
  }

  async function login(apiUrl: string, options: LoginOptions = {}) {
    const origin = normalizeCompanyOrigin(apiUrl);
    return store.locked(async () => {
      const existing = await load(origin);
      if (existing && existing.status !== 'signed-out' && existing.status !== 'manual')
        return reject(
          'E_COMPANY_AUTH_EXISTS',
          'A sign-in already exists or needs recovery. Run company logout before signing in with another account or organization.',
        );
      const config = await discovery(origin);
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(32).toString('base64url');
      const callback = await callbackListener(config.issuer, state, options);
      try {
        const authorization = new URL(config.authorizationEndpoint);
        for (const [key, value] of Object.entries({
          response_type: 'code',
          response_mode: 'query',
          client_id: config.clientId,
          redirect_uri: callback.redirectUri,
          scope: config.scopes.join(' '),
          state,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
          prompt: 'consent',
        }))
          authorization.searchParams.set(key, value);
        await options.onAuthorization?.(authorization.href);
        if (options.open !== false)
          await (dependencies.openBrowser ?? openBrowser)(authorization.href);
        const code = await callback.code;
        const pendingProvider = credentialProvider(origin) + randomUUID();
        const record: AuthRecord = {
          ...config,
          schemaVersion: '1.0.0',
          status: 'login-pending',
          pendingProvider,
        };
        await store.write(origin, record);
        const tokens = await exchange(
          config,
          new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: config.clientId,
            redirect_uri: callback.redirectUri,
            code_verifier: verifier,
          }),
          undefined,
          options.signal,
        );
        // Persist the exchange before a network verification so interrupted login is recoverable.
        const source = await credentials.save(pendingProvider, JSON.stringify(tokens));
        await verifyAccess(config, tokens, options.signal);
        const active: AuthRecord = {
          ...record,
          status: 'active',
          credential: { provider: pendingProvider, source },
          pendingProvider: undefined,
        };
        await store.write(origin, active);
        await credentials.clearManual(origin);
        return {
          ok: true,
          action: 'company.login',
          apiUrl: origin,
          status: 'signed-in',
          expiresAt: new Date(tokens.expiresAt).toISOString(),
          credentialStorage: source,
          environmentOverride: Boolean(process.env.PLANR_COMPANY_TOKEN),
          notice:
            source === 'encrypted-file'
              ? 'The OS keychain is unavailable. Tokens are stored in the existing encrypted local credential file with private file permissions.'
              : 'Tokens are stored in the operating-system keychain.',
        };
      } finally {
        callback.close();
      }
    }, options.signal);
  }

  async function accessToken(
    apiUrl: string,
    options: { rejectedAccessToken?: string } = {},
  ): Promise<string | undefined> {
    const origin = normalizeCompanyOrigin(apiUrl);
    if (process.env.PLANR_COMPANY_TOKEN)
      return options.rejectedAccessToken ? undefined : process.env.PLANR_COMPANY_TOKEN;
    return store.locked(async () => {
      let record = await load(origin);
      if (!record || record.status === 'manual')
        return options.rejectedAccessToken ? undefined : await credentials.manual(origin);
      if (record.status === 'signed-out') return undefined;
      if (record.status === 'login-pending' || record.status === 'refresh-pending')
        record = await recoverPending(record);
      if (record.status !== 'active')
        return reject(
          'E_COMPANY_AUTH_REAUTH',
          'Sign-in needs attention. Run company logout, then company login.',
        );
      const tokens = await storedTokens(record);
      if (
        tokens.expiresAt > now() + 30000 &&
        (!options.rejectedAccessToken || options.rejectedAccessToken !== tokens.accessToken)
      )
        return tokens.accessToken;
      const pending: AuthRecord = {
        ...record,
        status: 'refresh-pending',
        pendingProvider: credentialProvider(origin) + randomUUID(),
      };
      await store.write(origin, pending);
      let renewed: TokenSet;
      try {
        renewed = await exchange(
          record,
          new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
            client_id: record.clientId,
          }),
          tokens,
        );
      } catch (error) {
        if (error instanceof CompanySyncError && error.code === 'E_COMPANY_AUTH_REAUTH')
          await store.write(origin, {
            ...pending,
            status: 'reauth-required',
            pendingProvider: undefined,
          });
        throw error;
      }
      await commitTokens(pending, renewed);
      return renewed.accessToken;
    });
  }

  async function logout(apiUrl: string, options: { localOnly?: boolean } = {}) {
    const origin = normalizeCompanyOrigin(apiUrl);
    return store.locked(async () => {
      let record = await load(origin);
      let removed = true;
      let revocation:
        | 'confirmed'
        | 'not-requested'
        | 'no-session'
        | 'partially-confirmed'
        | 'unknown' = 'no-session';
      if (record && record.status !== 'signed-out' && record.status !== 'manual') {
        record = { ...record, status: 'logout-pending' };
        await store.write(origin, record);
        const references: Array<{ provider: string; source: StoredCredentialSource }> =
          record.credential ? [record.credential] : [];
        if (record.pendingProvider)
          for (const source of ['keychain', 'encrypted-file'] as const) {
            try {
              if (await credentials.read(record.pendingProvider, source))
                references.push({ provider: record.pendingProvider, source });
            } catch {
              // A pending generation may exist here. Keep its reference for a later retry.
              removed = false;
            }
          }
        const pendingProvider = record.pendingProvider;
        const uncertainExchange = Boolean(
          pendingProvider &&
            !references.some((reference) => reference.provider === pendingProvider),
        );
        const tokens: TokenSet[] = [];
        for (const reference of references) {
          let raw: string | undefined;
          try {
            raw = await credentials.read(reference.provider, reference.source);
          } catch (error) {
            if (!options.localOnly) throw error;
            removed = false;
          }
          if (!raw && !options.localOnly && !record.revocationConfirmed)
            return reject(
              'E_COMPANY_AUTH_STORE',
              'Saved credentials are unavailable for revocation. Unlock the credential store and retry; --local-only deliberately skips remote revocation.',
            );
          if (raw) {
            try {
              tokens.push(validateTokens(JSON.parse(raw), record));
            } catch {
              if (!options.localOnly)
                throw new CompanySyncError(
                  'E_COMPANY_AUTH_STORE',
                  'Stored tokens cannot be validated for revocation. Use --local-only only to deliberately forget them without confirming remote logout.',
                );
            }
          }
        }
        if (!options.localOnly) {
          for (const token of new Map(
            tokens.flatMap((value) => [
              [value.refreshToken, 'refresh_token'],
              [value.accessToken, 'access_token'],
            ]),
          ).entries()) {
            let result: Response;
            try {
              result = await response(record.revocationEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  token: token[0],
                  token_type_hint: token[1],
                  client_id: record.clientId,
                }),
              });
            } catch {
              return reject(
                'E_COMPANY_AUTH_REVOKE',
                'Remote logout could not be confirmed. Credentials are preserved and disabled; retry logout, or use --local-only.',
              );
            }
            await result.body?.cancel();
            if (!result.ok)
              return reject(
                'E_COMPANY_AUTH_REVOKE',
                'Remote logout was not confirmed. Credentials are preserved and disabled; retry logout, or use --local-only to deliberately forget them.',
              );
          }
          revocation = uncertainExchange
            ? tokens.length
              ? 'partially-confirmed'
              : 'unknown'
            : tokens.length || record.revocationConfirmed
              ? 'confirmed'
              : 'no-session';
          record.revocationConfirmed = !uncertainExchange && removed;
          await store.write(origin, record);
        } else revocation = 'not-requested';
        // A durable tombstone prevents stale credential fallback after logout.
        for (const reference of references) {
          const deleted = await credentials
            .remove(reference.provider, reference.source)
            .catch(() => false);
          if (
            deleted &&
            reference.provider === record.credential?.provider &&
            reference.source === record.credential.source
          )
            record.credential = undefined;
          removed = deleted && removed;
        }
        if (!removed) await store.write(origin, record);
      }
      if (removed)
        await store.write(origin, { schemaVersion: '1.0.0', apiUrl: origin, status: 'signed-out' });
      await credentials.clearManual(origin);
      return {
        ok: true,
        action: 'company.logout',
        apiUrl: origin,
        status: 'signed-out',
        revocation,
        credentialCleanup: removed ? 'confirmed' : 'incomplete',
        environmentOverride: Boolean(process.env.PLANR_COMPANY_TOKEN),
        notice: !removed
          ? 'Local sign-in is disabled, but credential removal is incomplete. Retry logout when the credential store is available.'
          : revocation === 'unknown' || revocation === 'partially-confirmed'
            ? 'Local sign-in is disabled. An interrupted token exchange could not be fully revoked; review the application authorization in the identity provider.'
            : options.localOnly
              ? 'Local sign-in was disabled. Remote token revocation was not requested.'
              : process.env.PLANR_COMPANY_TOKEN
                ? 'Stored sign-in was removed. PLANR_COMPANY_TOKEN remains set and must be unset separately.'
                : 'Stored company sign-in is disabled. This does not sign you out of the browser.',
      };
    });
  }
  async function connectManual(apiUrl: string, token: string) {
    const origin = normalizeCompanyOrigin(apiUrl);
    if (!tokenText(token)) return reject('E_COMPANY_AUTH_INPUT', 'Supply a valid scoped token.');
    return store.locked(async () => {
      const record = await load(origin);
      if (record && record.status !== 'signed-out' && record.status !== 'manual')
        return reject(
          'E_COMPANY_AUTH_EXISTS',
          'Sign out of the existing browser authorization before selecting a manual developer token.',
        );
      const source = await credentials.saveManual(origin, token);
      await store.write(origin, { schemaVersion: '1.0.0', apiUrl: origin, status: 'manual' });
      return source;
    });
  }
  return { login, accessToken, logout, connectManual };
}
const companyAuth = createCompanyAuth();
export const loginCompany = companyAuth.login;
export const resolveCompanyAccessToken = companyAuth.accessToken;
export const logoutCompany = companyAuth.logout;

export const storeCompanyManualToken = companyAuth.connectManual;
