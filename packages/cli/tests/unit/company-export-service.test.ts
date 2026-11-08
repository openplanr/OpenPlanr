import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packCompanyResourceBundle } from '../../../artifact/lib/artifact/resource-pack.mjs';
import { canonicalizeJson } from '../../../protocol/src/canonical-json.mjs';
import * as companyAuth from '../../src/services/company-auth-service.js';

const diskFault = vi.hoisted(() => ({ partialWrite: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (diskFault.partialWrite && String(args[0]).endsWith('/content.txt')) {
        diskFault.partialWrite = false;
        await actual.writeFile(args[0], 'partial', args[2]);
        throw Object.assign(new Error('Simulated partial disk write'), { code: 'ENOSPC' });
      }
      return actual.writeFile(...args);
    },
  };
});

const origin = 'https://company.example.test';
const token = 'organization-export-test-credential';
const at = '2026-11-08T10:00:00.000Z';
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const project = {
  projectId: 'p1',
  organizationId: 'org1',
  slug: 'project',
  name: '../Project',
  status: 'active',
  capabilities: ['artifact.read', 'artifact.export'],
};
const catalogRoute = '/v1/project-catalog?status=all&pageSize=100';
const adminNotice =
  'admin listing unavailable: needs an MFA-verified browser session; projects without a role not checked';
