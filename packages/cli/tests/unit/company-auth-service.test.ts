import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCompanyAuth } from '../../src/services/company-auth-service.js';
import {
  CompanyAuthStore,
  type CompanyCredentialStore,
} from '../../src/services/company-auth-store.js';

function required<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'Expected fixture value to be present');
  return value;
}

const origin = 'https://company.test';
const issuer = 'https://identity.test';
const scopes = ['openid', 'email', 'offline_access', 'user:org:read', 'openplanr:company'];
const nativeFetch = globalThis.fetch;
let directory: string;
let store: CompanyAuthStore;
let fixtureOrigin: string;
let browserUrl: string;
let now: number;
let challenge: string;
let exchanges: number;
let refreshes: number;
let behavior: {
  metadata?: Record<string, unknown>;
  discovery?: Record<string, unknown>;
  token?: Record<string, unknown>;
  tokenStatus?: number;
  revokeStatus?: number;
  verifyStatus?: number;
  omitRefresh?: boolean;
  tokenRedirect?: boolean;
};
let transport: typeof fetch;
let auth: ReturnType<typeof createCompanyAuth>;
let requests: Array<{ path: string; method: string; authorization?: string; body: string }>;
let secrets: Map<string, string>;
let backend: 'keychain' | 'encrypted-file';
let manual: string | undefined;
let credentials: CompanyCredentialStore;
let server: ReturnType<typeof createServer>;
function send(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}
async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(required(request.url), fixtureOrigin);
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({
    path: url.pathname,
    method: required(request.method),
    authorization: request.headers.authorization,
    body,
  });
  if (url.pathname === '/api/.well-known/openplanr-company-auth')
    return send(
      response,
      behavior.discovery ?? {
        schemaVersion: '1.0.0',
        flow: 'authorization-code-pkce',
        issuer,
        clientId: 'client_test',
        scopes,
      },
    );
  if (url.pathname === '/issuer/.well-known/oauth-authorization-server')
    return send(response, {
      issuer,
      authorization_endpoint: issuer + '/oauth/authorize',
      token_endpoint: issuer + '/oauth/token',
      revocation_endpoint: issuer + '/oauth/token/revoke',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      ...behavior.metadata,
    });
  if (url.pathname === '/issuer/oauth/authorize') {
    challenge = required(url.searchParams.get('code_challenge'));
    const callback = new URL(required(url.searchParams.get('redirect_uri')));
    callback.searchParams.set('code', 'fixture-code');
    callback.searchParams.set('state', required(url.searchParams.get('state')));
    callback.searchParams.set('iss', issuer);
    response.writeHead(302, { Location: callback.href });
    response.end();
    return;
  }
  if (url.pathname === '/issuer/oauth/token') {
    if (behavior.tokenRedirect) {
      response.writeHead(302, { Location: 'https://elsewhere.test/steal' });
      response.end();
      return;
    }
    const data = new URLSearchParams(body);
    expect(data.has('client_secret')).toBe(false);
    expect(request.headers.authorization).toBeUndefined();
    if (data.get('grant_type') === 'authorization_code') {
      exchanges++;
      expect(data.get('code')).toBe('fixture-code');
      expect(
        createHash('sha256')
          .update(required(data.get('code_verifier')))
          .digest('base64url'),
      ).toBe(challenge);
      expect(data.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    } else {
      refreshes++;
      expect(data.get('grant_type')).toBe('refresh_token');
      expect(data.get('refresh_token')).toMatch(/^refresh-/);
    }
    return send(
      response,
      behavior.token ?? {
        token_type: 'Bearer',
        access_token: `oat_access-${refreshes}`,
        expires_in: 3600,
        ...(behavior.omitRefresh ? {} : { refresh_token: `refresh-${refreshes}` }),
        scope: scopes.join(' '),
      },
      behavior.tokenStatus ?? 200,
    );
  }
  if (url.pathname === '/api/v1/projects')
    return send(response, { projects: [] }, behavior.verifyStatus ?? 200);
  if (url.pathname === '/issuer/oauth/token/revoke') {
    response.writeHead(behavior.revokeStatus ?? 200);
    response.end();
    return;
  }
  response.writeHead(404);
  response.end();
}
async function fixtureFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const url = new URL(String(input));
  if (!['company.test', 'identity.test'].includes(url.hostname))
    throw new Error('Unexpected fixture origin');
  const prefix = url.hostname === 'company.test' ? '/api' : '/issuer';
  return nativeFetch(fixtureOrigin + prefix + url.pathname + url.search, init);
}
async function browser(url: string) {
  browserUrl = url;
  await fixtureFetch(url);
}
async function signIn() {
  return auth.login(origin, {
    open: true,
    timeoutMs: 1000,
    onAuthorization: (url) => {
      browserUrl = url;
    },
  });
}
function callbackUrl(change: Record<string, string> = {}) {
  const authorization = new URL(browserUrl);
  const callback = new URL(required(authorization.searchParams.get('redirect_uri')));
  callback.searchParams.set('state', required(authorization.searchParams.get('state')));
  callback.searchParams.set('iss', issuer);
  callback.searchParams.set('code', 'fixture-code');
  for (const [key, value] of Object.entries(change)) callback.searchParams.set(key, value);
  return callback;
}
function recordPath() {
  return path.join(directory, createHash('sha256').update(origin).digest('hex') + '.json');
}
async function rawCallback(url: URL, method = 'GET', host?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method, headers: host ? { Host: host } : {} },
      (response) => {
        response.resume();
        response.on('end', () => resolve(required(response.statusCode)));
      },
    );
    request.once('error', reject);
    request.end();
  });
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'company-auth-'));
  store = new CompanyAuthStore(directory);
  now = Date.parse('2026-09-13T00:00:00Z');
  browserUrl = '';
  challenge = '';
  exchanges = 0;
  refreshes = 0;
  requests = [];
  behavior = {};
  secrets = new Map();
  backend = 'keychain';
  manual = undefined;
  credentials = {
    save: vi.fn(async (provider, content) => {
      secrets.set(backend + ':' + provider, content);
      return backend;
    }),
    read: vi.fn(async (provider, source) => secrets.get(source + ':' + provider)),
    remove: vi.fn(async (provider, source) => secrets.delete(source + ':' + provider)),
    manual: vi.fn(async () => manual),
    saveManual: vi.fn(async (_origin, token) => {
      manual = token;
      return backend;
    }),
    clearManual: vi.fn(async () => {
      manual = undefined;
    }),
  };
  server = createServer((request, response) => {
    void route(request, response).catch((error) => {
      response.writeHead(500);
      response.end();
      throw error;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture');
  fixtureOrigin = `http://127.0.0.1:${address.port}`;
  transport = vi.fn(fixtureFetch) as typeof fetch;
  auth = createCompanyAuth({
    storage: store,
    credentials,
    fetch: transport,
    openBrowser: browser,
    now: () => now,
  });
  vi.stubEnv('PLANR_COMPANY_TOKEN', '');
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe('browser company sign-in', () => {
  it('completes public S256 PKCE on a random loopback port and stores only private credential references', async () => {
    backend = 'encrypted-file';
    const result = await signIn();
    expect(result.status).toBe('signed-in');
    expect(result.credentialStorage).toBe('encrypted-file');
    expect(result.notice).toContain('private file permissions');
    const url = new URL(browserUrl);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('code_verifier')).toBe(false);
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe(scopes.join(' '));
    expect(exchanges).toBe(1);
    expect(await auth.accessToken(origin)).toBe('oat_access-0');
    const metadata = await readFile(recordPath(), 'utf8');
    expect(metadata).not.toContain('oat_access');
    expect(metadata).not.toContain('refresh-');
    expect((await stat(recordPath())).mode & 0o777).toBe(0o600);
    expect(requests.find((item) => item.path === '/api/v1/projects')?.authorization).toBe(
      'Bearer oat_access-0',
    );
    for (const [, init] of vi.mocked(transport).mock.calls) expect(init?.redirect).toBe('error');
  });
  it('fails closed for unsafe discovery endpoints, extra permissions or an unsupported public-client flow', async () => {
    for (const metadata of [
      { issuer: 'https://other.test' },
      { token_endpoint: 'https://other.test/token' },
      { revocation_endpoint: 'https://identity.test/revoke?destination=x' },
      { code_challenge_methods_supported: ['plain'] },
      { token_endpoint_auth_methods_supported: ['client_secret_basic'] },
      { grant_types_supported: ['authorization_code'] },
    ]) {
      behavior.metadata = metadata;
      await expect(signIn()).rejects.toThrow();
      expect(exchanges).toBe(0);
      expect(browserUrl).toBe('');
    }
    behavior.metadata = undefined;
    behavior.discovery = {
      schemaVersion: '1.0.0',
      flow: 'authorization-code-pkce',
      issuer: 'http://127.0.0.1',
      clientId: 'client',
      scopes,
    };
    await expect(signIn()).rejects.toThrow();
    behavior.discovery = {
      schemaVersion: '1.0.0',
      flow: 'authorization-code-pkce',
      issuer,
      clientId: 'client',
      scopes: [...scopes, 'private_metadata'],
    };
    await expect(signIn()).rejects.toThrow('unsupported additional');
    expect(secrets.size).toBe(0);
  });
  it('rejects wrong host, method, state, issuer and duplicate callback parameters without consuming the valid callback', async () => {
    await auth.login(origin, {
      open: false,
      timeoutMs: 1000,
      onAuthorization: async (url) => {
        browserUrl = url;
        challenge = required(new URL(url).searchParams.get('code_challenge'));
        expect(await rawCallback(callbackUrl(), 'POST')).toBe(400);
        expect(await rawCallback(callbackUrl(), 'GET', 'attacker.test')).toBe(400);
        for (const changed of [
          { state: 'invalid-state' },
          { iss: 'https://other.test' },
          { iss: '' },
        ])
          expect(await rawCallback(callbackUrl(changed))).toBe(400);
        const duplicate = callbackUrl();
        duplicate.searchParams.append('code', 'second');
        expect(await rawCallback(duplicate)).toBe(400);
        expect(await rawCallback(callbackUrl())).toBe(200);
      },
    });
    expect(exchanges).toBe(1);
    await expect(nativeFetch(callbackUrl())).rejects.toThrow();
  });
  it('supports no-open without invoking the launcher', async () => {
    const launch = vi.fn();
    auth = createCompanyAuth({
      storage: store,
      credentials,
      fetch: transport,
      openBrowser: launch,
      now: () => now,
    });
    await auth.login(origin, {
      open: false,
      onAuthorization: async (url) => {
        await browser(url);
      },
    });
    expect(launch).not.toHaveBeenCalled();
  });
  it('cleans up callbacks after denial, timeout, cancellation and launcher failure', async () => {
    await expect(
      auth.login(origin, {
        open: false,
        onAuthorization: async (url) => {
          browserUrl = url;
          const callback = callbackUrl();
          callback.searchParams.delete('code');
          callback.searchParams.set('error', 'access_denied');
          await nativeFetch(callback);
        },
      }),
    ).rejects.toThrow('declined');
    await expect(nativeFetch(callbackUrl())).rejects.toThrow();
    expect(exchanges).toBe(0);
    await expect(
      auth.login(origin, {
        open: false,
        timeoutMs: 20,
        onAuthorization: (url) => {
          browserUrl = url;
        },
      }),
    ).rejects.toThrow('timed out');
    await expect(nativeFetch(callbackUrl())).rejects.toThrow();
    const controller = new AbortController();
    await expect(
      auth.login(origin, {
        open: false,
        signal: controller.signal,
        onAuthorization: (url) => {
          browserUrl = url;
          controller.abort();
        },
      }),
    ).rejects.toThrow('cancelled');
    await expect(nativeFetch(callbackUrl())).rejects.toThrow();
    auth = createCompanyAuth({
      storage: store,
      credentials,
      fetch: transport,
      openBrowser: async () => {
        throw new Error('launcher unavailable');
      },
    });
    await expect(
      auth.login(origin, {
        onAuthorization: (url) => {
          browserUrl = url;
        },
      }),
    ).rejects.toThrow('launcher');
    await expect(nativeFetch(callbackUrl())).rejects.toThrow();
    expect(secrets.size).toBe(0);
    expect((await readdir(directory)).filter((name) => name.endsWith('.owner'))).toEqual([]);
  });
  it('keeps request timeouts active when login also has a cancellation signal', async () => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const original = transport;
    transport = async (input, init) => {
      if (String(input).endsWith('/oauth/token')) {
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(init.signal.reason);
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }
      return original(input, init);
    };
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(100));
    auth = createCompanyAuth({
      storage: store,
      credentials,
      fetch: (...args) => transport(...args),
      openBrowser: browser,
      now: () => now,
    });
    const controller = new AbortController();
    await expect(
      auth.login(origin, { signal: controller.signal, timeoutMs: 1000 }),
    ).rejects.toThrow('could not be reached');
    expect(controller.signal.aborted).toBe(false);
  });
  it('preserves a prior sign-in and requires logout before changing accounts or organization', async () => {
    await signIn();
    await expect(signIn()).rejects.toThrow('logout');
    expect(exchanges).toBe(1);
    expect(await auth.accessToken(origin)).toBe('oat_access-0');
  });
  it('keeps tokens available for revocation if the company API rejects the chosen organization', async () => {
    behavior.verifyStatus = 403;
    await expect(signIn()).rejects.toThrow('selected organization');
    expect(secrets.size).toBe(1);
    expect(((await store.read(origin)) as { status: string }).status).toBe('login-pending');
    const result = await auth.logout(origin);
    expect(result.revocation).toBe('confirmed');
    expect(secrets.size).toBe(0);
  });
  it('rejects malformed token responses and never follows credential-bearing redirects', async () => {
    behavior.token = {
      access_token: 'secret-invalid',
      token_type: 'MAC',
      expires_in: 3600,
      refresh_token: 'refresh-0',
    };
    await expect(signIn()).rejects.toThrow('invalid token response');
    expect(secrets.size).toBe(0);
    await auth.logout(origin, { localOnly: true });
    behavior.token = undefined;
    behavior.tokenRedirect = true;
    await expect(signIn()).rejects.toThrow('could not be reached');
    expect(
      vi.mocked(transport).mock.calls.every(([url]) => !String(url).includes('elsewhere')),
    ).toBe(true);
  });
});

describe('renewal and rotation integrity', () => {
  it('refreshes near expiry once across concurrent clients and commits the rotated refresh token', async () => {
    await signIn();
    now += 3_590_000;
    const second = createCompanyAuth({
      storage: new CompanyAuthStore(directory),
      credentials,
      fetch: transport,
      now: () => now,
    });
    expect(
      await Promise.all([
        auth.accessToken(origin),
        second.accessToken(origin),
        auth.accessToken(origin),
        second.accessToken(origin),
      ]),
    ).toEqual(Array(4).fill('oat_access-1'));
    expect(refreshes).toBe(1);
    expect(secrets.size).toBe(1);
    expect([...secrets.values()][0]).toContain('refresh-1');
    expect(await readFile(recordPath(), 'utf8')).not.toContain('refresh-1');
  });
  it('uses returned expiry and retains a non-rotated refresh token when the issuer omits its replacement', async () => {
    await signIn();
    now += 3_600_001;
    behavior.omitRefresh = true;
    expect(await auth.accessToken(origin)).toBe('oat_access-1');
    expect([...secrets.values()][0]).toContain('refresh-0');
  });
  it('refreshes a rejected access token once and reuses another process’s completed renewal', async () => {
    await signIn();
    expect(await auth.accessToken(origin, { rejectedAccessToken: 'oat_access-0' })).toBe(
      'oat_access-1',
    );
    expect(await auth.accessToken(origin, { rejectedAccessToken: 'oat_access-0' })).toBe(
      'oat_access-1',
    );
    expect(refreshes).toBe(1);
  });
  it('retains revoked credentials for logout, blocks further refresh and does not log issuer error content', async () => {
    await signIn();
    now += 3_600_001;
    behavior.tokenStatus = 400;
    behavior.token = { error: 'invalid_grant', error_description: 'fixture-secret-do-not-log' };
    await expect(auth.accessToken(origin)).rejects.toThrow('no longer valid');
    await expect(auth.accessToken(origin)).rejects.toThrow('needs attention');
    expect(refreshes).toBe(1);
    expect(secrets.size).toBe(1);
    expect(((await store.read(origin)) as { status: string }).status).toBe('reauth-required');
    await auth.logout(origin);
    expect(secrets.size).toBe(0);
  });
  it('does not retry an uncertain exchange with a potentially consumed refresh token', async () => {
    await signIn();
    now += 3_600_001;
    behavior.tokenStatus = 503;
    behavior.token = { error: 'temporarily_unavailable' };
    await expect(auth.accessToken(origin)).rejects.toThrow('not confirmed');
    await expect(auth.accessToken(origin)).rejects.toThrow('No old refresh token was reused');
    expect(refreshes).toBe(1);
    expect(secrets.size).toBe(1);
    expect((await auth.logout(origin)).revocation).toBe('partially-confirmed');
  });
  it('recovers after token storage succeeds but the metadata promotion is interrupted', async () => {
    await signIn();
    now += 3_600_001;
    const write = store.write.bind(store);
    let interrupt = true;
    vi.spyOn(store, 'write').mockImplementation(async (origin, value) => {
      if ((value as { status: string }).status === 'active' && interrupt) {
        interrupt = false;
        throw new Error('interrupted commit');
      }
      await write(origin, value);
    });
    await expect(auth.accessToken(origin)).rejects.toThrow('interrupted commit');
    expect(refreshes).toBe(1);
    expect(secrets.size).toBe(2);
    expect(await auth.accessToken(origin)).toBe('oat_access-1');
    expect(refreshes).toBe(1);
    expect(secrets.size).toBe(1);
  });
  it('recovers a saved fallback rotation even when the keychain cannot be queried', async () => {
    backend = 'encrypted-file';
    await signIn();
    now += 3_600_001;
    const write = store.write.bind(store);
    let interrupted = true;
    vi.spyOn(store, 'write').mockImplementation(async (origin, value) => {
      if ((value as { status: string }).status === 'active' && interrupted) {
        interrupted = false;
        throw new Error('metadata interrupted');
      }
      await write(origin, value);
    });
    await expect(auth.accessToken(origin)).rejects.toThrow('metadata interrupted');
    vi.mocked(credentials.read).mockImplementation(async (provider, source) => {
      if (source === 'keychain') throw new Error('keychain unavailable');
      return secrets.get(source + ':' + provider);
    });
    expect(await auth.accessToken(origin)).toBe('oat_access-1');
    expect(refreshes).toBe(1);
  });
  it('pins each successful write to its backend even when keychain availability changes', async () => {
    await signIn();
    backend = 'encrypted-file';
    now += 3_600_001;
    await auth.accessToken(origin);
    const record = (await store.read(origin)) as {
      credential: { provider: string; source: string };
    };
    secrets.set('keychain:' + record.credential.provider, 'stale unrelated value');
    expect(record.credential.source).toBe('encrypted-file');
    expect(await auth.accessToken(origin)).toBe('oat_access-1');
  });
  it('fails before sending tokens for altered issuer, scope, credential reference or unsafe metadata permissions', async () => {
    await signIn();
    const original = (await store.read(origin)) as Record<string, unknown>;
    const count = requests.length;
    for (const change of [
      { issuer: 'https://other.test' },
      { scopes: ['openid'] },
      { credential: { provider: 'company-oauth:other', source: 'keychain' } },
      { schemaVersion: '99' },
    ]) {
      await store.write(origin, { ...original, ...change });
      await expect(auth.accessToken(origin)).rejects.toThrow();
    }
    await store.write(origin, original);
    await chmod(recordPath(), 0o644);
    await expect(auth.accessToken(origin)).rejects.toThrow('unsafe');
    expect(requests.length).toBe(count);
  });
  it('keeps environment and explicit manual tokens as non-renewable developer overrides', async () => {
    manual = 'manual-token';
    expect(await auth.accessToken(origin)).toBe('manual-token');
    expect(await auth.accessToken(origin, { rejectedAccessToken: 'manual-token' })).toBeUndefined();
    vi.stubEnv('PLANR_COMPANY_TOKEN', 'environment-token');
    expect(await auth.accessToken(origin)).toBe('environment-token');
    expect(
      await auth.accessToken(origin, { rejectedAccessToken: 'environment-token' }),
    ).toBeUndefined();
    expect(requests).toHaveLength(0);
  });
});

describe('honest logout and revocation', () => {
  it('revokes both stored token types before clearing local references and never signs out the browser', async () => {
    await signIn();
    const result = await auth.logout(origin);
    expect(result.revocation).toBe('confirmed');
    expect(result.notice).toContain('does not sign you out of the browser');
    const revocations = requests.filter((item) => item.path.endsWith('/revoke'));
    expect(revocations).toHaveLength(2);
    expect(
      revocations.map((item) => new URLSearchParams(item.body).get('token_type_hint')),
    ).toEqual(['refresh_token', 'access_token']);
    expect(
      revocations.every(
        (item) => new URLSearchParams(item.body).get('client_id') === 'client_test',
      ),
    ).toBe(true);
    expect(secrets.size).toBe(0);
    expect(await auth.accessToken(origin)).toBeUndefined();
    expect((await auth.logout(origin)).revocation).toBe('no-session');
  });
  it('retains disabled credentials on remote failure so logout can be retried', async () => {
    await signIn();
    behavior.revokeStatus = 503;
    await expect(auth.logout(origin)).rejects.toThrow('preserved and disabled');
    expect(secrets.size).toBe(1);
    await expect(auth.accessToken(origin)).rejects.toThrow('needs attention');
    behavior.revokeStatus = 200;
    expect((await auth.logout(origin)).revocation).toBe('confirmed');
    expect(secrets.size).toBe(0);
  });
  it('discloses local-only logout and an active environment override without claiming revocation', async () => {
    await signIn();
    vi.stubEnv('PLANR_COMPANY_TOKEN', 'environment-token');
    const result = await auth.logout(origin, { localOnly: true });
    expect(result.revocation).toBe('not-requested');
    expect(result.environmentOverride).toBe(true);
    expect(requests.filter((item) => item.path.endsWith('/revoke'))).toHaveLength(0);
    expect(await auth.accessToken(origin)).toBe('environment-token');
  });
  it('keeps disabled credential references when cleanup fails so removal can be retried', async () => {
    await signIn();
    const remove = credentials.remove;
    credentials.remove = vi.fn(async () => false);
    const first = await auth.logout(origin);
    expect(first.credentialCleanup).toBe('incomplete');
    expect(first.revocation).toBe('confirmed');
    await expect(auth.accessToken(origin)).rejects.toThrow('needs attention');
    credentials.remove = remove;
    const second = await auth.logout(origin);
    expect(second.credentialCleanup).toBe('confirmed');
    expect(secrets.size).toBe(0);
  });
  it('retains an unreadable pending generation for revocation and cleanup retry', async () => {
    await signIn();
    now += 4_000_000;
    const write = store.write.bind(store);
    vi.spyOn(store, 'write')
      .mockImplementationOnce(write)
      .mockImplementationOnce(async () => {
        throw new Error('interrupted promotion');
      });
    await expect(auth.accessToken(origin)).rejects.toThrow('interrupted promotion');
    const pending = JSON.parse(await readFile(recordPath(), 'utf8')).pendingProvider;
    const read = credentials.read;
    credentials.read = vi.fn(async (provider, source) => {
      if (provider === pending) throw new Error('backend locked');
      return read(provider, source);
    });
    const result = await auth.logout(origin);
    expect(result.credentialCleanup).toBe('incomplete');
    expect(result.revocation).toBe('partially-confirmed');
    expect(JSON.parse(await readFile(recordPath(), 'utf8')).pendingProvider).toBe(pending);
    expect(JSON.parse(await readFile(recordPath(), 'utf8')).status).toBe('logout-pending');
    expect(secrets.size).toBe(1);
    credentials.read = read;
    expect((await auth.logout(origin)).credentialCleanup).toBe('confirmed');
    expect(secrets.size).toBe(0);
  });
  it('can disable local sign-in when the recorded backend throws, without claiming cleanup', async () => {
    await signIn();
    const read = credentials.read;
    credentials.read = vi.fn(async () => {
      throw new Error('backend locked');
    });
    vi.mocked(credentials.remove).mockResolvedValue(false);
    const result = await auth.logout(origin, { localOnly: true });
    expect(result.credentialCleanup).toBe('incomplete');
    expect(result.revocation).toBe('not-requested');
    expect(JSON.parse(await readFile(recordPath(), 'utf8')).status).toBe('logout-pending');
    credentials.read = read;
  });
  it('does not reactivate stale manual credentials after OAuth login or logout', async () => {
    manual = 'old-manual-token';
    vi.mocked(credentials.clearManual).mockImplementation(async () => {});
    await signIn();
    expect(await auth.accessToken(origin)).toBe('oat_access-0');
    await expect(auth.connectManual(origin, 'new-manual-token')).rejects.toThrow('Sign out');
    await auth.logout(origin);
    expect(await auth.accessToken(origin)).toBeUndefined();
    await auth.connectManual(origin, 'new-manual-token');
    expect(await auth.accessToken(origin)).toBe('new-manual-token');
    await auth.logout(origin);
    expect(await auth.accessToken(origin)).toBeUndefined();
  });
  it('does not claim removal or revocation when the recorded credential backend is unavailable', async () => {
    await signIn();
    vi.mocked(credentials.read).mockResolvedValue(undefined);
    await expect(auth.logout(origin)).rejects.toThrow('unavailable for revocation');
    vi.mocked(credentials.remove).mockResolvedValue(false);
    const result = await auth.logout(origin, { localOnly: true });
    expect(result.credentialCleanup).toBe('incomplete');
    expect(result.revocation).toBe('not-requested');
  });
});
