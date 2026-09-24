import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBundle } from '../../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { compileDiagramCommand } from '../../../artifact/lib/artifact/diagram/authoring/commands.mjs';
import { createDiagramAuthoringStore } from '../../../artifact/lib/artifact/diagram/authoring/store.mjs';
import * as companyAuth from '../../src/services/company-auth-service.js';
import {
  adoptCompanyDiagramRevision,
  applyCompanyProposal,
  companyApi,
  companyBindingStatus,
  DEFAULT_COMPANY_API_ORIGIN,
  normalizeCompanyOrigin,
  previewCompanyDiagramAdoption,
  previewCompanyProposal,
  previewCompanyPublication,
  previewCompanyPull,
  previewCompanyPush,
  publishCompanyPreview,
  pullCompanyBinding,
  pushCompanyBinding,
  resolveCompanyOrigin,
} from '../../src/services/company-sync-service.js';
import { resolvePipelinePackage } from '../../src/services/pipeline-package-service.js';

vi.mock('../../src/services/pipeline-package-service.js', () => ({
  resolvePipelinePackage: vi.fn(),
}));
const diskFault = vi.hoisted(() => ({
  beforeRename: undefined as undefined | ((source: string, target: string) => Promise<void>),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: async (source: string, target: string) => {
      await diskFault.beforeRename?.(source, target);
      return actual.rename(source, target);
    },
  };
});

let root: string;
const artifact = { id: 'a1', organizationId: 'org1', projectId: 'p1' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const at = '2026-09-13T09:00:00.000Z';
const firstRevision = (content = '{}') => ({
  id: 'r1',
  organizationId: 'org1',
  projectId: 'p1',
  artifactId: 'a1',
  parentRevisionId: null,
  contentDigest: hash(content),
});
const preview = () =>
  previewCompanyPublication(root, {
    filePath: 'diagram.json',
    apiUrl: 'https://api.example.com',
    projectId: 'p1',
    kind: 'diagram',
  });
async function publish() {
  const result = await preview();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ artifact }))
      .mockResolvedValueOnce(
        json({ revision: firstRevision(await readFile(path.join(root, 'diagram.json'), 'utf8')) }),
      ),
  );
  await publishCompanyPreview(root, result.preview.id);
  return result.preview.id;
}
async function installRuntimeFixture() {
  const runtime = path.join(root, '.local', 'runtime-fixture');
  await mkdir(path.join(runtime, 'lib/protocol'), { recursive: true });
  await mkdir(path.join(runtime, 'lib/artifact/diagram'), { recursive: true });
  await mkdir(path.join(runtime, 'lib/artifact/diagram/authoring'), { recursive: true });
  for (const module of ['enterprise-contracts', 'canonical-json']) {
    const canonical = new URL(`../../../protocol/src/${module}.mjs`, import.meta.url);
    await writeFile(
      path.join(runtime, `lib/protocol/${module}.mjs`),
      `export * from ${JSON.stringify(canonical.href)};`,
    );
  }
  const diagram = new URL('../../../artifact/lib/artifact/diagram/index.mjs', import.meta.url);
  await writeFile(
    path.join(runtime, 'lib/artifact/diagram/index.mjs'),
    `export * from ${JSON.stringify(diagram.href)};`,
  );
  const authoring = new URL(
    '../../../artifact/lib/artifact/diagram/authoring/index.mjs',
    import.meta.url,
  );
  await writeFile(
    path.join(runtime, 'lib/artifact/diagram/authoring/index.mjs'),
    `export * from ${JSON.stringify(authoring.href)};`,
  );
  const store = new URL(
    '../../../artifact/lib/artifact/diagram/authoring/store.mjs',
    import.meta.url,
  );
  await writeFile(
    path.join(runtime, 'lib/artifact/diagram/authoring/store.mjs'),
    `export * from ${JSON.stringify(store.href)};`,
  );
  await mkdir(path.join(runtime, 'lib/artifact/diagram/editor'), { recursive: true });
  const editor = new URL(
    '../../../artifact/lib/artifact/diagram/editor/index.mjs',
    import.meta.url,
  );
  await writeFile(
    path.join(runtime, 'lib/artifact/diagram/editor/index.mjs'),
    `export * from ${JSON.stringify(editor.href)};`,
  );
  vi.mocked(resolvePipelinePackage).mockReturnValue({
    root: runtime,
    version: '0.44.0',
  } as ReturnType<typeof resolvePipelinePackage>);
  const fixture = new URL(
    '../../../artifact/fixtures/diagram/grammars/sequence.planr-diagram.json',
    import.meta.url,
  );
  await writeFile(path.join(root, 'diagram.json'), await readFile(fixture));
}
async function installDesignRuntimeFixture() {
  await installRuntimeFixture();
  const runtime = resolvePipelinePackage(true);
  if (!runtime) throw new Error('Expected installed runtime fixture');
  await mkdir(path.join(runtime.root, 'lib/design'), { recursive: true });
  const helper = new URL('../../../design/lib/design/company-publication.mjs', import.meta.url);
  await writeFile(
    path.join(runtime.root, 'lib/design/company-publication.mjs'),
    `export * from ${JSON.stringify(helper.href)};`,
  );
  const fixture = await import(
    new URL('../../../design/tests/design-fixture.mjs', import.meta.url).href
  );
  const directory = path.join(root, '.planr/designs/checkout');
  return {
    ...fixture.designFixture(directory, { count: 2, variants: 2 }),
    directory,
    filePath: '.planr/designs/checkout/design-document.json',
  };
}
const previewDesign = (filePath: string) =>
  previewCompanyPublication(root, {
    filePath,
    kind: 'design',
    title: 'Checkout experience',
    apiUrl: 'https://api.example.com',
    projectId: 'p1',
  });
