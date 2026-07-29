import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseStrictCsv,
  parseStrictJson,
  readImportedEvidenceFile,
  serializeSafeCsv,
} from '../../src/services/operate/evidence-import.js';
import {
  assertGitHubReadOnlyArgs,
  assertGitReadOnlyArgs,
  assertLinearReadOnlyQuery,
  assertReadOnlyRestRequest,
  executeLinearReadOnlyQuery,
  executeRestReadOnlyJson,
  ReadOnlyLinearTransport,
} from '../../src/services/operate/read-only-providers.js';
import {
  containsSecret,
  normalizeUntrustedText,
  redactSensitiveText,
  sanitizeGeneratedPlainText,
} from '../../src/services/operate/redaction.js';
import { resolveContainedPath } from '../../src/services/operate/workspace.js';

const temporaryDirectories: string[] = [];
const safeRedactionCorpus = JSON.parse(
  readFileSync(resolve('tests/fixtures/operate/redaction-safe-corpus.json'), 'utf8'),
) as Array<{ id: string; input: string; expected: string }>;

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, recursive: true, maxRetries: 10, retryDelay: 100 }),
      ),
  );
});

describe('strict imported evidence', () => {
  it('accepts bounded JSON while rejecting duplicate, dangerous, and ambiguous input', () => {
    const parsed = parseStrictJson('\ufeff{"safe":[1,true,null],"nested":{"value":"ok"}}');
    expect(parsed).toEqual({
      safe: [1, true, null],
      nested: { value: 'ok' },
    });

    expect(() => parseStrictJson('{"same":1,"same":2}')).toThrow(/Duplicate JSON key/);
    expect(() => parseStrictJson('{"__proto__":{"polluted":true}}')).toThrow(/Forbidden JSON key/);
    expect(() => parseStrictJson('{"value":1} trailing')).toThrow(/trailing JSON content/);
    expect(() => parseStrictJson('[[[0]]]', { maxDepth: 2 })).toThrow(/nesting limit/);
    expect(() => parseStrictJson('{"value":"too long"}', { maxStringLength: 3 })).toThrow(
      /string exceeds limit/,
    );
  });

  it('parses quoted CSV strictly and rejects malformed records and configured limits', () => {
    expect(parseStrictCsv('name,note\r\nAsem,"line one\nline two"\r\n')).toEqual([
      ['name', 'note'],
      ['Asem', 'line one\nline two'],
    ]);
    expect(() => parseStrictCsv('"unterminated')).toThrow(/unterminated quote/);
    expect(() => parseStrictCsv('a,b,c', { maxColumns: 2 })).toThrow(/column limit/);
    expect(() => parseStrictCsv('a\0b')).toThrow(/contains NUL/);

    // Characters after a closing quote make a CSV field ambiguous and must not
    // be silently joined to the quoted value.
    expect(() => parseStrictCsv('"quoted"suffix,value')).toThrow(/CSV.*quote/i);
  });

  it('neutralizes spreadsheet formulas on every exported cell', () => {
    const csv = serializeSafeCsv([
      ['plain', '=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '\tformula', '\rformula'],
    ]);
    expect(csv).toBe("plain,'=1+1,'+SUM(A1:A2),'-2+3,'@cmd,'\tformula,\"'\rformula\"\n");
  });

  it('loads only workspace-contained JSON/CSV with strict parsing and inert CSV cells', async () => {
    const projectRoot = await temporaryDirectory('openplanr-operate-import-project-');
    const outsideRoot = await temporaryDirectory('openplanr-operate-import-outside-');
    await writeFile(join(projectRoot, 'metrics.json'), '{"active":12,"nested":{"safe":true}}\n');
    await writeFile(join(projectRoot, 'signals.csv'), 'name,value\nrisk,=cmd|calc\n');
    await writeFile(join(outsideRoot, 'private.json'), '{"outside":true}\n');
    await symlink(join(outsideRoot, 'private.json'), join(projectRoot, 'escape.json'));
    const roots = [{ componentId: 'control', root: projectRoot }];

    await expect(
      readImportedEvidenceFile({
        projectRoot,
        configuredPath: 'metrics.json',
        roots,
        maxBytes: 1_000,
      }),
    ).resolves.toMatchObject({
      location: 'control/metrics.json',
      format: 'json',
      content: '{"active":12,"nested":{"safe":true}}',
    });
    await expect(
      readImportedEvidenceFile({
        projectRoot,
        configuredPath: 'signals.csv',
        roots,
        maxBytes: 1_000,
      }),
    ).resolves.toMatchObject({
      location: 'control/signals.csv',
      format: 'csv',
      content: "name,value\nrisk,'=cmd|calc\n",
    });
    await expect(
      readImportedEvidenceFile({
        projectRoot,
        configuredPath: 'escape.json',
        roots,
        maxBytes: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PATH_ESCAPE' });
  });
});

describe('untrusted text and secret handling', () => {
  it('removes bidi controls, ANSI escapes, secrets, PII, and local usernames', () => {
    expect(normalizeUntrustedText('left\u202eright\u200b\u001b[31mred\u001b[0m')).toBe(
      'leftrightred',
    );
    const redacted = redactSensitiveText(
      [
        'authorization: Bearer should-never-survive',
        'token=npm_abcdefghijklmnopqrstuvwxyz',
        'linear=lin_api_abcdefghijklmnopqrstuvwxyz123456',
        '{"apiKey":"opaque-credential-0123456789abcdef"}',
        "clientSecret: 'another-opaque-credential-123456789'",
        'owner@example.com',
        '/Users/private-user/work/project',
      ].join('\n'),
    );
    expect(redacted.value).not.toContain('should-never-survive');
    expect(redacted.value).not.toContain('npm_abcdefghijklmnopqrstuvwxyz');
    expect(redacted.value).not.toContain('lin_api_abcdefghijklmnopqrstuvwxyz123456');
    expect(redacted.value).not.toContain('opaque-credential-0123456789abcdef');
    expect(redacted.value).not.toContain('another-opaque-credential-123456789');
    expect(redacted.value).not.toContain('owner@example.com');
    expect(redacted.value).not.toContain('private-user');
    expect(containsSecret(redacted.value)).toBe(false);
    expect(redacted.redactions).toEqual(
      expect.arrayContaining([
        'authorization',
        'email',
        'known-token',
        'structured-secret',
        'user-home',
      ]),
    );
  });

  it('detects raw structured and provider-specific secrets but accepts redacted fields', () => {
    expect(containsSecret('lin_api_abcdefghijklmnopqrstuvwxyz123456')).toBe(true);
    expect(containsSecret('{"apiKey":"opaque-credential-0123456789abcdef"}')).toBe(true);
    expect(containsSecret('apiKey: [REDACTED]')).toBe(false);
  });

  it('redacts the safe assignment corpus without false quarantine or syntax corruption', () => {
    for (const fixture of safeRedactionCorpus) {
      const first = redactSensitiveText(fixture.input);
      const second = redactSensitiveText(first.value);
      expect(first.value, fixture.id).toBe(fixture.expected);
      expect(second.value, `${fixture.id} must be byte-idempotent`).toBe(first.value);
      expect(containsSecret(first.value), fixture.id).toBe(false);
    }
  });

  it('preserves genuine secret-shape detection while keeping scanner sentinels inert', () => {
    const genuineSecretShapes = [
      'authorization: Bearer synthetic-bearer-value',
      'lin_api_abcdefghijklmnopqrstuvwxyz123456',
      'eyJzeW50aGV0aWMiOiJvbmx5In0.eyJub3QiOiJhLXJlYWwtdG9rZW4ifQ.synthetic_signature',
      'https://synthetic-user:synthetic-password@example.invalid/path',
      'clientSecret: synthetic-example-only',
      'OPENPLANR_API_KEY=synthetic-example-only',
      '-----BEGIN PRIVATE KEY-----\nsynthetic-test-material-only\n-----END PRIVATE KEY-----',
    ];

    for (const value of genuineSecretShapes) {
      expect(containsSecret(value), value.split('\n')[0]).toBe(true);
      const redacted = redactSensitiveText(value);
      expect(containsSecret(redacted.value), redacted.value).toBe(false);
      expect(redactSensitiveText(redacted.value).value).toBe(redacted.value);
    }
  });

  it('sanitizes generated active and remotely loaded content', () => {
    const sanitized = sanitizeGeneratedPlainText(
      '<script>alert(1)</script> javascript:run ![pixel](https://tracker.example/p.gif)',
    );
    expect(sanitized).toContain('[REMOVED_SCRIPT]');
    expect(sanitized).toContain('blocked:run');
    expect(sanitized).toContain('[REMOTE_IMAGE_REMOVED]');
    expect(sanitized).not.toContain('tracker.example');
  });
});

describe('filesystem and provider read-only boundaries', () => {
  it('confines existing paths and symlink targets to the project root', async () => {
    const projectRoot = await temporaryDirectory('openplanr-operate-project-');
    const outsideRoot = await temporaryDirectory('openplanr-operate-outside-');
    await writeFile(join(projectRoot, 'inside.json'), '{}\n');
    await writeFile(join(outsideRoot, 'secret.json'), '{"secret":true}\n');
    await symlink(outsideRoot, join(projectRoot, 'escape'));

    await expect(
      resolveContainedPath(projectRoot, 'inside.json', { mustExist: true }),
    ).resolves.toBe(await realpath(join(projectRoot, 'inside.json')));
    await expect(resolveContainedPath(projectRoot, '../outside.json')).rejects.toMatchObject({
      code: 'E_OPERATE_PATH_ESCAPE',
    });
    await expect(
      resolveContainedPath(projectRoot, 'escape/secret.json', { mustExist: true }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PATH_ESCAPE' });
    await expect(resolveContainedPath(projectRoot, '/tmp/absolute')).rejects.toMatchObject({
      code: 'E_OPERATE_PATH_ESCAPE',
    });
  });

  it('allows evidence reads but rejects mutation and repository-root overrides', () => {
    expect(() => assertGitReadOnlyArgs(['status', '--short'])).not.toThrow();
    expect(() => assertGitReadOnlyArgs(['commit', '-m', 'forbidden'])).toThrow(
      /not allowlisted|forbidden/i,
    );
    expect(() => assertGitReadOnlyArgs(['--work-tree=/tmp', 'status'])).toThrow(
      /read-only|forbidden|allowlisted/i,
    );

    expect(() =>
      assertGitHubReadOnlyArgs(['issue', 'list', '--json', 'number,title']),
    ).not.toThrow();
    expect(() => assertGitHubReadOnlyArgs(['issue', 'create'])).toThrow(/not allowlisted/);
    expect(() => assertGitHubReadOnlyArgs(['issue', 'list', '--jq', '.[]'])).toThrow(
      /cannot open browsers or execute output templates/,
    );
  });

  it('blocks non-query Linear operations before invoking the transport', async () => {
    expect(() =>
      assertLinearReadOnlyQuery(
        'https://api.linear.app/graphql',
        'query Issues { issues { nodes { id } } }',
      ),
    ).not.toThrow();
    expect(() =>
      assertLinearReadOnlyQuery(
        'https://api.linear.app/graphql',
        'mutation DeleteIssue { issueDelete(id: "x") { success } }',
      ),
    ).toThrow(/query operations only/);
    expect(() =>
      assertLinearReadOnlyQuery('https://example.com/graphql', '{ viewer { id } }'),
    ).toThrow(/endpoint must be/);

    const query = vi.fn();
    const transport = new ReadOnlyLinearTransport({
      endpoint: 'https://api.linear.app/graphql',
      query,
    });
    await expect(
      transport.query('subscription Events { issueUpdate { id } }'),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PROVIDER_READ_ONLY' });
    expect(query).not.toHaveBeenCalled();
  });

  it('enforces canonical REST hosts, GET/HEAD-only methods, redirects, and byte bounds', async () => {
    expect(() =>
      assertReadOnlyRestRequest('https://api.github.com/repos/openplanr/OpenPlanr', 'GET', [
        'api.github.com',
      ]),
    ).not.toThrow();
    expect(() =>
      assertReadOnlyRestRequest('https://api.github.com/repos/x/y', 'POST', ['api.github.com']),
    ).toThrow(/GET and HEAD only/);
    expect(() =>
      assertReadOnlyRestRequest('https://api.github.com.evil.invalid/repos/x/y', 'GET', [
        'api.github.com',
      ]),
    ).toThrow(/not allowlisted/);

    await expect(
      executeRestReadOnlyJson('https://api.github.com/repos/x/y/issues', {
        allowedHosts: ['api.github.com'],
        maxBytes: 8,
        fetchImpl: vi.fn(
          async () =>
            new Response('{"oversized":true}', {
              status: 200,
              headers: {
                'content-type': 'application/json',
                'content-length': '18',
              },
            }),
        ),
      }),
    ).rejects.toThrow(/Content-Length/);
    await expect(
      executeRestReadOnlyJson('https://api.github.com/repos/x/y/issues', {
        allowedHosts: ['api.github.com'],
        maxBytes: 8,
        fetchImpl: vi.fn(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode('{"streamed":'));
                  controller.enqueue(new TextEncoder().encode('"too-large"}'));
                  controller.close();
                },
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            ),
        ),
      }),
    ).rejects.toThrow(/streamed response exceeds/);
    await expect(
      executeRestReadOnlyJson('https://api.github.com/repos/x/y/issues', {
        allowedHosts: ['api.github.com'],
        fetchImpl: vi.fn(
          async () =>
            new Response('', {
              status: 302,
              headers: { location: 'https://api.github.com/elsewhere' },
            }),
        ),
      }),
    ).rejects.toThrow(/redirect/i);
  });

  it('bounds Linear responses while rejecting mutations before network access', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { teams: { nodes: [] } } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(
      executeLinearReadOnlyQuery({
        token: 'fixture-token',
        query: 'mutation Unsafe { issueDelete(id: "x") { success } }',
        allowedHosts: ['api.linear.app'],
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_PROVIDER_READ_ONLY' });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      executeLinearReadOnlyQuery<{ teams: { nodes: unknown[] } }>({
        token: 'fixture-token',
        query: 'query Teams { teams { nodes { id } } }',
        allowedHosts: ['api.linear.app'],
        fetchImpl,
      }),
    ).resolves.toEqual({ teams: { nodes: [] } });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://api.linear.app/graphql'),
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
  });
});
