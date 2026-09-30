import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { makeBundle, sealBundle } from '../../../tests/protocol/fixtures/diagram-authoring.mjs';
import { prepareDiagramShareBundle } from '../lib/artifact/diagram/review-bundle.mjs';
import {
  exportDiagramShareRecovery,
  getDiagramShareStatus,
  importDiagramShareRecovery,
  manageDiagramShare,
  publishDiagramShare,
  shareDiagram,
  syncDiagramShare,
} from '../lib/artifact/diagram/share.mjs';
import * as client from '../lib/artifact/diagram/workspace-client.mjs';
import { diagramWorkspaceService } from './diagram-workspace-service.mjs';

function fixture(t) {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'planr-diagram-share-')));
  t.after(() => rmSync(outer, { recursive: true, force: true }));
  const root = join(outer, 'project');
  mkdirSync(join(root, '.git'), { recursive: true });
  const bundle = makeBundle('swimlane');
  bundle.document.annotations[0].text = 'Note';
  sealBundle(bundle);
  const directory = join(root, 'diagrams', bundle.diagramId);
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${bundle.diagramId}.planr-diagram-bundle.json`);
  writeFileSync(file, JSON.stringify(bundle));
  const service = diagramWorkspaceService();
  const options = {
    custodyRoot: join(outer, 'private'),
    env: { ...process.env, PLANR_HOME: join(outer, 'home') },
    baseUrl: 'https://share.test',
    fetchImpl: service.fetchImpl,
  };
  return { outer, root, file, bundle, options, ...service };
}
function record(f) {
  const path = join(
    f.options.custodyRoot,
    readdirSync(f.options.custodyRoot).find(
      (name) => name.endsWith('.json') && !name.endsWith('.feedback.json'),
    ),
  );
  return { path, ...JSON.parse(readFileSync(path, 'utf8')) };
}
function change(f, title) {
  f.bundle.document.title = title;
  sealBundle(f.bundle);
  writeFileSync(f.file, JSON.stringify(f.bundle));
}
async function reviewer(f) {
  const saved = record(f).custody;
  const access = { id: saved.id, baseUrl: saved.baseUrl, token: saved.token };
  await client.getWorkspace(access, f.options);
  return access;
}
const comment = (reviewOf, commentId, target = {}) => ({
  kind: 'comment',
  commentId,
  author: 'Reviewer',
  reviewOf,
  body: 'Clarify ownership.',
  createdAt: '2026-09-30T12:00:00.000Z',
  target,
});

test('share preserves authored source, stores private custody first and emits only safe identity', async (t) => {
  const f = fixture(t),
    before = readFileSync(f.file);
  const preview = await getDiagramShareStatus(f.file, f.options);
  assert.equal(preview.shared, false);
  assert.equal(preview.destination, 'https://share.test');
  assert.equal(preview.contents.sourceKind, 'authoring');
  assert.equal(preview.contents.elements, f.bundle.presentation.elements.length);
  assert.equal(preview.contents.connections, f.bundle.document.relations.length);
  assert.equal(preview.sourceDigest, f.bundle.bundleDigest);
  assert.equal(existsSync(f.options.custodyRoot), false);
  const status = await shareDiagram(f.file, f.options);
  assert.equal(status.shared, true);
  assert.equal(status.hasUpdate, false);
  assert.equal(status.pending, false);
  assert.match(status.url, /\/diagram\//u);
  assert.equal(readFileSync(f.file).equals(before), true);
  const saved = record(f);
  assert.equal(statSync(saved.path).mode & 0o777, 0o600);
  assert.equal(statSync(f.options.custodyRoot).mode & 0o777, 0o700);
  const output = JSON.stringify(status);
  assert.equal(output.includes(saved.custody.token), false);
  assert.equal(output.includes(saved.custody.ownerAuth), false);
  assert.equal(output.includes(saved.custody.ownerPrivateKey), false);
  const remote = await client.decryptWorkspaceRevision(saved.custody, undefined, f.options);
  assert.equal(remote.authored.originalSource, null);
  assert.equal(remote.authored.sourceMap, null);
  assert.deepEqual(remote.authored.presentation, f.bundle.presentation);
  const again = await shareDiagram(f.file, { ...f.options, baseUrl: 'https://other.test' });
  assert.equal(again.id, status.id);
  assert.equal(again.destination, 'https://share.test');
  assert.equal(f.state.requests.filter(({ method }) => method === 'PUT').length, 1);
});

test('interrupted creation and publication retry the saved revision without dropping owner authority', async (t) => {
  const f = fixture(t);
  f.state.failAfter = true;
  await assert.rejects(shareDiagram(f.file, f.options), /unreachable/u);
  const original = record(f),
    originalPending = JSON.stringify(original.custody.pendingCreate);
  change(f, 'A new local revision');
  const pending = await getDiagramShareStatus(f.file, f.options);
  assert.equal(pending.pendingAction, 'create');
  const created = await shareDiagram(f.file, f.options);
  assert.equal(created.hasUpdate, true);
  assert.equal(created.publishedRevision, original.pendingRevision);
  assert.equal(
    JSON.stringify(f.state.requests.filter(({ method }) => method === 'PUT')[1].body),
    originalPending,
  );
  f.state.failAfter = true;
  // The first authenticated read failed, so no publication request was prepared.
  await assert.rejects(publishDiagramShare(f.file, f.options), /unreachable/u);
  assert.equal(record(f).custody.pendingMutation, undefined);
  const originalFetch = f.options.fetchImpl;
  let failPublication = true;
  f.options.fetchImpl = async (url, init) => {
    if (failPublication && url.endsWith('/publish')) {
      failPublication = false;
      f.state.failAfter = true;
    }
    return originalFetch(url, init);
  };
  await assert.rejects(publishDiagramShare(f.file, f.options), /unreachable/u);
  const saved = record(f),
    pendingPublish = JSON.stringify(saved.custody.pendingMutation.body);
  change(f, 'Changed while receipt was uncertain');
  const published = await publishDiagramShare(f.file, f.options);
  assert.equal(published.publishedRevision, saved.pendingRevision);
  assert.equal(published.hasUpdate, true);
  assert.equal(
    JSON.stringify(f.state.requests.filter(({ url }) => url.endsWith('/publish')).at(-1).body),
    pendingPublish,
  );
});

test('publication conflicts retain intent and authenticated retries preserve the stable link', async (t) => {
  const f = fixture(t);
  const initial = await shareDiagram(f.file, f.options);
  change(f, 'Updated diagram');
  f.state.conflictNext = true;
  await assert.rejects(publishDiagramShare(f.file, f.options), /changed/u);
  const saved = record(f);
  assert.equal(saved.custody.pendingMutation, undefined);
  assert.equal(saved.conflictedMutation.action, 'publish');
  const result = await publishDiagramShare(f.file, f.options);
  assert.equal(result.id, initial.id);
  assert.equal(result.url, initial.url);
  assert.equal(result.hasUpdate, false);
});

test('feedback sync keeps exact historical pins and never mutates the canonical diagram', async (t) => {
  const f = fixture(t);
  await shareDiagram(f.file, f.options);
  const access = await reviewer(f),
    old = await client.decryptWorkspaceRevision(access, undefined, f.options);
  const signer = await client.createWorkspaceSigner();
  await client.appendWorkspaceEvent(
    access,
    comment(old.reviewOf, 'old-pin', { elementId: old.scene.items[0].id, x: 0.1, y: 0.2 }),
    { ...f.options, signer },
  );
  await client.appendWorkspaceEvent(
    access,
    comment(old.reviewOf, 'bad-pin', { elementId: 'absent-element' }),
    f.options,
  );
  change(f, 'Revised diagram');
  await publishDiagramShare(f.file, f.options);
  await assert.rejects(
    client.appendWorkspaceEvent(access, comment(old.reviewOf, 'old-after-publish'), f.options),
    (error) => error.status === 409,
  );
  await client.getWorkspace(access, f.options);
  const current = await client.decryptWorkspaceRevision(access, undefined, f.options);
  await client.appendWorkspaceEvent(
    access,
    comment(current.reviewOf, 'new-pin', { x: 0.4, y: 0.3 }),
    f.options,
  );
  const before = readFileSync(f.file),
    synced = await syncDiagramShare(f.file, f.options);
  assert.equal(synced.imported, 2);
  assert.equal(synced.issues.length, 1);
  assert.equal(readFileSync(f.file).equals(before), true);
  assert.equal(synced.reviewPath.startsWith(f.options.custodyRoot), true);
  const ledger = JSON.parse(readFileSync(synced.reviewPath, 'utf8'));
  assert.equal(ledger.revisions[old.workspaceRevision].stale, true);
  assert.equal(ledger.revisions[current.workspaceRevision].stale, false);
  assert.equal(
    ledger.revisions[old.workspaceRevision].comments[0].target.elementId,
    old.scene.items[0].id,
  );
  assert.equal(ledger.revisions[current.workspaceRevision].comments[0].commentId, 'new-pin');
  assert.equal(statSync(synced.reviewPath).mode & 0o777, 0o600);
  assert.equal((await syncDiagramShare(f.file, f.options)).imported, 0);
});

test('explicit access, rotation, pause, recovery and revocation respect private owner custody', async (t) => {
  const f = fixture(t);
  await shareDiagram(f.file, f.options);
  const access = await manageDiagramShare(f.file, 'access', f.options);
  assert.equal(access.token, record(f).custody.token);
  await manageDiagramShare(f.file, 'pause', f.options);
  assert.equal((await getDiagramShareStatus(f.file, f.options)).commentsPaused, true);
  await manageDiagramShare(f.file, 'resume', f.options);
  await manageDiagramShare(f.file, 'rotate', f.options);
  assert.notEqual(record(f).custody.token, access.token);
  const output = join(f.outer, 'recovery', 'owner.json');
  await exportDiagramShareRecovery(f.file, { ...f.options, output });
  assert.equal(statSync(output).mode & 0o777, 0o600);
  await assert.rejects(exportDiagramShareRecovery(f.file, { ...f.options, output }), /exist/u);
  const restored = await importDiagramShareRecovery(f.file, {
    ...f.options,
    custodyRoot: join(f.outer, 'second-machine'),
    input: output,
  });
  assert.equal(restored.id, access.id);
  assert.equal(restored.restored, true);
  assert.equal('token' in restored, false);
  await manageDiagramShare(f.file, 'revoke', f.options);
  await assert.rejects(
    manageDiagramShare(f.file, 'access', f.options),
    (error) => error.code === 'E_DIAGRAM_SHARE_UNAVAILABLE' && error.status === 410,
  );
  await assert.rejects(
    publishDiagramShare(f.file, f.options),
    (error) => error.code === 'E_DIAGRAM_SHARE_UNAVAILABLE' && error.status === 410,
  );
  await manageDiagramShare(f.file, 'delete', f.options);
  assert.equal(record(f).deleted, true);
});

test('custody refuses project roots, symlink paths and unsafe permissions without modifying source', async (t) => {
  const f = fixture(t),
    before = readFileSync(f.file);
  await assert.rejects(
    shareDiagram(f.file, { ...f.options, custodyRoot: join(f.root, '.private') }),
    /outside/u,
  );
  mkdirSync(join(f.outer, 'actual'));
  symlinkSync(join(f.outer, 'actual'), join(f.outer, 'alias'));
  await assert.rejects(
    shareDiagram(f.file, { ...f.options, custodyRoot: join(f.outer, 'alias', 'private') }),
    /symbolic/u,
  );
  await shareDiagram(f.file, f.options);
  chmodSync(record(f).path, 0o644);
  await assert.rejects(getDiagramShareStatus(f.file, f.options), /0600/u);
  assert.equal(readFileSync(f.file).equals(before), true);
});

test('unshared sync does not enroll a workspace or require private owner storage', async (t) => {
  const f = fixture(t);
  assert.deepEqual(
    await syncDiagramShare(f.file, { ...f.options, custodyRoot: join(f.root, '.private') }),
    { ok: true, shared: false, imported: 0 },
  );
  assert.equal(existsSync(join(f.root, '.private')), false);
  assert.equal(f.state.requests.length, 0);
  const safe = await prepareDiagramShareBundle(f.file);
  assert.deepEqual(safe.authored.presentation, f.bundle.presentation);
});

test('share and publish bind to the reviewed bytes before any network mutation', async (t) => {
  const f = fixture(t),
    preview = await getDiagramShareStatus(f.file, f.options);
  change(f, 'Changed after confirmation preview');
  await assert.rejects(
    shareDiagram(f.file, { ...f.options, expectedRevision: preview.localRevision }),
    (error) => error.code === 'E_DIAGRAM_SHARE_PREVIEW_CHANGED' && error.status === 409,
  );
  assert.equal(f.state.requests.length, 0);
  assert.equal(
    readdirSync(f.options.custodyRoot).filter((name) => name.endsWith('.json')).length,
    0,
  );
  const current = await getDiagramShareStatus(f.file, f.options);
  await shareDiagram(f.file, { ...f.options, expectedRevision: current.localRevision });
  const count = f.state.requests.length;
  change(f, 'Changed before publication');
  await assert.rejects(
    publishDiagramShare(f.file, { ...f.options, expectedRevision: current.localRevision }),
    (error) => error.code === 'E_DIAGRAM_SHARE_PREVIEW_CHANGED' && error.status === 409,
  );
  assert.equal(f.state.requests.length, count);
});

test('a source alias cannot move owner credentials inside its physical project', async (t) => {
  const f = fixture(t),
    alias = join(f.outer, 'project-alias');
  symlinkSync(f.root, alias);
  const aliasedSource = f.file.replace(f.root, alias);
  await assert.rejects(
    shareDiagram(aliasedSource, { ...f.options, custodyRoot: join(f.root, '.private') }),
    /outside/u,
  );
  assert.equal(existsSync(join(f.root, '.private')), false);
  assert.equal(f.state.requests.length, 0);
});

test('arbitrary authored filenames share project custody at root and nested paths', async (t) => {
  const f = fixture(t),
    rootFile = join(f.root, 'manual.bundle.json'),
    nestedFile = join(f.root, 'docs', 'architecture', 'authored.json');
  mkdirSync(join(f.root, 'docs', 'architecture'), { recursive: true });
  const original = readFileSync(f.file);
  writeFileSync(rootFile, original);
  writeFileSync(nestedFile, original);
  const atRoot = await shareDiagram(rootFile, f.options);
  const nested = await shareDiagram(nestedFile, f.options);
  const canonical = await getDiagramShareStatus(f.file, f.options);
  assert.equal(nested.id, atRoot.id);
  assert.equal(canonical.id, atRoot.id);
  assert.equal(f.state.requests.filter(({ method }) => method === 'PUT').length, 1);
  assert.equal(readFileSync(rootFile).equals(original), true);
  assert.equal(readFileSync(nestedFile).equals(original), true);
  for (const file of [rootFile, nestedFile]) {
    await assert.rejects(
      shareDiagram(file, { ...f.options, custodyRoot: join(f.root, '.private') }),
      /outside/u,
    );
  }
  assert.equal(existsSync(join(f.root, '.private')), false);
});

test('arbitrary nested authored sources keep physical project boundaries through aliases', async (t) => {
  const f = fixture(t),
    directory = join(f.root, 'docs'),
    alias = join(f.outer, 'authored-alias');
  mkdirSync(directory);
  const file = join(directory, 'manual.json');
  writeFileSync(file, readFileSync(f.file));
  symlinkSync(directory, alias);
  const aliasedFile = join(alias, 'manual.json');
  await assert.rejects(
    shareDiagram(aliasedFile, { ...f.options, custodyRoot: join(f.root, '.private') }),
    /outside/u,
  );
  assert.equal(f.state.requests.length, 0);
  assert.equal(existsSync(join(f.root, '.private')), false);
  const shared = await shareDiagram(aliasedFile, f.options);
  assert.equal((await getDiagramShareStatus(file, f.options)).id, shared.id);
});

test('recovery exports preserve an existing selected folder and restore through aliased ancestry', async (t) => {
  const f = fixture(t),
    selected = join(f.outer, 'selected'),
    alias = join(f.outer, 'recovery-alias');
  await shareDiagram(f.file, f.options);
  mkdirSync(selected, { mode: 0o755 });
  chmodSync(selected, 0o755);
  const beforeMode = statSync(selected).mode & 0o777,
    output = join(alias, 'recovery.json');
  symlinkSync(selected, alias);
  const exported = await exportDiagramShareRecovery(f.file, { ...f.options, output });
  assert.equal(exported.output, join(selected, 'recovery.json'));
  assert.equal(statSync(selected).mode & 0o777, beforeMode);
  assert.equal(statSync(output).mode & 0o777, 0o600);
  const restored = await importDiagramShareRecovery(f.file, {
    ...f.options,
    custodyRoot: join(f.outer, 'second-owner'),
    input: join(alias, 'recovery.json'),
  });
  assert.equal(restored.id, record(f).custody.id);
  assert.equal(statSync(selected).mode & 0o777, beforeMode);
  const projectAlias = join(f.outer, 'project-output-alias');
  symlinkSync(f.root, projectAlias);
  await assert.rejects(
    exportDiagramShareRecovery(f.file, {
      ...f.options,
      output: join(projectAlias, 'new', 'recovery.json'),
    }),
    (error) => error.code === 'E_OWNER_CUSTODY_LOCATION' && error.status === 400,
  );
  assert.equal(existsSync(join(f.root, 'new')), false);
});

test('sync retries page revision failures without saving partial events or advancing its cursor', async (t) => {
  const f = fixture(t);
  await shareDiagram(f.file, f.options);
  const access = await reviewer(f),
    previous = await client.decryptWorkspaceRevision(access, undefined, f.options);
  await client.appendWorkspaceEvent(access, comment(previous.reviewOf, 'first-pin'), f.options);
  change(f, 'New revision for the same feedback page');
  await publishDiagramShare(f.file, f.options);
  await client.getWorkspace(access, f.options);
  const latest = await client.decryptWorkspaceRevision(access, undefined, f.options);
  await client.appendWorkspaceEvent(access, comment(latest.reviewOf, 'second-pin'), f.options);
  await client.appendWorkspaceEvent(
    access,
    comment(latest.reviewOf, 'invalid-element-pin', { elementId: 'missing-element' }),
    f.options,
  );
  const saved = record(f),
    savedBytes = readFileSync(saved.path),
    ledgerPath = saved.path.replace(/\.json$/u, '.feedback.json'),
    originalFetch = f.options.fetchImpl;
  const failures = [
    ['non-JSON 200', () => new Response('<html>upstream unavailable</html>')],
    ['oversized 200', () => new Response('x'.repeat(9 * 1024 * 1024))],
    ['empty 200', () => new Response(null)],
    [
      'interrupted body',
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('read failed'));
            },
          }),
        ),
    ],
    [
      'unreachable service',
      () => {
        throw new TypeError('connection reset');
      },
    ],
    ['temporary HTTP failure', () => new Response('{}', { status: 503 })],
  ];
  for (const [name, response] of failures) {
    f.options.fetchImpl = (url, init) =>
      url.endsWith(`/revisions/${latest.workspaceRevision}`)
        ? response()
        : originalFetch(url, init);
    await assert.rejects(syncDiagramShare(f.file, f.options), undefined, name);
    assert.equal(record(f).lastEvent, 0, `${name} must preserve the event cursor`);
    assert.equal(
      readFileSync(saved.path).equals(savedBytes),
      true,
      `${name} must preserve custody`,
    );
    assert.equal(existsSync(ledgerPath), false, `${name} must not partially import its page`);
  }
  f.options.fetchImpl = originalFetch;
  const synced = await syncDiagramShare(f.file, f.options);
  assert.equal(synced.imported, 2);
  assert.equal(record(f).lastEvent, 3);
  assert.equal(synced.issues.length, 1);
  assert.equal(synced.issues[0].id, f.state.events[2].event.id);
  const ledger = JSON.parse(readFileSync(synced.reviewPath, 'utf8'));
  assert.equal(ledger.events.length, 2);
  assert.equal(ledger.revisions[previous.workspaceRevision].comments[0].commentId, 'first-pin');
  assert.equal(ledger.revisions[latest.workspaceRevision].comments[0].commentId, 'second-pin');
  assert.equal((await syncDiagramShare(f.file, f.options)).imported, 0);
});