async function publishDesign(filePath: string) {
  const result = await previewDesign(filePath);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ artifact }))
      .mockResolvedValueOnce(json({ revision: firstRevision(result.content) })),
  );
  await publishCompanyPreview(root, result.preview.id);
  return result;
}
function proposal(
  operations = [{ op: 'set-field', targetId: 'item-a', field: 'label', value: 'Applicant' }],
) {
  return {
    kind: 'openplanr-enterprise-change-proposal',
    schemaVersion: '1.0.0',
    id: 'proposal1',
    organizationId: 'org1',
    projectId: 'p1',
    artifactId: 'a1',
    baseRevisionId: 'r1',
    authorId: 'user1',
    createdAt: at,
    status: 'proposed',
    summary: 'Clarify actor',
    operations,
    validation: { status: 'pending', issues: [] },
  };
}
function mockProposal(value: unknown = proposal()) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ proposals: [value], nextCursor: null }))
    .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'planr-company-')));
  vi.stubEnv('PLANR_COMPANY_TOKEN', 'scoped-token');
  await writeFile(path.join(root, 'diagram.json'), '{}');
});
afterEach(async () => {
  diskFault.beforeRename = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

describe('selective company publication', () => {
  it('publishes exact complete authoring bytes and applies a validated successor including presentation', async () => {
    await installRuntimeFixture();
    const relative = 'diagrams/checkout/checkout.planr-diagram-bundle.json';
    const file = path.join(root, relative);
    const bundle = makeBundle();
    const store = createDiagramAuthoringStore({ root, slug: 'checkout' });
    await store.initialize(bundle, { transactionId: 'test-initialize' });
    const original = await readFile(file, 'utf8');
    const initial = await previewCompanyPublication(root, {
      filePath: relative,
      apiUrl: 'https://api.example.com',
      projectId: 'p1',
      kind: 'diagram',
    });
    expect(initial.content).toBe(original);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact }))
        .mockResolvedValueOnce(json({ revision: firstRevision(original) })),
    );
    await publishCompanyPreview(root, initial.preview.id);
    const changed = compileDiagramCommand(
      bundle,
      { type: 'move', ids: ['node-b'], dx: 20, dy: 0 },
      { transactionId: 'proposal-move' },
    );
    expect(changed.ok).toBe(true);
    if (!changed.ok || !changed.bundle) return;
    const offered = proposal([{ op: 'replace-document', content: changed.bundle }]);
    mockProposal(offered);
    const review = await previewCompanyProposal(root, initial.preview.id, 'proposal1');
    expect(review.document).toEqual(changed.bundle);
    expect(review.changes.presentation.length).toBeGreaterThan(0);
    expect(review.changes.source).toEqual({
      originalBytesChanged: false,
      correspondenceChanged: false,
    });
    expect(await readFile(file, 'utf8')).toBe(original);
    mockProposal(offered);
    expect((await applyCompanyProposal(root, initial.preview.id, 'proposal1')).status).toBe(
      'applied-locally',
    );
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(changed.bundle);
    expect((await store.read()).bundle).toEqual(changed.bundle);
    expect(
      (await store.history()).map((entry: { transactionId: string }) => entry.transactionId),
    ).toContain('company-' + hash(`${initial.preview.id}:proposal1`).slice(0, 40));
  });
  it('rejects an invalid complete bundle before sending any publication request', async () => {
    await installRuntimeFixture();
    const relative = 'diagrams/checkout/checkout.planr-diagram-bundle.json';
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ ...makeBundle(), bundleDigest: 'invalid' }));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(
      previewCompanyPublication(root, {
        filePath: relative,
        apiUrl: 'https://api.example.com',
        projectId: 'p1',
        kind: 'diagram',
      }),
    ).rejects.toMatchObject({ code: 'E_COMPANY_AUTHORING' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('records exactly one selected file without a network request or credential persistence', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await preview();
    expect(result.selectedFiles).toEqual(['diagram.json']);
    expect(result.content).toBe('{}');
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      await readFile(
        path.join(root, '.local/company/previews', result.preview.id + '.json'),
        'utf8',
      ),
    ).not.toContain('scoped-token');
  });
  it('uses the branded hosted service by default and preserves explicit development overrides', () => {
    expect(resolveCompanyOrigin()).toBe(DEFAULT_COMPANY_API_ORIGIN);
    expect(DEFAULT_COMPANY_API_ORIGIN).toBe('https://api.openplanr.dev');
    expect(resolveCompanyOrigin('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
  });
  it('rejects unsafe origins, secret files and symlink traversal', async () => {
    for (const origin of [
      'http://company.test',
      'https://token@company.test',
      'https://company.test/path',
    ])
      expect(() => normalizeCompanyOrigin(origin)).toThrow();
    expect(normalizeCompanyOrigin('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
    await writeFile(path.join(root, '.env'), 'secret');
    await symlink(path.join(root, 'diagram.json'), path.join(root, 'link.json'));
    for (const filePath of [
      '../outside.json',
      '.env',
      'link.json',
      './diagram.json',
      'C:diagram.json',
      'bad\u0000.json',
    ])
      await expect(
        previewCompanyPublication(root, {
          filePath,
          apiUrl: 'https://api.example.com',
          projectId: 'p1',
        }),
      ).rejects.toThrow();
    await mkdir(path.join(root, 'unsafe'));
    await symlink(path.join(root, 'unsafe'), path.join(root, '.local'));
    await expect(preview()).rejects.toThrow('symbolic links');
  });
  it('enforces the API 1 MiB limit and detects recognizable credential content before preview', async () => {
    await writeFile(path.join(root, 'diagram.json'), 'x'.repeat(1_048_577));
    await expect(preview()).rejects.toThrow('1 MiB');
    await writeFile(path.join(root, 'diagram.json'), '-----BEGIN PRIVATE KEY-----');
    await expect(preview()).rejects.toThrow('credentials');
  });
  it('rejects invalid UTF-8 instead of silently changing selected file bytes', async () => {
    await writeFile(path.join(root, 'diagram.json'), Buffer.from([0x7b, 0xff, 0x7d]));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(preview()).rejects.toThrow('valid UTF-8');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses changed content before any upload', async () => {
    const result = await preview();
    await writeFile(path.join(root, 'diagram.json'), '{"changed":true}');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(publishCompanyPreview(root, result.preview.id)).rejects.toThrow(
      'changed after preview',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('publishes idempotently and survives a failed revision upload', async () => {
    const result = await preview();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(json({ revision: firstRevision() }));
    vi.stubGlobal('fetch', fetcher);
    await expect(publishCompanyPreview(root, result.preview.id)).rejects.toThrow(
      'could not be reached',
    );
    expect((await publishCompanyPreview(root, result.preview.id)).status).toBe('synchronized');
    expect((await publishCompanyPreview(root, result.preview.id)).status).toBe('already-published');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(
      fetcher.mock.calls[2][1].headers['Idempotency-Key'],
    );
    expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({
      baseRevisionId: null,
      content: '{}',
      contentType: 'application/json',
    });
  });
  it('recovers a killed first publication even when the former redundant preview lock remains', async () => {
    const result = await preview();
    await writeFile(
      path.join(root, '.local/company/previews', result.preview.id + '.json.lock'),
      '',
    );
    await mkdir(path.join(root, '.local/company/bindings'), { recursive: true });
    await writeFile(
      path.join(root, '.local/company/bindings', result.preview.id + '.json.lock'),
      JSON.stringify({ pid: 2147483647, nonce: 'terminated-publication-owner' }),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact }))
        .mockResolvedValueOnce(json({ revision: firstRevision() })),
    );
    expect((await publishCompanyPreview(root, result.preview.id)).status).toBe('synchronized');
    expect((await publishCompanyPreview(root, result.preview.id)).status).toBe('already-published');
  });
  it('reports divergence rather than overwriting local or remote work', async () => {
    const bindingId = await publish();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' })));
    await writeFile(path.join(root, 'diagram.json'), '{"new":true}');
    expect((await companyBindingStatus(root, bindingId)).status).toBe('conflicted');
    expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe('{"new":true}');
  });
  it('rejects unsupported or malformed local state and symlinked binding files', async () => {
    const bindingId = await publish();
    const file = path.join(root, '.local/company/bindings', bindingId + '.json');
    const original = JSON.parse(await readFile(file, 'utf8'));
    for (const changed of [
      { ...original, schemaVersion: '9.0.0' },
      { ...original, projectId: undefined },
      { ...original, organizationId: undefined },
      { ...original, kind: 'shell' },
    ]) {
      await writeFile(file, JSON.stringify(changed));
      await expect(companyBindingStatus(root, bindingId)).rejects.toThrow();
    }
    await rm(file);
    await symlink(path.join(root, 'diagram.json'), file);
    await expect(companyBindingStatus(root, bindingId)).rejects.toThrow('local state');
  });
  it('rejects a cross-organization status response and oversized/malformed API JSON', async () => {
    const bindingId = await publish();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ artifact: { ...artifact, organizationId: 'other' }, headRevisionId: 'r1' }),
        ),
    );
    await expect(companyBindingStatus(root, bindingId)).rejects.toThrow('does not match');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('not json'))
        .mockResolvedValueOnce(new Response('x'.repeat(2_097_153))),
    );
    await expect(companyApi('https://api.example.com', '/v1/projects')).rejects.toThrow(
      'invalid response',
    );
    await expect(companyApi('https://api.example.com', '/v1/projects')).rejects.toThrow('exceeded');
  });
});

