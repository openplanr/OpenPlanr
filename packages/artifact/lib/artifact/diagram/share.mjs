import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { canonicalizeJson } from '@openplanr/protocol/canonical-json';
import { diagramReviewBundleDigest } from '@openplanr/protocol/diagram-review-contracts';
import { PLANNING_FOLDER } from '@openplanr/protocol/names';
import {
  ensurePrivateDirectory,
  ownerCustodyLocation,
  readCustody,
  resolveRecoveryOutputPath,
  withOwnerCustody,
  writeCustody,
} from '../owner-custody.mjs';
import { copyUploadSpool, persistUploadSpool, spoolChunkReader } from '../upload-spool.mjs';
import { prepareDiagramShareBundle } from './review-bundle.mjs';
import * as workspace from './workspace-client.mjs';
import {
  assertDiagramFeedbackTarget,
  mergeDiagramWorkspaceFeedback,
} from './workspace-feedback.mjs';

const FORMAT = 'openplanr-diagram-owner-custody';
const LABEL = 'Diagram';

function sourceRoot(file) {
  const directory = realpathSync(dirname(resolve(file)));
  const parent = dirname(directory);
  if (basename(parent) === 'diagrams') return dirname(parent);
  for (let candidate = directory; ; candidate = dirname(candidate)) {
    if (existsSync(join(candidate, '.git')) || existsSync(join(candidate, PLANNING_FOLDER)))
      return candidate;
    if (dirname(candidate) === candidate) return directory;
  }
}
async function currentDiagram(file) {
  const bundle = await prepareDiagramShareBundle(file);
  return {
    bundle,
    root: sourceRoot(file),
    id: bundle.diagramId,
    title: bundle.title,
    revision: diagramReviewBundleDigest(bundle),
    sourceDigest: bundle.source.digest,
  };
}
async function locationFor(file, options, allowMissing = false) {
  const current = await currentDiagram(file);
  return {
    ...ownerCustodyLocation({
      sourceRoot: current.root,
      sourceId: current.id,
      namespace: 'diagram-shares',
      label: LABEL,
      options,
      allowMissing,
    }),
    current,
  };
}
async function withCustody(file, options, action) {
  const location = await locationFor(file, options);
  return withOwnerCustody(location, { label: LABEL, format: FORMAT }, async (context) => {
    const current = await currentDiagram(file);
    if (current.id !== location.current.id || current.root !== location.current.root)
      throw previewChanged();
    return action({ ...context, current });
  });
}
function sharingError(message, code, status) {
  return Object.assign(new Error(message), { code, status });
}
function previewChanged() {
  return sharingError(
    'The diagram changed after its sharing preview. Review the current revision before retrying.',
    'E_DIAGRAM_SHARE_PREVIEW_CHANGED',
    409,
  );
}
function assertPreview(current, options) {
  if (options.expectedRevision !== undefined && options.expectedRevision !== current.revision)
    throw previewChanged();
}
function safeStatus(record, current, options = {}) {
  return {
    ok: true,
    shared: Boolean(record),
    title: current.title,
    localRevision: current.revision,
    sourceDigest: current.sourceDigest,
    contents: {
      elements: current.bundle.scene.items.length,
      connections: current.bundle.scene.relations.length,
      sourceKind: current.bundle.source.kind,
    },
    retention: 'until-revoked',
    destination: workspace.normalizeWorkspaceBase(
      record?.custody.baseUrl ??
        options.baseUrl ??
        options.env?.OPENPLANR_SHARE_BASE ??
        process.env.OPENPLANR_SHARE_BASE ??
        workspace.DIAGRAM_SHARE_BASE_URL,
    ),
    ...(record
      ? {
          id: record.custody.id,
          url: workspace.workspaceReviewUrl(record.custody),
          revision: record.custody.currentRevision ?? null,
          publishedRevision: record.publishedRevision ?? null,
          hasUpdate: record.publishedRevision !== current.revision,
          epoch: record.custody.epoch,
          commentsPaused: Boolean(record.custody.commentsPaused),
          revoked: Boolean(record.revoked),
          deleted: Boolean(record.deleted),
          pending: Boolean(record.custody.pendingCreate || record.custody.pendingMutation),
          pendingAction: record.custody.pendingCreate
            ? 'create'
            : (record.custody.pendingMutation?.action ?? null),
          ...(record.reviewPath ? { reviewPath: record.reviewPath } : {}),
        }
      : {}),
  };
}
function uploadOptions(custody, options) {
  const body =
    custody.pendingCreate ??
    (custody.pendingMutation?.action === 'publish' ? custody.pendingMutation.body : null);
  return {
    fetchImpl: options.fetchImpl,
    ...(custody.schemaVersion === '2.0.0' && body
      ? { readChunk: spoolChunkReader(custody.spoolDirectory, body) }
      : {}),
  };
}
async function commitMutation(record, save, options) {
  try {
    return await workspace.commitWorkspaceMutation(
      record.custody,
      uploadOptions(record.custody, options),
    );
  } catch (error) {
    if (error.status === 409 && record.custody.pendingMutation) {
      const pending = structuredClone(record.custody.pendingMutation);
      try {
        const remote = await workspace.getWorkspace(record.custody, {
          fetchImpl: options.fetchImpl,
        });
        if (remote.version > pending.body.expectedVersion) {
          record.conflictedMutation = {
            ...pending,
            localRevision: record.pendingRevision ?? null,
            ...(record.custody.spoolDirectory
              ? { spoolDirectory: record.custody.spoolDirectory }
              : {}),
          };
          delete record.custody.spoolDirectory;
          delete record.custody.pendingMutation;
          delete record.pendingRevision;
          save(record);
        }
      } catch {
        /* An uncertain response retains the saved authority and request. */
      }
    }
    throw error;
  }
}
export async function getDiagramShareStatus(file, options = {}) {
  const { path, legacyPath, current } = await locationFor(file, options, true);
  const record =
    readCustody(path, { label: LABEL, format: FORMAT }) ??
    (legacyPath ? readCustody(legacyPath, { label: LABEL, format: FORMAT }) : null);
  return safeStatus(record, current, options);
}
export async function shareDiagram(file, options = {}) {
  return withCustody(file, options, async ({ record, current, save, root }) => {
    assertPreview(current, options);
    if (record?.deleted || record?.revoked)
      throw sharingError(
        'This diagram review was revoked or deleted. Use a new diagram identity to create another review.',
        'E_DIAGRAM_SHARE_UNAVAILABLE',
        410,
      );
    if (!record) {
      let transport = options.transport;
      if (!transport) {
        try {
          await workspace.discoverWorkspaceCapabilities({
            baseUrl:
              options.baseUrl ??
              options.env?.OPENPLANR_SHARE_BASE ??
              process.env.OPENPLANR_SHARE_BASE ??
              'https://share.openplanr.dev',
            fetchImpl: options.fetchImpl,
          });
          transport = '2';
        } catch (error) {
          if (![404, 426].includes(error.status)) throw error;
          transport = '1';
        }
      }
      let custody;
      try {
        custody = await workspace.prepareWorkspace(current.bundle, {
          transport,
          baseUrl:
            options.baseUrl ??
            options.env?.OPENPLANR_SHARE_BASE ??
            process.env.OPENPLANR_SHARE_BASE ??
            workspace.DIAGRAM_SHARE_BASE_URL,
        });
      } catch (error) {
        if (transport === '1' && error.code === 'E_WORKSPACE_PAYLOAD_TOO_LARGE')
          throw Object.assign(
            new Error(
              'This sharing service needs the bounded resource upload upgrade. Retry after the hosted service is updated; your local work is unchanged.',
            ),
            { code: 'E_WORKSPACE_TRANSPORT_UNSUPPORTED', status: 426 },
          );
        throw error;
      }
      if (custody.schemaVersion === '2.0.0')
        await persistUploadSpool(custody, join(root, 'uploads'));
      record = {
        kind: FORMAT,
        schemaVersion: '1.0.0',
        diagramId: current.id,
        custody,
        publishedRevision: null,
        pendingRevision: current.revision,
        lastEvent: 0,
      };
      save(record);
    }
    if (record.custody.pendingCreate) {
      await workspace.commitWorkspace(record.custody, uploadOptions(record.custody, options));
      record.publishedRevision = record.pendingRevision;
      delete record.pendingRevision;
      save(record);
    }
    return safeStatus(record, current, options);
  });
}
export async function publishDiagramShare(file, options = {}) {
  return withCustody(file, options, async ({ record, current, save, root }) => {
    assertPreview(current, options);
    if (!record || record.custody.pendingCreate)
      throw sharingError(
        'Create the diagram review before publishing an update.',
        'E_DIAGRAM_SHARE_NOT_CREATED',
        409,
      );
    if (record.deleted || record.revoked)
      throw sharingError(
        'This diagram review is no longer accessible.',
        'E_DIAGRAM_SHARE_UNAVAILABLE',
        410,
      );
    if (record.custody.pendingMutation && record.custody.pendingMutation.action !== 'publish')
      throw sharingError(
        `Retry the pending ${record.custody.pendingMutation.action} operation first.`,
        'E_DIAGRAM_SHARE_PENDING',
        409,
      );
    if (!record.custody.pendingMutation) {
      await workspace.getWorkspace(record.custody, { fetchImpl: options.fetchImpl });
      await workspace.prepareWorkspaceMutation(record.custody, 'publish', current.bundle);
      if (record.custody.schemaVersion === '2.0.0')
        await persistUploadSpool(record.custody, join(root, 'uploads'));
      record.pendingRevision = current.revision;
      save(record);
    }
    await commitMutation(record, save, options);
    record.publishedRevision = record.pendingRevision;
    delete record.pendingRevision;
    save(record);
    return safeStatus(record, current, options);
  });
}
function assertManagement(record, action) {
  if (!record || record.custody.pendingCreate)
    throw sharingError('Create the diagram review first.', 'E_DIAGRAM_SHARE_NOT_CREATED', 409);
  if (record.deleted || (record.revoked && action !== 'delete'))
    throw sharingError('This review is no longer accessible.', 'E_DIAGRAM_SHARE_UNAVAILABLE', 410);
  if (record.custody.pendingMutation && record.custody.pendingMutation.action !== action)
    throw sharingError(
      `Retry the pending ${record.custody.pendingMutation.action} operation first.`,
      'E_DIAGRAM_SHARE_PENDING',
      409,
    );
}
export async function manageDiagramShare(file, action, options = {}) {
  if (!['access', 'rotate', 'pause', 'resume', 'revoke', 'delete'].includes(action))
    throw sharingError('Unknown diagram sharing action.', 'E_DIAGRAM_SHARE_ACTION', 400);
  return withCustody(file, options, async ({ record, current, save, root }) => {
    assertManagement(record, action);
    if (action === 'access')
      return { ...safeStatus(record, current, options), token: record.custody.token };
    if (!record.custody.pendingMutation) {
      if (!record.revoked)
        await workspace.getWorkspace(record.custody, { fetchImpl: options.fetchImpl });
      await workspace.prepareWorkspaceMutation(record.custody, action);
      save(record);
    }
    await commitMutation(record, save, options);
    if (action === 'revoke') record.revoked = true;
    if (action === 'delete') record.deleted = true;
    save(record);
    return safeStatus(record, current, options);
  });
}
export async function exportDiagramShareRecovery(file, { output, ...options } = {}) {
  if (!output) throw new Error('Recovery export requires a new private output path.');
  return withCustody(file, options, async ({ record, current }) => {
    if (!record)
      throw sharingError('Create the diagram review first.', 'E_DIAGRAM_SHARE_NOT_CREATED', 409);
    const target = resolveRecoveryOutputPath(output);
    ownerCustodyLocation({
      sourceRoot: current.root,
      sourceId: current.id,
      namespace: 'diagram-shares',
      label: LABEL,
      options: { ...options, custodyRoot: dirname(target) },
    });
    ensurePrivateDirectory(dirname(target), { label: LABEL, recoveryOutput: true });
    const recovery = structuredClone(record);
    if (
      record.custody.schemaVersion === '2.0.0' &&
      (record.custody.pendingCreate || record.custody.pendingMutation?.action === 'publish')
    ) {
      const spool = `${target}.upload`;
      await copyUploadSpool(record.custody, spool);
      recovery.recoverySpool = basename(spool);
      recovery.custody.spoolDirectory = spool;
    }
    writeFileSync(target, `${JSON.stringify(recovery, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { ok: true, output: target };
  });
}
export async function importDiagramShareRecovery(file, { input, ...options } = {}) {
  if (!input) throw new Error('Recovery restore requires a private input path.');
  const recovered = readCustody(resolve(input), {
    label: LABEL,
    format: FORMAT,
    recoveryInput: true,
  });
  if (!recovered) throw new Error('Recovery file could not be found.');
  const custody = recovered.custody;
  workspace.workspaceReviewUrl(custody);
  const proof = await workspace.signWorkspaceValue(
    { recovery: custody.id, nonce: workspace.newWorkspaceId() },
    custody.ownerPrivateKey,
  );
  if (!(await workspace.verifyWorkspaceSignature(proof, custody.ownerPublicKey)))
    throw new Error('Recovery private key does not match its owner identity.');
  await workspace.deriveWorkspaceAuthentication(custody.token, custody.id);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(custody.ownerAuth ?? ''))
    throw new Error('Recovery owner capability is invalid.');
  return withCustody(file, options, async ({ record, current, save, root }) => {
    if (recovered.diagramId !== current.id)
      throw new Error('Recovery belongs to a different diagram.');
    if (
      record &&
      (record.custody.id !== custody.id ||
        canonicalizeJson(record.custody.ownerPublicKey) !==
          canonicalizeJson(custody.ownerPublicKey))
    )
      throw new Error(
        'Different owner keys already exist; recovery will not overwrite them.',
      );
    if (record && record.custody.version > custody.version)
      throw new Error('The recovery file is older than local owner keys.');
    if (!custody.pendingCreate && !recovered.deleted && !recovered.revoked) {
      await workspace.getWorkspace(custody, { fetchImpl: options.fetchImpl });
      const remote = await workspace.decryptWorkspaceRevision(custody, undefined, {
        fetchImpl: options.fetchImpl,
      });
      if (remote.diagramId !== current.id)
        throw new Error('Recovery belongs to a different diagram.');
    }
    if (
      custody.schemaVersion === '2.0.0' &&
      (custody.pendingCreate || custody.pendingMutation?.action === 'publish')
    ) {
      if (recovered.recoverySpool !== `${basename(resolve(input))}.upload`)
        throw new Error('Pending upload recovery requires its matching binary sidecar.');
      custody.spoolDirectory = join(dirname(resolve(input)), recovered.recoverySpool);
      const pending = custody.pendingCreate ?? custody.pendingMutation.body;
      const destination = join(root, 'uploads', custody.id, pending.operationId);
      if (existsSync(destination)) {
        const { spoolChunkReader } = await import('../upload-spool.mjs');
        const reader = spoolChunkReader(destination, pending);
        for (const part of pending.manifest.chunks) await reader(part.index);
      } else await copyUploadSpool(custody, destination);
      custody.spoolDirectory = destination;
      delete recovered.recoverySpool;
    }
    recovered.lastEvent = 0;
    delete recovered.reviewPath;
    save(recovered);
    return { ...safeStatus(recovered, current, options), restored: true };
  });
}
function readFeedback(path) {
  if (!existsSync(path)) return { schemaVersion: '1.0.0', events: [], issues: [], revisions: {} };
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (process.platform !== 'win32' && stat.mode & 0o077)
  )
    throw new Error('Diagram feedback must remain a private 0600 file.');
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  if (
    ledger.schemaVersion !== '1.0.0' ||
    !Array.isArray(ledger.events) ||
    !Array.isArray(ledger.issues)
  )
    throw new Error('Saved diagram feedback is invalid.');
  return ledger;
}
async function prefetchPageRevisions(page, context) {
  for (const { revisionId } of page.events) {
    if (context.cache.has(revisionId)) continue;
    const revision = await workspace.decryptWorkspaceRevision(context.record.custody, revisionId, {
      fetchImpl: context.options.fetchImpl,
    });
    context.cache.set(revisionId, revision);
  }
}
function assertEventRevision(event, context) {
  const revision = context.cache.get(event.revisionId);
  if (revision.diagramId !== context.current.id || revision.reviewOf !== event.reviewOf)
    throw new Error('Feedback refers to a different diagram revision.');
  assertDiagramFeedbackTarget(event.payload, revision.scene);
}
function importFeedbackEvent(event, context) {
  const bytes = canonicalizeJson(event);
  if (context.byId.has(event.id)) {
    if (context.byId.get(event.id) !== bytes)
      context.issues.push({
        id: event.id,
        sequence: event.sequence,
        reason: 'Feedback identity changed; not imported.',
      });
    return 0;
  }
  assertEventRevision(event, context);
  const merged = mergeDiagramWorkspaceFeedback([...context.events, event], {
    revisionId: event.revisionId,
    reviewOf: event.reviewOf,
    ownerPublicKey: context.record.custody.ownerPublicKey,
  });
  const invalid = merged.issues.find((issue) => issue.id === event.id);
  if (invalid) throw new Error(invalid.reason);
  context.events.push(event);
  context.byId.set(event.id, bytes);
  return 1;
}
async function importFeedbackPage(page, ledger, context) {
  await prefetchPageRevisions(page, context);
  const events = [...ledger.events],
    issues = [...ledger.issues, ...page.issues];
  const state = {
    ...context,
    events,
    issues,
    byId: new Map(events.map((event) => [event.id, canonicalizeJson(event)])),
  };
  let imported = 0;
  for (const event of page.events) {
    try {
      imported += importFeedbackEvent(event, state);
    } catch (error) {
      issues.push({ id: event.id, sequence: event.sequence, reason: error.message });
    }
  }
  const revisions = {};
  for (const event of events) {
    if (revisions[event.revisionId]) continue;
    revisions[event.revisionId] = {
      reviewOf: event.reviewOf,
      stale: event.reviewOf !== context.current.revision,
      ...mergeDiagramWorkspaceFeedback(events, {
        revisionId: event.revisionId,
        reviewOf: event.reviewOf,
        ownerPublicKey: context.record.custody.ownerPublicKey,
      }),
    };
  }
  return {
    imported,
    ledger: {
      schemaVersion: '1.0.0',
      workspaceId: context.record.custody.id,
      events,
      issues: [
        ...new Map(issues.map((issue) => [`${issue.id}:${issue.sequence}`, issue])).values(),
      ],
      revisions,
    },
  };
}
export async function syncDiagramShare(file, options = {}) {
  const location = await locationFor(file, options, true);
  if (!existsSync(location.path)) return { ok: true, shared: false, imported: 0 };
  return withCustody(file, options, async ({ record, current, save, path }) => {
    if (!record || record.custody.pendingCreate || record.deleted)
      return { ok: true, shared: Boolean(record), imported: 0 };
    if (record.revoked)
      throw sharingError(
        'The diagram review was revoked. Retained local feedback remains available.',
        'E_DIAGRAM_SHARE_UNAVAILABLE',
        410,
      );
    await workspace.getWorkspace(record.custody, { fetchImpl: options.fetchImpl });
    const reviewPath = path.replace(/\.json$/u, '.feedback.json');
    let ledger = readFeedback(reviewPath),
      imported = 0,
      hasMore = true;
    const context = { record, current, options, cache: new Map() };
    while (hasMore) {
      const page = await workspace.readWorkspaceEvents(record.custody, {
        after: record.lastEvent ?? 0,
        fetchImpl: options.fetchImpl,
      });
      const result = await importFeedbackPage(page, ledger, context);
      imported += result.imported;
      ledger = result.ledger;
      writeCustody(reviewPath, ledger, { label: LABEL });
      hasMore = page.hasMore && page.cursor > (record.lastEvent ?? 0);
      record.lastEvent = page.cursor;
      record.reviewPath = reviewPath;
      save(record);
    }
    return { ...safeStatus(record, current, options), imported, issues: ledger.issues, reviewPath };
  });
}