const catalogPage = (items: unknown[] = [project], nextCursor: unknown = null) => ({
  kind: 'openplanr-enterprise-project-page',
  schemaVersion: '1.0.0',
  protocolVersion: '1.19.0',
  query: {
    organizationId: 'org1',
    actorId: 'actor1',
    scope: 'projects',
    filter: { status: 'all', search: '' },
  },
  items,
  nextCursor,
});
const artifact = { id: 'a1', organizationId: 'org1', projectId: 'p1', title: '../Artifact' };
const revision = (id = 'r1', artifactId = 'a1', content = 'hello') => ({
  kind: 'openplanr-enterprise-artifact-revision',
  schemaVersion: '1.0.0',
  id,
  organizationId: 'org1',
  projectId: 'p1',
  artifactId,
  parentRevisionId: null,
  contentDigest: hash(content),
  contentType: 'text/markdown',
  byteLength: Buffer.byteLength(content),
  createdAt: at,
  actorId: 'actor1',
});
const thread = (id: string, revisionId = 'r1') => ({
  id,
  organizationId: 'org1',
  projectId: 'p1',
  artifactId: 'a1',
  anchor: { revisionId },
  body: 'Review this',
  replies: [{ body: 'Reply retained' }],
});
const handoff = (revisionId: string, artifactId = 'a1') => ({
  kind: 'openplanr-enterprise-agent-handoff',
  schemaVersion: '1.0.0',
  organizationId: 'org1',
  projectId: 'p1',
  artifactId,
  revisionId,
  threads: [],
});
let root: string;
let out: string;
let routes: Map<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const base = '/v1/projects/p1/artifacts/a1';
const exportOrganization = async () => {
  const { exportCompanyOrganization } = await import(
    '../../src/services/company-export-service.js'
  );
  return exportCompanyOrganization(origin, out);
};
const manifest = async () => JSON.parse(await readFile(path.join(out, 'manifest.json'), 'utf8'));
const output = (relative: string) => readFile(path.join(out, relative));
const revisionDir = 'projects/p1/artifacts/a1/revisions/r1';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'company-export-'));
  out = path.join(root, 'export');
  vi.stubEnv('PLANR_COMPANY_TOKEN', token);
  routes = new Map([
    [catalogRoute, () => json(catalogPage())],
    ['/v1/admin/projects?cursor=0', () => json({ error: { code: 'E_MFA_REQUIRED' } }, 403)],
    ['/v1/projects/p1/artifacts?cursor=0', () => json({ artifacts: [artifact], nextCursor: null })],
    [base + '/revisions?cursor=0', () => json({ revisions: [revision()], nextCursor: null })],
    [
      base + '/content?revisionId=r1',
      () =>
        new Response('hello', {
          headers: {
            'content-type': 'text/markdown',
            'x-openplanr-content-digest': hash('hello'),
            etag: `"${hash('hello')}"`,
          },
        }),
    ],
    [base + '/export?format=json&revisionId=r1', () => json(handoff('r1'))],
  ]);
  fetchMock = vi.fn(async (input: string, init: RequestInit) => {
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(input.includes(token)).toBe(false);
    expect(init.redirect).toBe('error');
    expect(new Headers(init.headers).get('authorization') === `Bearer ${token}`).toBe(true);
    const url = new URL(input);
    expect(url.origin).toBe(origin);
    const respond = routes.get(url.pathname + url.search);
    if (!respond) throw new Error('Unexpected mocked route: ' + url.pathname + url.search);
    return respond();
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(async () => {
  diskFault.partialWrite = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('organization export', () => {
  it('exports every artifact and revision page with verified file accounting', async () => {
    routes.set('/v1/projects/p1/artifacts?cursor=0', () =>
      json({ artifacts: [artifact], nextCursor: 50 }),
    );
    routes.set('/v1/projects/p1/artifacts?cursor=50', () =>
      json({ artifacts: [{ ...artifact, id: 'a2' }], nextCursor: null }),
    );
    routes.set(base + '/revisions?cursor=0', () =>
      json({ revisions: [revision()], nextCursor: 72 }),
    );
    routes.set(base + '/revisions?cursor=72', () =>
      json({ revisions: [revision('r2')], nextCursor: null }),
    );
    routes.set(
      base + '/content?revisionId=r2',
      routes.get(base + '/content?revisionId=r1') as () => Response,
    );
    routes.set(base + '/export?format=json&revisionId=r2', () => json(handoff('r2')));
    routes.set('/v1/projects/p1/artifacts/a2/revisions?cursor=0', () =>
      json({ revisions: [], nextCursor: null }),
    );
    const result = await exportOrganization();
    expect(result.complete).toBe(true);
    const saved = await manifest();
    expect(saved.summary).toMatchObject({
      projects: 1,
      artifacts: 2,
      revisions: 2,
      notExported: 0,
    });
    expect(saved.apiUrl).toBe(origin);
    expect(saved.summary.files).toBe(saved.files.length);
    let bytes = 0;
    for (const file of saved.files) {
      const value = await output(file.path);
      expect(value.byteLength).toBe(file.byteLength);
      expect(hash(value)).toBe(file.sha256);
      bytes += value.byteLength;
      expect(file.path).not.toContain('..');
    }
    expect(saved.summary.bytes).toBe(bytes);
    expect(saved.notices).toContain(adminNotice);
  });

  it('exports more than 100 projects over three catalog pages, echoing string cursors until null', async () => {
    const projects = Array.from({ length: 102 }, (_, index) => ({
      ...project,
      projectId: `p${index}`,
    }));
    routes.set(catalogRoute, () => json(catalogPage(projects.slice(0, 100), 'page_2-A')));
    routes.set(catalogRoute + '&cursor=page_2-A', () =>
      json(catalogPage(projects.slice(100, 101), 'page_3-B')),
    );
    routes.set(catalogRoute + '&cursor=page_3-B', () => json(catalogPage(projects.slice(101))));
    for (const row of projects)
      routes.set(`/v1/projects/${row.projectId}/artifacts?cursor=0`, () =>
        json({ artifacts: [], nextCursor: null }),
      );
    await exportOrganization();
    const saved = await manifest();
    expect(saved.complete).toBe(true);
    expect(saved.summary.projects).toBe(102);
    expect(
      fetchMock.mock.calls.filter(([url]) => url.includes('/project-catalog')).map(([url]) => url),
    ).toEqual([
      origin + catalogRoute,
      origin + catalogRoute + '&cursor=page_2-A',
      origin + catalogRoute + '&cursor=page_3-B',
    ]);
    expect(JSON.parse((await output('projects/p101/project.json')).toString())).toEqual(
      projects[101],
    );
  });

  it('lists all non-active catalog rows and fails without reading their artifacts', async () => {
    const archived = ['archived', 'archiving', 'restoring'].map((status, index) => ({
      ...project,
      projectId: `old${index + 1}`,
      name: `Old ${index + 1}`,
      status,
    }));
    routes.set(catalogRoute, () => json(catalogPage([project, archived[0]], 'next_page')));
    routes.set(catalogRoute + '&cursor=next_page', () => json(catalogPage(archived.slice(1))));
    await expect(exportOrganization()).rejects.toThrow(
      /old1.*archived; restore first.*old2.*archived; restore first.*old3.*archived; restore first/,
    );
    const saved = await manifest();
    expect(saved.complete).toBe(false);
    expect(saved.summary.projects).toBe(1);
    expect(saved.notExported).toEqual(
      archived.map((row) => ({ project: row, reason: 'archived; restore first' })),
    );
    expect(fetchMock.mock.calls.some(([url]) => /projects\/old/.test(url))).toBe(false);
  });

  it.each([0, '', 'a=b', 'a/b', 'a'.repeat(2049), undefined])(
    'rejects invalid catalog cursor %#',
    async (cursor) => {
      routes.set(catalogRoute, () => json(catalogPage([], cursor)));
      if (cursor === undefined)
        routes.set(catalogRoute, () => json({ ...catalogPage([]), nextCursor: undefined }));
      await expect(exportOrganization()).rejects.toThrow(/catalog.*cursor/);
      expect((await manifest()).complete).toBe(false);
    },
  );

  it('rejects a repeated catalog cursor', async () => {
    routes.set(catalogRoute, () => json(catalogPage([], 'same')));
    routes.set(catalogRoute + '&cursor=same', () => json(catalogPage([], 'same')));
    await expect(exportOrganization()).rejects.toThrow(/catalog.*cursor/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails explicitly when catalog pagination exceeds its bounded window', async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => json(catalogPage([], `page${++calls}`)));
    await expect(exportOrganization()).rejects.toThrow(/catalog pagination exceeded/);
    expect(calls).toBe(2000);
    expect((await manifest()).complete).toBe(false);
  });

  it.each(['duplicate', 'organization', 'status', 'status-array'])(
    'rejects catalog %s drift across pages',
    async (drift) => {
      routes.set(catalogRoute, () => json(catalogPage([project], 'next')));
      const next = {
        ...project,
        projectId: drift === 'duplicate' ? 'p1' : 'p2',
        organizationId: drift === 'organization' ? 'foreign' : 'org1',
        status: drift === 'status' ? 'unknown' : drift === 'status-array' ? ['active'] : 'active',
      };
      routes.set(catalogRoute + '&cursor=next', () => json(catalogPage([next])));
      await expect(exportOrganization()).rejects.toThrow(
        /Duplicate project|different organizations|project status/,
      );
      expect((await manifest()).complete).toBe(false);
    },
  );

  it('follows admin pages and records projects without a role without failing', async () => {
    routes.set('/v1/admin/projects?cursor=0', () =>
      json({ projects: [{ id: 'p1', name: 'Mine' }], nextCursor: 50 }),
    );
    routes.set('/v1/admin/projects?cursor=50', () =>
      json({ projects: [{ id: 'no-role', name: 'Restricted' }], nextCursor: null }),
    );
    await exportOrganization();
    expect(await manifest()).toMatchObject({
      complete: true,
      notExported: [{ project: { id: 'no-role' }, reason: 'no readable project role' }],
    });
  });

  it.each(['E_ROLE', 'E_MFA_REQUIRED', 'E_REVERIFICATION_REQUIRED'])(
    'records admin refusal %s without preventing export',
    async (code) => {
      routes.set('/v1/admin/projects?cursor=0', () =>
        json({ error: { code, message: token } }, 403),
      );
      await exportOrganization();
      expect(await manifest()).toMatchObject({ complete: true, notices: [adminNotice] });
    },
  );

  it.each([
    [500, 'E_INTERNAL'],
    [403, 'E_MEMBERSHIP'],
    [500, 'E_SESSION_REVOKED'],
    [500, `E_${'A'.repeat(64)}`],
  ])('surfaces unexpected admin failure %s %s without server text', async (status, code) => {
    routes.set('/v1/admin/projects?cursor=0', () =>
      json({ error: { code, message: token } }, status),
    );
    await expect(exportOrganization()).rejects.toThrow('admin projects');
    const saved = await manifest();
    expect(saved.complete).toBe(false);
    expect(saved.error).toContain(code);
    expect(JSON.stringify(saved).includes(token)).toBe(false);
  });

  it.each(['E_bad', 'E_', `E_${'A'.repeat(65)}`, 'E_BAD\n', token])(
    'omits malformed API error code %# and free text',
    async (code) => {
      routes.set('/v1/admin/projects?cursor=0', () =>
        json({ error: { code, message: token } }, 500),
      );
      await expect(exportOrganization()).rejects.toThrow('Company request failed (500).');
      expect((await manifest()).error).toBe('admin projects: Company request failed (500).');
    },
  );

  it('preserves the JSON parse cause without changing the reported export error', async () => {
    routes.set(catalogRoute, () => new Response('{'));
    await expect(exportOrganization()).rejects.toMatchObject({
      code: 'E_COMPANY_EXPORT',
      message: 'project catalog: Invalid company JSON response.',
      cause: {
        code: 'E_COMPANY_EXPORT',
        message: 'Invalid company JSON response.',
        cause: expect.any(SyntaxError),
      },
    });
    expect((await manifest()).error).toBe('project catalog: Invalid company JSON response.');
  });

  it.each([403, 413, 500])('retains HTTP %s and its malformed error-body cause', async (status) => {
    routes.set(base + '/export?format=json&revisionId=r1', () => new Response('{', { status }));
    await expect(exportOrganization()).rejects.toMatchObject({
      code: 'E_COMPANY_EXPORT',
      message: `project p1, artifact a1, revision r1: Company request failed (${status}).`,
      cause: {
        code: 'E_COMPANY_REQUEST',
        status,
        apiCode: undefined,
        cause: {
          code: 'E_COMPANY_EXPORT',
          message: 'Invalid company JSON response.',
          cause: expect.any(SyntaxError),
        },
      },
    });
    expect((await manifest()).complete).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/reviews?'))).toBe(false);
  });

  it('renews a rejected stored credential through the shared request helper', async () => {
    vi.stubEnv('PLANR_COMPANY_TOKEN', undefined);
    const expired = 'expired-organization-export-credential';
    const resolve = vi.spyOn(companyAuth, 'resolveCompanyAccessToken').mockResolvedValue(token);
    resolve.mockResolvedValueOnce(expired);
    fetchMock.mockImplementationOnce(async (_input: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('authorization') === `Bearer ${expired}`).toBe(true);
      return json({ error: { code: 'E_AUTH' } }, 401);
    });
    await exportOrganization();
    expect(resolve).toHaveBeenCalledWith(origin, { rejectedAccessToken: expired });
    for (const file of [
      'manifest.json',
      ...(await manifest()).files.map((f: { path: string }) => f.path),
    ]) {
      const bytes = await output(file);
      expect(bytes.includes(Buffer.from(expired))).toBe(false);
      expect(bytes.includes(Buffer.from(token))).toBe(false);
    }
  });

  it('never converts an oversized HTTP error into a successful review fallback', async () => {
    routes.set(
      base + '/export?format=json&revisionId=r1',
      () => new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 500 }),
    );
    routes.set(base + '/reviews?cursor=0', () => json({ threads: [], nextCursor: null }));
    await expect(exportOrganization()).rejects.toThrow(/500/);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/reviews?'))).toBe(false);
  });

  it.each(['digest', 'headers', 'length'])(
    'rejects inline %s mismatch naming its scope',
    async (failure) => {
      if (failure === 'digest')
        routes.set(
          base + '/content?revisionId=r1',
          () => new Response('wrong', { headers: { 'content-type': 'text/markdown' } }),
        );
      if (failure === 'headers')
        routes.set(
          base + '/content?revisionId=r1',
          () => new Response('hello', { headers: { 'content-type': 'text/html' } }),
        );
      if (failure === 'length')
        routes.set(base + '/revisions?cursor=0', () =>
          json({ revisions: [{ ...revision(), byteLength: 4 }], nextCursor: null }),
        );
      await expect(exportOrganization()).rejects.toThrow(/project p1.*artifact a1.*revision r1/);
      expect((await manifest()).complete).toBe(false);
    },
  );

  it('falls back to every review page only on 413 E_EXPORT_LIMIT', async () => {
    routes.set(base + '/export?format=json&revisionId=r1', () =>
      json({ error: { code: 'E_EXPORT_LIMIT' } }, 413),
    );
    routes.set(base + '/reviews?cursor=0', () =>
      json({ threads: [thread('t1'), thread('other', 'r2')], nextCursor: 19 }),
    );
    routes.set(base + '/reviews?cursor=19', () =>
      json({ threads: [thread('t2')], nextCursor: null }),
    );
    await exportOrganization();
    expect((await manifest()).reviews).toContainEqual(
      expect.objectContaining({ revisionId: 'r1', source: 'paginated' }),
    );
    expect(
      JSON.parse((await output(revisionDir + '/reviews.json')).toString()).threads.map(
        (t: { id: string }) => t.id,
      ),
    ).toEqual(['t1', 't2']);
  });

  it.each([true, false])(
    'reads large synchronous review exports without fallback; length header=%s',
    async (header) => {
      const threads = Array.from({ length: 3 }, (_, i) => ({
        ...thread(`t${i}`),
        replies: Array.from({ length: 100 }, () => ({ body: 'a'.repeat(9000) })),
      }));
      const body = JSON.stringify({ ...handoff('r1'), threads });
      routes.set(
        base + '/export?format=json&revisionId=r1',
        () =>
          new Response(body, {
            headers: header ? { 'content-length': String(Buffer.byteLength(body)) } : {},
          }),
      );
      await exportOrganization();
      expect((await manifest()).reviews[0].source).toBe('export');
      expect(JSON.parse((await output(revisionDir + '/reviews.json')).toString()).threads).toEqual(
        threads,
      );
      expect(fetchMock.mock.calls.some(([url]) => url.includes('/reviews?'))).toBe(false);
    },
  );

  it('surfaces a review response exceeding the larger limit without fallback', async () => {
    routes.set(
      base + '/export?format=json&revisionId=r1',
      () => new Response('', { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } }),
    );
    routes.set(base + '/reviews?cursor=0', () => json({ threads: [], nextCursor: null }));
    await expect(exportOrganization()).rejects.toThrow('exceeded its supported size');
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/reviews?'))).toBe(false);
  });

  it('exports complete review pages larger than the synchronous response cap', async () => {
    routes.set(base + '/export?format=json&revisionId=r1', () =>
      json({ error: { code: 'E_EXPORT_LIMIT' } }, 413),
    );
    const threads = Array.from({ length: 3 }, (_, i) => ({
      ...thread(`t${i}`),
      replies: Array.from({ length: 100 }, () => ({ body: 'a'.repeat(9000) })),
    }));
    routes.set(base + '/reviews?cursor=0', () => json({ threads, nextCursor: null }));
    await exportOrganization();
    const saved = JSON.parse((await output(revisionDir + '/reviews.json')).toString());
    expect(saved.threads).toHaveLength(3);
    expect(saved.threads[2].replies).toHaveLength(100);
  });

  it.each([413, 500])('does not fall back for unrelated export failures: %s', async (status) => {
    routes.set(base + '/export?format=json&revisionId=r1', () =>
      json({ error: { code: 'E_OTHER' } }, status),
    );
    await expect(exportOrganization()).rejects.toThrow(/artifact a1.*revision r1/);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/reviews?'))).toBe(false);
  });

  it.each([0, -1, 'opaque', undefined])(
    'rejects invalid pagination cursor %s',
    async (nextCursor) => {
      routes.set(base + '/revisions?cursor=0', () => json({ revisions: [], nextCursor }));
      await expect(exportOrganization()).rejects.toThrow(/cursor/);
      expect((await manifest()).complete).toBe(false);
    },
  );

  it('rejects unsafe IDs before constructing filesystem or request paths', async () => {
    routes.set(catalogRoute, () => json(catalogPage([{ ...project, projectId: '../escape' }])));
    await expect(exportOrganization()).rejects.toThrow(/identifier/);
    expect((await manifest()).complete).toBe(false);
  });

  it.each(['occupied', 'file', 'symlink'])(
    'refuses %s output before requesting anything',
    async (kind) => {
      if (kind === 'file') await writeFile(out, 'keep');
      else {
        await mkdir(out);
        if (kind === 'occupied') await writeFile(path.join(out, 'keep'), 'keep');
        else {
          const target = out;
          out = path.join(root, 'link');
          await symlink(target, out);
        }
      }
      await expect(exportOrganization()).rejects.toThrow(/empty|directory|symbolic/);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('never writes credentials into files, the manifest, stdout or stderr', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await exportOrganization();
    for (const file of [
      'manifest.json',
      ...(await manifest()).files.map((f: { path: string }) => f.path),
    ])
      expect((await output(file)).includes(Buffer.from(token))).toBe(false);
    expect(JSON.stringify(stdout.mock.calls).includes(token)).toBe(false);
    expect(JSON.stringify(stderr.mock.calls).includes(token)).toBe(false);
  });

  it('does not expose a credential embedded in an invalid output path', async () => {
    const parent = path.join(root, token);
    await writeFile(parent, 'not a directory');
    out = path.join(parent, 'export');
    let message = '';
    try {
      await exportOrganization();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message.includes(token)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('removes a partially written payload and records the disk failure', async () => {
    diskFault.partialWrite = true;
    await expect(exportOrganization()).rejects.toThrow(/artifact a1.*revision r1.*ENOSPC/);
    expect((await manifest()).complete).toBe(false);
    await expect(output(revisionDir + '/content.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['none', 'chunk', 'catalog'])(
    'verifies and exports a multi-chunk package; corrupt=%s',
    async (corrupt) => {
      const resourceId = 'r1'.repeat(12);
      const resourceDir = `projects/p1/artifacts/a1/revisions/${resourceId}`;
      const bundle = {
        schemaVersion: '1.0.0',
        kind: 'openplanr-design-review-bundle',
        revision: 'render1',
        design: {
          id: 'design1',
          title: 'Design',
          screens: [{ id: 's1', title: 'Screen' }],
          frames: [{ id: 'desktop', label: 'Desktop', width: 1440, height: 1024 }],
          variants: [{ id: 'A', label: 'A', status: 'ready' }],
          screenOrder: ['s1'],
          selectedVariant: 'A',
          defaultView: 'canvas',
        },
        envelope: {
          schemaVersion: '1.0.0',
          artifacts: [{ id: 's1', html: `<p>${randomBytes(1_200_000).toString('base64')}</p>` }],
          viewer: { mode: 'single' },
        },
        entries: [{ artifactId: 's1', screenId: 's1', variantId: 'A', frameId: 'desktop' }],
        state: { positions: {} },
        verification: { status: 'unverified' },
      };
      const packed = await packCompanyResourceBundle(bundle, {
        organizationId: 'org1',
        projectId: 'p1',
        artifactId: 'a1',
        revisionId: resourceId,
      });
      expect(packed.chunks.length).toBeGreaterThan(1);
      if (corrupt === 'catalog') packed.manifest.contentDigest = `sha256:${'0'.repeat(64)}`;
      const remote = {
        ...revision(resourceId),
        schemaVersion: '1.1.0',
        protocolVersion: '1.17.0',
        contentType: 'application/json',
        byteLength: packed.manifest.byteLength,
        contentDigest: packed.manifest.contentDigest,
        contentReference: {
          transport: 'resources-v2',
          manifestSha256: hash(canonicalizeJson(packed.manifest)),
        },
      };
      routes.set(base + '/revisions?cursor=0', () =>
        json({ revisions: [remote], nextCursor: null }),
      );
      routes.set(base + `/revisions/${resourceId}/manifest`, () => json(packed.manifest));
      routes.set(base + `/export?format=json&revisionId=${resourceId}`, () =>
        json(handoff(resourceId)),
      );
      for (const [i, bytes] of packed.chunks.entries())
        routes.set(base + `/revisions/${resourceId}/chunks/${i}`, () => {
          const copy = Uint8Array.from(bytes);
          if (corrupt === 'chunk' && i === 1) copy[0] ^= 1;
          return new Response(copy);
        });
      if (corrupt === 'catalog') {
        await expect(exportOrganization()).rejects.toMatchObject({
          code: 'E_COMPANY_EXPORT',
          message:
            'project p1, artifact a1, revision ' +
            resourceId +
            ': Resource catalog, chunk or reassembled content failed integrity verification.',
          cause: {
            code: 'E_COMPANY_EXPORT',
            cause: new TypeError('Company catalog identity differs.'),
          },
        });
        expect((await manifest()).complete).toBe(false);
      } else if (corrupt === 'chunk') {
        await expect(exportOrganization()).rejects.toThrow(/artifact a1.*revision r1.*chunk/);
        expect((await manifest()).complete).toBe(false);
      } else {
        await exportOrganization();
        expect(JSON.parse((await output(resourceDir + '/content.json')).toString())).toEqual(
          bundle,
        );
        expect(
          JSON.parse((await output(resourceDir + '/resource-manifest.json')).toString()),
        ).toEqual(packed.manifest);
        for (const [i, bytes] of packed.chunks.entries())
          expect((await output(resourceDir + `/chunks/${i}.bin`)).equals(Buffer.from(bytes))).toBe(
            true,
          );
      }
    },
  );
});