describe('complete design company publication', () => {
  it('previews every referenced source locally while storing exact source hashes privately', async () => {
    const design = await installDesignRuntimeFixture();
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const result = await previewDesign(design.filePath);
    expect(result.preview.sourceType).toBe('design-document');
    expect(result.preview.designSummary).toMatchObject({
      screenCount: 2,
      frameCount: 2,
      variantCount: 2,
    });
    expect(result.selectedFiles).toEqual([
      '.planr/designs/checkout/design-document.json',
      '.planr/designs/checkout/source/screen-1.html',
      '.planr/designs/checkout/source/screen-2.html',
      '.planr/designs/checkout/source/style.css',
    ]);
    expect(result.preview).not.toHaveProperty('sourceDigests');
    const saved = JSON.parse(
      await readFile(
        path.join(root, '.local/company/previews', result.preview.id + '.json'),
        'utf8',
      ),
    );
    for (const file of result.selectedFiles)
      expect(saved.sourceDigests[file]).toBe(hash(await readFile(path.join(root, file), 'utf8')));
    expect(result.content).toContain('Workspace overview');
    expect(result.content).not.toContain(root);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses changed referenced assets and expanded scope after preview before network access', async () => {
    const design = await installDesignRuntimeFixture();
    const result = await previewDesign(design.filePath);
    const style = path.join(design.directory, 'source/style.css');
    const original = await readFile(style, 'utf8');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await writeFile(style, original + '\nbutton { color: black }');
    await expect(publishCompanyPreview(root, result.preview.id)).rejects.toThrow(
      'changed after preview',
    );
    await writeFile(style, original);
    design.document.screens[0].source.styles.push('source/extra.css');
    await writeFile(path.join(design.directory, 'source/extra.css'), 'h1 { color: blue }');
    await writeFile(design.file, JSON.stringify(design.document));
    await expect(publishCompanyPreview(root, result.preview.id)).rejects.toThrow(
      'changed after preview',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks source bytes even when canonical publication bytes are unchanged', async () => {
    const design = await installDesignRuntimeFixture();
    const result = await previewDesign(design.filePath);
    await writeFile(design.file, JSON.stringify(design.document));
    const refreshed = await previewDesign(design.filePath);
    expect(refreshed.content).toBe(result.content);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(publishCompanyPreview(root, result.preview.id)).rejects.toThrow(
      'changed after preview',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('publishes the exact bundle and reconstructs it for status and compare-and-set updates', async () => {
    const design = await installDesignRuntimeFixture();
    const initial = await publishDesign(design.filePath);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toEqual({
      baseRevisionId: null,
      content: initial.content,
      contentType: 'application/json',
    });
    const bindingId = initial.preview.id;
    const style = path.join(design.directory, 'source/style.css');
    await writeFile(style, (await readFile(style, 'utf8')) + '\nbutton { border-radius: 6px }');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => json({ artifact, headRevisionId: 'r1' })),
    );
    expect((await companyBindingStatus(root, bindingId)).status).toBe('local-changes');
    const update = await previewCompanyPush(root, bindingId);
    expect(update.selectedFiles).toEqual(initial.selectedFiles);
    const fetcher = vi.fn().mockResolvedValueOnce(
      json({
        revision: {
          ...firstRevision(update.content),
          id: 'r2',
          parentRevisionId: 'r1',
        },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    expect((await pushCompanyBinding(root, bindingId)).status).toBe('synchronized');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      baseRevisionId: 'r1',
      content: update.content,
      contentType: 'application/json',
    });
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe(update.preview.operationId);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ artifact, headRevisionId: 'r2' })));
    expect((await companyBindingStatus(root, bindingId)).status).toBe('synchronized');
  });
  it('refuses changed referenced content between push preview and push before upload', async () => {
    const design = await installDesignRuntimeFixture();
    const initial = await publishDesign(design.filePath);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ artifact, headRevisionId: 'r1' })));
    await previewCompanyPush(root, initial.preview.id);
    const screen = path.join(design.directory, 'source/screen-1.html');
    await writeFile(
      screen,
      (await readFile(screen, 'utf8')).replace('Workspace overview', 'Updated overview'),
    );
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(pushCompanyBinding(root, initial.preview.id)).rejects.toThrow(
      'changed after preview',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts a reviewed source-only change without a redundant hosted revision', async () => {
    const design = await installDesignRuntimeFixture();
    const initial = await publishDesign(design.filePath);
    await writeFile(design.file, JSON.stringify(design.document));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ artifact, headRevisionId: 'r1' })));
    const update = await previewCompanyPush(root, initial.preview.id);
    expect(update.status).toBe('preview');
    expect(update.content).toBe(initial.content);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect((await pushCompanyBinding(root, initial.preview.id)).status).toBe('unchanged');
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ artifact, headRevisionId: 'r1' })));
    expect((await companyBindingStatus(root, initial.preview.id)).status).toBe('synchronized');
  });
  it('rejects packaged-design proposal application before reading proposals or writing authored files', async () => {
    const design = await installDesignRuntimeFixture();
    const initial = await publishDesign(design.filePath);
    const original = await readFile(design.file, 'utf8');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(previewCompanyProposal(root, initial.preview.id, 'proposal1')).rejects.toThrow(
      'Packaged design proposals',
    );
    await expect(applyCompanyProposal(root, initial.preview.id, 'proposal1')).rejects.toThrow(
      'Packaged design proposals',
    );
    expect(await readFile(design.file, 'utf8')).toBe(original);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains ordinary single-file HTML designs', async () => {
    await writeFile(path.join(root, 'screen.html'), '<h1>Checkout</h1>');
    const result = await previewDesign('screen.html');
    expect(result.preview.sourceType).toBeUndefined();
    expect(result.selectedFiles).toEqual(['screen.html']);
    expect(result.content).toBe('<h1>Checkout</h1>');
  });
  it('retrieves packaged designs as inert review copies without replacing authored sources or binding state', async () => {
    const design = await installDesignRuntimeFixture();
    const initial = await publishDesign(design.filePath);
    const originalDocument = await readFile(design.file, 'utf8');
    const bindingPath = path.join(root, '.local/company/bindings', initial.preview.id + '.json');
    const originalBinding = await readFile(bindingPath, 'utf8');
    const fetcher = mockPullPreview(initial.content);
    const preview = await previewCompanyPull(root, initial.preview.id);
    expect(preview.comparison.localChanged).toBe(false);
    fetcher
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody(initial.content));
    const pulled = await pullCompanyBinding(root, initial.preview.id);
    expect(pulled.contentPath).toMatch(/\.txt$/);
    expect(await readFile(pulled.contentPath, 'utf8')).toBe(initial.content);
    expect(await readFile(design.file, 'utf8')).toBe(originalDocument);
    expect(await readFile(bindingPath, 'utf8')).toBe(originalBinding);
  });
  it('detects exact source changes after a pull preview even if bundle bytes did not change', async () => {
    const design = await installDesignRuntimeFixture();
    const initial = await publishDesign(design.filePath);
    mockPullPreview(initial.content);
    await previewCompanyPull(root, initial.preview.id);
    await writeFile(design.file, JSON.stringify(design.document));
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(pullCompanyBinding(root, initial.preview.id)).rejects.toThrow(
      'changed after preview',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('prints a compact readable scope by default and complete content with --json', async () => {
    const design = await installDesignRuntimeFixture();
    const { Command } = await import('commander');
    const { registerCompanyCommand } = await import('../../src/cli/commands/company.js');
    const run = async (args: string[]) => {
      const program = new Command()
        .option('--project-dir <path>', 'repository', root)
        .exitOverride();
      registerCompanyCommand(program);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        await program.parseAsync(
          [
            'company',
            'preview',
            design.filePath,
            '--kind',
            'design',
            '--api-url',
            'https://api.example.com',
            '--project',
            'p1',
            ...args,
          ],
          { from: 'user' },
        );
        return output.mock.calls.map((call) => String(call[0])).join('');
      } finally {
        output.mockRestore();
      }
    };
    const human = await run([]);
    expect(human).toContain('2 screens · 2 frames · 2 variants');
    expect(human).toContain('.planr/designs/checkout/source/screen-2.html');
    expect(human).not.toContain('sourceDigests');
    const machine = JSON.parse(await run(['--json']));
    expect(machine.content).toContain('Workspace overview');
    expect(machine.preview).not.toHaveProperty('sourceDigests');
  });
});

describe('reviewed bound-artifact updates', () => {
  it('requires an explicit preview and uses the bound artifact with a compare-and-set base', async () => {
    const bindingId = await publish();
    await writeFile(path.join(root, 'diagram.json'), '{"updated":true}');
    await expect(pushCompanyBinding(root, bindingId)).rejects.toThrow('--preview first');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }))
      .mockResolvedValueOnce(
        json({
          revision: {
            ...artifact,
            artifactId: 'a1',
            id: 'r2',
            parentRevisionId: 'r1',
            contentDigest: hash('{"updated":true}'),
          },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const result = await previewCompanyPush(root, bindingId);
    expect(result.selectedFiles).toEqual(['diagram.json']);
    expect((await pushCompanyBinding(root, bindingId)).revisionId).toBe('r2');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      baseRevisionId: 'r1',
      content: '{"updated":true}',
      contentType: 'application/json',
    });
    expect(fetcher.mock.calls[1][0]).toBe(
      'https://api.example.com/v1/projects/p1/artifacts/a1/revisions',
    );
    expect((await pushCompanyBinding(root, bindingId)).status).toBe('already-published');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('reuses the same idempotency key after a failed update request', async () => {
    const bindingId = await publish();
    const content = '{"updated":true}';
    await writeFile(path.join(root, 'diagram.json'), content);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }))
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(
        json({
          revision: {
            ...artifact,
            artifactId: 'a1',
            id: 'r2',
            parentRevisionId: 'r1',
            contentDigest: hash(content),
          },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    await previewCompanyPush(root, bindingId);
    await expect(pushCompanyBinding(root, bindingId)).rejects.toThrow('could not be reached');
    await pushCompanyBinding(root, bindingId);
    expect(fetcher.mock.calls[1][1].headers['Idempotency-Key']).toBe(
      fetcher.mock.calls[2][1].headers['Idempotency-Key'],
    );
  });
  it('refuses stale previews and remote conflicts without updating the binding', async () => {
    const bindingId = await publish();
    await writeFile(path.join(root, 'diagram.json'), '{"updated":true}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' })));
    await previewCompanyPush(root, bindingId);
    await writeFile(path.join(root, 'diagram.json'), '{"changed-again":true}');
    await expect(pushCompanyBinding(root, bindingId)).rejects.toThrow('changed after preview');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' })));
    await expect(previewCompanyPush(root, bindingId)).rejects.toThrow('remote revision changed');
    expect(
      JSON.parse(
        await readFile(path.join(root, '.local/company/bindings', bindingId + '.json'), 'utf8'),
      ).revisionId,
    ).toBe('r1');
  });
});

describe('validated semantic proposal application', () => {
  it('applies a proposed diagram edit after domain validation, saves a backup, and is locally idempotent', async () => {
    await installRuntimeFixture();
    const original = await readFile(path.join(root, 'diagram.json'), 'utf8');
    const bindingId = await publish();
    const fetcher = mockProposal();
    const result = await applyCompanyProposal(root, bindingId, 'proposal1');
    expect(result.status).toBe('applied-locally');
    expect(JSON.parse(await readFile(path.join(root, 'diagram.json'), 'utf8')).nodes[0].label).toBe(
      'Applicant',
    );
    assert.ok(result.backupPath);
    expect(await readFile(result.backupPath, 'utf8')).toBe(original);
    expect(
      JSON.parse(
        await readFile(path.join(root, '.local/company/applications/proposal1.json'), 'utf8'),
      ).remoteAcknowledgement,
    ).toBe('pending');
    expect((await applyCompanyProposal(root, bindingId, 'proposal1')).status).toBe(
      'already-applied-locally',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => (call[1].method ?? 'GET') === 'GET')).toBe(true);
  });
  it('rejects layout proposals until renderer and publication consumers are wired', async () => {
    await installRuntimeFixture();
    const original = await readFile(path.join(root, 'diagram.json'), 'utf8');
    const bindingId = await publish();
    mockProposal(proposal([{ op: 'set-layout', targetId: 'item-a', x: 120, y: 80 }] as never));
    await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toMatchObject({
      code: 'E_COMPANY_AUTHORING',
    });
    expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe(original);
    await expect(
      readFile(path.join(root, '.local/company/applications/proposal1.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  for (const interruption of ['source', 'receipt'] as const) {
    it(`recovers an interruption before ${interruption} persistence without fetching or applying twice`, async () => {
      await installRuntimeFixture();
      const original = await readFile(path.join(root, 'diagram.json'), 'utf8');
      const bindingId = await publish();
      mockProposal(
        proposal([
          { op: 'set-field', targetId: 'item-a', field: 'label', value: 'Applicant' },
        ] as never),
      );
      const stopAt =
        interruption === 'source'
          ? path.join(root, 'diagram.json')
          : path.join(root, '.local/company/applications/proposal1.json');
      diskFault.beforeRename = async (_source, target) => {
        if (target === stopAt) throw new Error('simulated interrupted persistence');
      };
      await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toThrow(
        'simulated interrupted',
      );
      const pendingPath = path.join(root, '.local/company/pending-applications/proposal1.json');
      const pending = JSON.parse(await readFile(pendingPath, 'utf8'));
      expect(pending.status).toBe('pending-local-application');
      expect(pending.baseDigest).toBe(hash(original));
      expect(pending.resultDigest).toBe(
        hash(
          await readFile(
            path.join(root, '.local/company/application-content/proposal1.json'),
            'utf8',
          ),
        ),
      );
      await expect(
        readFile(path.join(root, '.local/company/applications/proposal1.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe(
        interruption === 'source'
          ? original
          : await readFile(
              path.join(root, '.local/company/application-content/proposal1.json'),
              'utf8',
            ),
      );
      diskFault.beforeRename = undefined;
      const offline = vi.fn().mockRejectedValue(new Error('offline'));
      vi.stubGlobal('fetch', offline);
      const recovered = await applyCompanyProposal(root, bindingId, 'proposal1');
      expect(recovered.status).toBe('applied-locally');
      expect(
        JSON.parse(await readFile(path.join(root, 'diagram.json'), 'utf8')).nodes[0].label,
      ).toBe('Applicant');
      const receipt = JSON.parse(
        await readFile(path.join(root, '.local/company/applications/proposal1.json'), 'utf8'),
      );
      expect(receipt.status).toBe('applied-locally');
      expect(receipt.remoteAcknowledgement).toBe('pending');
      expect(receipt.resultDigest).toBe(pending.resultDigest);
      expect(receipt.resultLayoutDigest).toBe(pending.resultLayoutDigest);
      assert.ok(recovered.backupPath);
      expect(await readFile(recovered.backupPath, 'utf8')).toBe(original);
      expect(offline).not.toHaveBeenCalled();
      await expect(readFile(pendingPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await applyCompanyProposal(root, bindingId, 'proposal1')).status).toBe(
        'already-applied-locally',
      );
    });
  }
  for (const edited of ['source'] as const) {
    it(`preserves unrelated ${edited} edits after interruption instead of recovering over them`, async () => {
      await installRuntimeFixture();
      const bindingId = await publish();
      mockProposal(
        proposal([
          { op: 'set-field', targetId: 'item-a', field: 'label', value: 'Applicant' },
        ] as never),
      );
      diskFault.beforeRename = async (_source, target) => {
        if (target === path.join(root, '.local/company/applications/proposal1.json'))
          throw new Error('receipt interrupted');
      };
      await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toThrow(
        'receipt interrupted',
      );
      diskFault.beforeRename = undefined;
      const target = path.join(root, 'diagram.json');
      const userContent = '{"subsequentUserEdit":true}';
      await writeFile(target, userContent);
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toMatchObject({
        code: 'E_COMPANY_CONFLICT',
      });
      expect(await readFile(target, 'utf8')).toBe(userContent);
      expect(fetcher).not.toHaveBeenCalled();
      expect(
        JSON.parse(
          await readFile(
            path.join(root, '.local/company/pending-applications/proposal1.json'),
            'utf8',
          ),
        ).status,
      ).toBe('pending-local-application');
      await expect(
        readFile(path.join(root, '.local/company/applications/proposal1.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    });
  }
  it('requires pending recovery before publishing or starting another proposal on the binding', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    mockProposal();
    diskFault.beforeRename = async (_source, target) => {
      if (target === path.join(root, '.local/company/applications/proposal1.json'))
        throw new Error('receipt interrupted');
    };
    await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toThrow(
      'receipt interrupted',
    );
    diskFault.beforeRename = undefined;
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(previewCompanyPush(root, bindingId)).rejects.toMatchObject({
      code: 'E_COMPANY_RECOVERY',
    });
    await expect(pushCompanyBinding(root, bindingId)).rejects.toMatchObject({
      code: 'E_COMPANY_RECOVERY',
    });
    await expect(applyCompanyProposal(root, bindingId, 'proposal2')).rejects.toMatchObject({
      code: 'E_COMPANY_RECOVERY',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await applyCompanyProposal(root, bindingId, 'proposal1')).status).toBe(
      'applied-locally',
    );
    fetcher.mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }));
    expect((await previewCompanyPush(root, bindingId)).status).toBe('preview');
  });
  it('does not stage rejected layout-only proposals', async () => {
    await installRuntimeFixture();
    const original = await readFile(path.join(root, 'diagram.json'), 'utf8');
    const bindingId = await publish();
    mockProposal(proposal([{ op: 'set-layout', targetId: 'item-a', x: 120, y: 80 }] as never));
    await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toMatchObject({
      code: 'E_COMPANY_AUTHORING',
    });
    expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe(original);
    await expect(
      readFile(path.join(root, '.local/company/application-content/proposal1.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reclaims a terminated binding owner but never a live owner', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    mockProposal();
    const lock = path.join(root, '.local/company/bindings', bindingId + '.json.lock');
    await writeFile(lock, JSON.stringify({ pid: 2147483647, nonce: 'terminated-owner' }));
    const kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
      if (pid === 2147483647) throw Object.assign(new Error('dead'), { code: 'ESRCH' });
      return true;
    }) as typeof process.kill);
    expect((await applyCompanyProposal(root, bindingId, 'proposal1')).status).toBe(
      'applied-locally',
    );
    await writeFile(lock, JSON.stringify({ pid: process.pid, nonce: 'active-owner' }));
    await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toMatchObject({
      code: 'E_COMPANY_BUSY',
    });
    expect(JSON.parse(await readFile(lock, 'utf8')).nonce).toBe('active-owner');
    kill.mockRestore();
  });
  it('finds proposals beyond the first page and rejects repeated pagination cursors', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ proposals: [], nextCursor: 50 }))
      .mockResolvedValueOnce(json({ proposals: [proposal()], nextCursor: null }))
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }));
    vi.stubGlobal('fetch', fetcher);
    expect((await previewCompanyProposal(root, bindingId, 'proposal1')).proposalId).toBe(
      'proposal1',
    );
    expect(fetcher.mock.calls[1][0]).toContain('?cursor=50');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ proposals: [], nextCursor: 50 }))
        .mockResolvedValueOnce(json({ proposals: [], nextCursor: 50 })),
    );
    await expect(previewCompanyProposal(root, bindingId, 'proposal1')).rejects.toThrow('cursor');
  });
  it('rejects scope/status/base mismatches and invalid domain operations without changing source', async () => {
    await installRuntimeFixture();
    const original = await readFile(path.join(root, 'diagram.json'), 'utf8');
    const bindingId = await publish();
    for (const changed of [
      { ...proposal(), organizationId: 'org2' },
      { ...proposal(), baseRevisionId: 'r2' },
      { ...proposal(), status: 'rejected' },
      {
        ...proposal(),
        operations: [{ op: 'remove-element', collection: 'nodes', targetId: 'item-a' }],
      },
    ]) {
      mockProposal(changed);
      await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toThrow();
      expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe(original);
    }
  });
  it('does not apply arbitrary JSON types or reapply after later local edits', async () => {
    await installRuntimeFixture();
    await writeFile(path.join(root, 'diagram.json'), '{}');
    const ordinary = await publish();
    mockProposal();
    await expect(applyCompanyProposal(root, ordinary, 'proposal1')).rejects.toThrow(
      'document type',
    );
    await installRuntimeFixture();
    const bindingId = await publish();
    mockProposal();
    await applyCompanyProposal(root, bindingId, 'proposal1');
    await writeFile(path.join(root, 'diagram.json'), '{"later":true}');
    await expect(applyCompanyProposal(root, bindingId, 'proposal1')).rejects.toThrow(
      'already applied',
    );
  });
});

const remoteRevision = (content: string, revisionId = 'r2', contentType = 'application/json') => ({
  kind: 'openplanr-enterprise-artifact-revision',
  schemaVersion: '1.0.0',
  id: revisionId,
  organizationId: 'org1',
  projectId: 'p1',
  artifactId: 'a1',
  parentRevisionId: revisionId === 'r1' ? null : 'r1',
  contentDigest: hash(content),
  contentType,
  byteLength: Buffer.byteLength(content),
  createdAt: at,
  actorId: 'user1',
});
const remoteBody = (content: string, contentType = 'application/json') =>
  new Response(content, {
    headers: {
      'content-type': contentType,
      etag: `"${hash(content)}"`,
      'x-openplanr-content-digest': hash(content),
    },
  });
function mockPullPreview(
  content = '{"remote":true}',
  revisionId = 'r2',
  contentType = 'application/json',
) {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
    .mockResolvedValueOnce(
      json({ revisions: [remoteRevision(content, revisionId, contentType)], nextCursor: null }),
    )
    .mockResolvedValueOnce(remoteBody(content, contentType));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
describe('explicit company diagram adoption', () => {
  const target = 'diagrams/checkout/checkout.planr-diagram-bundle.json';
  const request = () => ({
    apiUrl: 'https://api.example.com',
    projectId: 'p1',
    artifactId: 'a1',
    revisionId: 'r1',
    filePath: target,
  });
  function mockAdoption(content: string, revision = remoteRevision(content, 'r1')) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ artifact: { ...artifact, kind: 'diagram' }, headRevisionId: 'r1' }),
      )
      .mockResolvedValueOnce(json({ revisions: [revision], nextCursor: null }))
      .mockResolvedValueOnce(remoteBody(content));
    vi.stubGlobal('fetch', fetcher);
    return fetcher;
  }
  it('adopts an exact authorized revision with separate remote and canonical local byte identities', async () => {
    await installRuntimeFixture();
    const bundle = makeBundle();
    const remoteContent = JSON.stringify(bundle);
    mockAdoption(remoteContent);
    const review = await previewCompanyDiagramAdoption(root, request());
    expect(review).toMatchObject({
      status: 'preview',
      localCollision: false,
      remoteContentDigest: hash(remoteContent),
    });
    expect(review.previewToken).toMatch(/^[a-f0-9]{64}$/u);
    if (!review.previewToken) throw new Error('Expected a reviewable adoption token.');
    mockAdoption(remoteContent);
    const adopted = await adoptCompanyDiagramRevision(root, {
      ...request(),
      accept: review.previewToken,
    });
    expect(adopted).toMatchObject({
      status: 'synchronized',
      revisionId: 'r1',
      filePath: target,
      remoteContentDigest: hash(remoteContent),
    });
    const localContent = await readFile(path.join(root, target), 'utf8');
    expect(JSON.parse(localContent)).toEqual(bundle);
    expect(hash(localContent)).not.toBe(hash(remoteContent));
    mockAdoption(remoteContent);
    expect((await companyBindingStatus(root, adopted.bindingId)).status).toBe('synchronized');
  });
  it('treats a populated unowned directory and matching loose bytes as collisions', async () => {
    await installRuntimeFixture();
    const remoteContent = JSON.stringify(makeBundle());
    const directory = path.join(root, 'diagrams/checkout');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'notes.txt'), 'Keep this local note.');
    mockAdoption(remoteContent);
    expect((await previewCompanyDiagramAdoption(root, request())).localCollision).toBe(true);
    await rm(path.join(directory, 'notes.txt'));
    await writeFile(path.join(root, target), JSON.stringify(makeBundle(), null, 2) + '\n');
    mockAdoption(remoteContent);
    const preview = await previewCompanyDiagramAdoption(root, request());
    expect(preview).toMatchObject({ localCollision: true, previewToken: null });
    expect(await readFile(path.join(root, target), 'utf8')).toBe(
      JSON.stringify(makeBundle(), null, 2) + '\n',
    );
  });
  it('checks an existing adoption binding before writing a new local bundle', async () => {
    await installRuntimeFixture();
    const remoteContent = JSON.stringify(makeBundle());
    mockAdoption(remoteContent);
    const review = await previewCompanyDiagramAdoption(root, request());
    if (!review.previewToken) throw new Error('Expected an adoption token.');
    const bindingDir = path.join(root, '.local/company/bindings');
    await mkdir(bindingDir, { recursive: true });
    await writeFile(
      path.join(bindingDir, review.previewToken + '.json'),
      JSON.stringify({
        schemaVersion: '1.0.0',
        id: review.previewToken,
        apiUrl: request().apiUrl,
        organizationId: 'org1',
        projectId: 'p1',
        artifactId: 'a1',
        revisionId: 'r1',
        filePath: target,
        title: 'Checkout',
        kind: 'diagram',
        contentType: 'application/json',
        contentDigest: hash(remoteContent),
        localContentDigest: '0'.repeat(64),
        byteLength: Buffer.byteLength(remoteContent),
        createdAt: new Date().toISOString(),
      }),
    );
    mockAdoption(remoteContent);
    await expect(
      adoptCompanyDiagramRevision(root, { ...request(), accept: review.previewToken }),
    ).rejects.toMatchObject({ code: 'E_COMPANY_STATE' });
    await expect(readFile(path.join(root, target))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('shows collisions and denies a revision from another organization before local writes', async () => {
    await installRuntimeFixture();
    const remoteContent = JSON.stringify(makeBundle());
    await mkdir(path.join(root, 'diagrams/checkout'), { recursive: true });
    await writeFile(path.join(root, target), '{"other":true}');
    mockAdoption(remoteContent);
    const collision = await previewCompanyDiagramAdoption(root, request());
    expect(collision).toMatchObject({
      status: 'collision',
      localCollision: true,
      previewToken: null,
    });
    expect(await readFile(path.join(root, target), 'utf8')).toBe('{"other":true}');
    await rm(path.join(root, target));
    mockAdoption(remoteContent, {
      ...remoteRevision(remoteContent, 'r1'),
      organizationId: 'foreign',
    });
    await expect(previewCompanyDiagramAdoption(root, request())).rejects.toMatchObject({
      code: 'E_COMPANY_SCOPE',
    });
    await expect(readFile(path.join(root, target))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
describe('read-only remote revision retrieval', () => {
  it('accepts an edge-weakened ETag when the transport and content digests remain exact', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const content = '{"remote":true}';
    const revision = remoteRevision(content);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact, headRevisionId: revision.id }))
        .mockResolvedValueOnce(json({ revisions: [revision], nextCursor: null }))
        .mockResolvedValueOnce(
          new Response(content, {
            headers: {
              'content-type': revision.contentType,
              etag: `W/"${revision.contentDigest}"`,
              'x-openplanr-content-digest': revision.contentDigest,
            },
          }),
        ),
    );
    expect((await previewCompanyPull(root, bindingId)).content).toBe(content);
  });

  it('requires preview and retrieves only verified bytes without changing source or the accepted binding', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const source = await readFile(path.join(root, 'diagram.json'), 'utf8');
    const bindingPath = path.join(root, '.local/company/bindings', bindingId + '.json');
    const binding = await readFile(bindingPath, 'utf8');
    const noFetch = vi.fn();
    vi.stubGlobal('fetch', noFetch);
    await expect(pullCompanyBinding(root, bindingId)).rejects.toThrow('--preview first');
    expect(noFetch).not.toHaveBeenCalled();
    const content = '{"remote":true}',
      fetcher = mockPullPreview(content);
    const selected = await previewCompanyPull(root, bindingId);
    expect(selected.content).toBe(content);
    expect(selected.readOnly).toBe(true);
    expect(selected.contentTrust).toBe('untrusted');
    expect(selected.comparison).toEqual({
      localChanged: false,
      localMissing: false,
      remoteChanged: true,
    });
    fetcher
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody(content));
    const pulled = await pullCompanyBinding(root, bindingId);
    expect(pulled.status).toBe('retrieved-for-review');
    expect(pulled.bindingAdvanced).toBe(false);
    expect(pulled.remoteAcknowledgement).toBe('not-sent');
    expect(pulled.contentPath).toMatch(/remote-content.*\.txt$/);
    expect(await readFile(pulled.contentPath, 'utf8')).toBe(content);
    expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe(source);
    expect(await readFile(bindingPath, 'utf8')).toBe(binding);
    expect(fetcher.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
    expect(
      fetcher.mock.calls.every(
        (call) =>
          call[1].headers.Authorization === 'Bearer scoped-token' && call[1].redirect === 'error',
      ),
    ).toBe(true);
  });
  it('allows inspecting divergent or missing local content without replacing or recreating it', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    await writeFile(path.join(root, 'diagram.json'), '{"local":true}');
    mockPullPreview();
    expect((await previewCompanyPull(root, bindingId)).comparison.localChanged).toBe(true);
    await rm(path.join(root, 'diagram.json'));
    const fetcher = mockPullPreview();
    const result = await previewCompanyPull(root, bindingId);
    expect(result.comparison.localMissing).toBe(true);
    fetcher
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody('{"remote":true}'));
    await pullCompanyBinding(root, bindingId);
    await expect(readFile(path.join(root, 'diagram.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
  it('rejects a moving latest head but preserves an explicitly previewed historical revision', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const content = '{"history":true}';
    let fetcher = mockPullPreview(content);
    await previewCompanyPull(root, bindingId);
    fetcher.mockResolvedValueOnce(json({ artifact, headRevisionId: 'r3' }));
    await expect(pullCompanyBinding(root, bindingId)).rejects.toThrow('head changed');
    fetcher = mockPullPreview(content, 'r1');
    expect(
      (await previewCompanyPull(root, bindingId, { revisionId: 'r1' })).preview.selection,
    ).toBe('revision');
    fetcher
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r3' }))
      .mockResolvedValueOnce(remoteBody(content));
    expect((await pullCompanyBinding(root, bindingId)).revisionId).toBe('r1');
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain('revisionId=r1');
  });
  it('reads paginated immutable history and rejects invalid or non-advancing cursors', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const content = '{}';
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(json({ revisions: [remoteRevision(content, 'r1')], nextCursor: 50 }))
      .mockResolvedValueOnce(json({ revisions: [remoteRevision(content)], nextCursor: null }))
      .mockResolvedValueOnce(remoteBody(content));
    vi.stubGlobal('fetch', fetcher);
    await previewCompanyPull(root, bindingId);
    expect(fetcher.mock.calls[2][0]).toContain('cursor=50');
    for (const cursor of [0, -1, '50', undefined]) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
          .mockResolvedValueOnce(json({ revisions: [], nextCursor: cursor })),
      );
      await expect(previewCompanyPull(root, bindingId)).rejects.toThrow('cursor');
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
        .mockResolvedValueOnce(json({ revisions: [], nextCursor: 50 }))
        .mockResolvedValueOnce(json({ revisions: [], nextCursor: 50 })),
    );
    await expect(previewCompanyPull(root, bindingId)).rejects.toThrow('cursor');
  });
  it('rejects cross-tenant metadata and malformed revision contracts before requesting content', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    let fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ artifact: { ...artifact, organizationId: 'other' }, headRevisionId: 'r2' }),
      );
    vi.stubGlobal('fetch', fetcher);
    await expect(previewCompanyPull(root, bindingId)).rejects.toMatchObject({
      code: 'E_COMPANY_SCOPE',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const revision of [
      { ...remoteRevision('{}'), artifactId: 'other' },
      { ...remoteRevision('{}'), organizationId: 'other' },
      { ...remoteRevision('{}'), schemaVersion: '9.0.0' },
      { ...remoteRevision('{}'), id: 'r2\n' },
    ]) {
      fetcher = vi
        .fn()
        .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
        .mockResolvedValueOnce(json({ revisions: [revision], nextCursor: null }));
      vi.stubGlobal('fetch', fetcher);
      await expect(previewCompanyPull(root, bindingId)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it('rejects digest, size, media-type, etag and UTF-8 mismatches without persisting a preview', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const responses = [
      () => new Response('{"changed":true}', { headers: { 'content-type': 'application/json' } }),
      () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
      () =>
        new Response('{}', { headers: { 'content-type': 'application/json', etag: '"wrong"' } }),
      () =>
        new Response('{}', {
          headers: {
            'content-type': 'application/json',
            'x-openplanr-content-digest': '0'.repeat(64),
          },
        }),
      () =>
        new Response(Buffer.from([0xff, 0xff]), {
          headers: { 'content-type': 'application/json' },
        }),
      () =>
        new Response('{}', {
          headers: { 'content-type': 'application/json', 'content-length': '2097152' },
        }),
    ];
    for (const response of responses) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
          .mockResolvedValueOnce(json({ revisions: [remoteRevision('{}')], nextCursor: null }))
          .mockResolvedValueOnce(response()),
      );
      await expect(previewCompanyPull(root, bindingId)).rejects.toThrow();
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
        .mockResolvedValueOnce(
          json({ revisions: [{ ...remoteRevision('{}'), byteLength: 3 }], nextCursor: null }),
        )
        .mockResolvedValueOnce(remoteBody('{}')),
    );
    await expect(previewCompanyPull(root, bindingId)).rejects.toMatchObject({
      code: 'E_COMPANY_INTEGRITY',
    });
    await expect(
      readFile(path.join(root, '.local/company/pull-previews', bindingId + '.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves BOM bytes and treats uploaded HTML as untrusted text without opening or executing it', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const content = '\ufeff<script>globalThis.PULL_EXECUTED=true</script>';
    const fetcher = mockPullPreview(content, 'r2', 'text/html');
    expect((await previewCompanyPull(root, bindingId)).content).toBe(content);
    fetcher
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody(content, 'text/html'));
    const result = await pullCompanyBinding(root, bindingId);
    expect(await readFile(result.contentPath, 'utf8')).toBe(content);
    expect(result.contentType).toBe('text/html');
    expect((globalThis as Record<string, unknown>).PULL_EXECUTED).toBeUndefined();
  });
  it('does not retrieve under a changed binding, changed local source, or unsupported preview', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    mockPullPreview();
    await previewCompanyPull(root, bindingId);
    const previewPath = path.join(root, '.local/company/pull-previews', bindingId + '.json');
    const original = JSON.parse(await readFile(previewPath, 'utf8'));
    for (const modified of [
      { ...original, schemaVersion: '9.0.0' },
      { ...original, baseRevisionId: 'r9' },
      { ...original, projectId: 'other' },
      { ...original, revision: { ...original.revision, id: 'r1' } },
    ]) {
      await writeFile(previewPath, JSON.stringify(modified));
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      await expect(pullCompanyBinding(root, bindingId)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    }
    await writeFile(previewPath, JSON.stringify(original));
    await writeFile(path.join(root, 'diagram.json'), '{"userEdit":true}');
    await expect(pullCompanyBinding(root, bindingId)).rejects.toThrow('changed after preview');
    expect(await readFile(path.join(root, 'diagram.json'), 'utf8')).toBe('{"userEdit":true}');
  });
  it('rechecks authorization on retrieval and preserves an existing review copy on retry or tampering', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    mockPullPreview();
    await previewCompanyPull(root, bindingId);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({}, 401)));
    await expect(pullCompanyBinding(root, bindingId)).rejects.toMatchObject({
      code: 'E_COMPANY_AUTH',
    });
    let fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody('{"remote":true}'));
    vi.stubGlobal('fetch', fetcher);
    const retrieved = await pullCompanyBinding(root, bindingId);
    fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody('{"remote":true}'));
    vi.stubGlobal('fetch', fetcher);
    expect((await pullCompanyBinding(root, bindingId)).contentPath).toBe(retrieved.contentPath);
    await writeFile(retrieved.contentPath, 'private local notes');
    fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody('{"remote":true}'));
    vi.stubGlobal('fetch', fetcher);
    await expect(pullCompanyBinding(root, bindingId)).rejects.toThrow('review copy changed');
    expect(await readFile(retrieved.contentPath, 'utf8')).toBe('private local notes');
  });
});

describe('company CLI command integration', () => {
  it('routes preview, publish, push preview, and push through the selected repository', async () => {
    const { Command } = await import('commander');
    const { registerCompanyCommand } = await import('../../src/cli/commands/company.js');
    const run = async (args: string[]) => {
      const program = new Command()
        .option('--project-dir <path>', 'repository', root)
        .exitOverride();
      registerCompanyCommand(program);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        await program.parseAsync(['company', ...args], { from: 'user' });
        return JSON.parse(output.mock.calls.map((call) => String(call[0])).join(''));
      } finally {
        output.mockRestore();
      }
    };
    const previewed = await run([
      'preview',
      'diagram.json',
      '--project',
      'p1',
      '--kind',
      'diagram',
      '--json',
    ]);
    expect(previewed.selectedFiles).toEqual(['diagram.json']);
    expect(previewed.preview.apiUrl).toBe('https://api.openplanr.dev');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ artifact }))
      .mockResolvedValueOnce(json({ revision: firstRevision() }))
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }))
      .mockResolvedValueOnce(
        json({
          revision: { ...firstRevision('{"updated":true}'), id: 'r2', parentRevisionId: 'r1' },
        }),
      );
    vi.stubGlobal('fetch', fetcher);
    const published = await run(['publish', previewed.preview.id, '--json']);
    await writeFile(path.join(root, 'diagram.json'), '{"updated":true}');
    expect((await run(['push', published.bindingId, '--preview', '--json'])).status).toBe(
      'preview',
    );
    expect((await run(['push', published.bindingId, '--json'])).revisionId).toBe('r2');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('routes pull preview and retrieval and requires preview for explicit revision selection', async () => {
    await installRuntimeFixture();
    const bindingId = await publish();
    const { Command } = await import('commander');
    const { registerCompanyCommand } = await import('../../src/cli/commands/company.js');
    const run = async (args: string[]) => {
      const program = new Command()
        .option('--project-dir <path>', 'repository', root)
        .exitOverride();
      registerCompanyCommand(program);
      const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      try {
        await program.parseAsync(['company', 'pull', bindingId, ...args], { from: 'user' });
        return JSON.parse(output.mock.calls.map((call) => String(call[0])).join(''));
      } finally {
        output.mockRestore();
      }
    };
    await expect(run(['--revision', 'r1'])).rejects.toThrow('Use --revision with --preview');
    const fetcher = mockPullPreview();
    expect((await run(['--preview', '--json'])).action).toBe('company.pull-preview');
    fetcher
      .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r2' }))
      .mockResolvedValueOnce(remoteBody('{"remote":true}'));
    expect((await run(['--json'])).status).toBe('retrieved-for-review');
  });
  it('reports historical publication receipts without claiming the later remote head is synchronized', async () => {
    const bindingId = await publish();
    const fetcher = vi.fn().mockResolvedValue(json({ artifact, headRevisionId: 'r3' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await publishCompanyPreview(root, bindingId)).toMatchObject({
      status: 'already-published',
      synchronization: 'not-checked',
      revisionId: 'r1',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await companyBindingStatus(root, bindingId)).status).toBe('remote-changes');
  });
  it('reports cached push completion separately from current remote synchronization', async () => {
    const bindingId = await publish();
    await writeFile(path.join(root, 'diagram.json'), '{"updated":true}');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }))
        .mockResolvedValueOnce(
          json({
            revision: { ...firstRevision('{"updated":true}'), id: 'r2', parentRevisionId: 'r1' },
          }),
        ),
    );
    await previewCompanyPush(root, bindingId);
    await pushCompanyBinding(root, bindingId);
    const fetcher = vi.fn().mockResolvedValue(json({ artifact, headRevisionId: 'r3' }));
    vi.stubGlobal('fetch', fetcher);
    expect(await pushCompanyBinding(root, bindingId)).toMatchObject({
      status: 'already-published',
      synchronization: 'not-checked',
      revisionId: 'r2',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await companyBindingStatus(root, bindingId)).status).toBe('remote-changes');
  });
  it('cannot reset an advanced binding by replaying its original publication', async () => {
    const bindingId = await publish();
    await writeFile(path.join(root, 'diagram.json'), '{"updated":true}');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ artifact, headRevisionId: 'r1' }))
        .mockResolvedValueOnce(
          json({
            revision: { ...firstRevision('{"updated":true}'), id: 'r2', parentRevisionId: 'r1' },
          }),
        ),
    );
    await previewCompanyPush(root, bindingId);
    await pushCompanyBinding(root, bindingId);
    await writeFile(path.join(root, 'diagram.json'), '{}');
    const replay = await publishCompanyPreview(root, bindingId);
    expect(replay.revisionId).toBe('r2');
    expect(replay.status).toBe('already-published');
    expect(replay.publishedRevisionId).toBe('r1');
    expect(replay.synchronization).toBe('not-checked');
    expect(
      JSON.parse(
        await readFile(path.join(root, '.local/company/bindings', bindingId + '.json'), 'utf8'),
      ).revisionId,
    ).toBe('r2');
  });
});

describe('company HTTP session renewal', () => {
  it('retries an authenticated 401 once using the renewed OAuth token', async () => {
    vi.stubEnv('PLANR_COMPANY_TOKEN', '');
    const tokens = vi
      .spyOn(companyAuth, 'resolveCompanyAccessToken')
      .mockResolvedValueOnce('oat_old')
      .mockResolvedValueOnce('oat_new');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ error: 'expired' }, 401))
      .mockResolvedValueOnce(json({ projects: [] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await companyApi('https://api.example.com', '/v1/projects')).toEqual({ projects: [] });
    expect(tokens.mock.calls).toEqual([
      ['https://api.example.com'],
      ['https://api.example.com', { rejectedAccessToken: 'oat_old' }],
    ]);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer oat_new');
  });
  it('does not refresh forbidden requests or caller-supplied manual credentials', async () => {
    const tokens = vi.spyOn(companyAuth, 'resolveCompanyAccessToken').mockResolvedValue('oat_old');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({}, 403)).mockResolvedValueOnce(json({}, 401)),
    );
    await expect(companyApi('https://api.example.com', '/v1/projects')).rejects.toThrow('403');
    expect(tokens).toHaveBeenCalledTimes(1);
    await expect(
      companyApi('https://api.example.com', '/v1/projects', { token: 'explicit-manual' }),
    ).rejects.toThrow('401');
    expect(tokens).toHaveBeenCalledTimes(1);
  });
});
