/** Local owner adapter for persistent, encrypted design review workspaces. */
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { canonicalizeJson } from '../protocol/canonical-json.mjs';
import { acquireStartLock } from '../artifact/internal/server-util.mjs';
import { digestArtifactEnvelope } from '../artifact/envelope.mjs';
import { createReviewLedger } from '../artifact/merge.mjs';
import { resolveArtifactReviewDestination } from '../artifact/import.mjs';
import { readArtifactReviewState, withArtifactReviewLock, writeArtifactReviewState } from '../artifact/review.mjs';
import { atomicJson, currentDesign, hash, readJson } from './document.mjs';
import * as workspace from './workspace-client.mjs';
import { mergeWorkspaceFeedback } from './workspace-feedback.mjs';
import { bundleDesignRevision } from './context.mjs';

const FORMAT = 'openplanr-design-owner-custody';
const pick = (value, keys) => Object.fromEntries(keys.filter((key) => value?.[key] !== undefined).map((key) => [key, structuredClone(value[key])]));

/** Never upload source paths, local provenance, arbitrary state, or owner credentials. */
export function prepareDesignShareBundle(file) {
  const current = currentDesign(file);
  const saved = readJson(join(current.root, '.design/studio-state.json'), { state: {} }).state;
  return bundleDesignRevision(current, saved);
}

function custodyLocation(file, options = {}, { allowMissing = false } = {}) {
  const current = currentDesign(file);
  const env = options.env ?? process.env;
  const root = resolve(options.custodyRoot ?? join(env.PLANR_HOME || env.OPENPLANR_HOME || join(realpathSync(env.HOME || homedir()), '.openplanr'), 'design-shares'));
  let project = current.root;
  for (let candidate = current.root; dirname(candidate) !== candidate; candidate = dirname(candidate)) {
    if (existsSync(join(candidate, '.git')) || existsSync(join(candidate, '.planr'))) { project = candidate; break; }
  }
  const key = hash(`${current.root}\n${current.document.id}`);
  const path = join(root, `${key}.json`);
  const within = relative(project, root);
  if ((!allowMissing || existsSync(path)) && (within === '' || (!within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && within !== '..' && !isAbsolute(within)))) throw new Error('Design owner credentials must be stored outside the project. Set OPENPLANR_HOME to a private user-level directory.');
  return { root, path, current };
}
function ensurePrivateDirectory(root) {
  for (let path = root; dirname(path) !== path; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Design custody directory must not contain symbolic links.');
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Design custody must use a private local directory.');
  if (process.platform !== 'win32') chmodSync(root, 0o700);
}
function readCustody(path) {
  if (!existsSync(path)) return null;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o077))) throw new Error('Design owner custody must be a private 0600 file.');
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.kind !== FORMAT || record.schemaVersion !== '1.0.0' || !record.custody) throw new Error('Design owner custody is invalid.');
  return record;
}
function writeCustody(path, record) {
  const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    renameSync(temp, path);
    if (process.platform !== 'win32') {
      chmodSync(path, 0o600);
      const directory = openSync(dirname(path), 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } catch (error) { try { unlinkSync(temp); } catch {} throw error; }
}
async function withCustody(file, options, action) {
  const location = custodyLocation(file, options);
  ensurePrivateDirectory(location.root);
  const unlock = await acquireStartLock(`${location.path}.lock`);
  try {
    let record = readCustody(location.path);
    return await action({ ...location, record, save(value = record) { record = value; writeCustody(location.path, value); } });
  } finally { unlock(); }
}
async function commitMutation(record, save, options) {
  try { return await workspace.commitWorkspaceMutation(record.custody, { fetchImpl: options.fetchImpl }); }
  catch (error) {
    if (error.status === 409 && record.custody.pendingMutation) {
      const pending = structuredClone(record.custody.pendingMutation);
      // A definite rejection can be rebased only after an authenticated read.
      // Network failures retain the exact pending request for idempotent retry.
      try {
        const remote = await workspace.getWorkspace(record.custody, { fetchImpl: options.fetchImpl });
        if (remote.version > pending.body.expectedVersion) {
          record.conflictedMutation = { ...pending, localRevision: record.pendingRevision ?? null };
          delete record.custody.pendingMutation; delete record.pendingRevision;
          save(record);
        }
      } catch { /* Keep uncertain authority and request intact for recovery. */ }
    }
    throw error;
  }
}
function presentationFingerprint(current) {
  const state = readJson(join(current.root, '.design/studio-state.json'), { state: {} }).state;
  return hash(JSON.stringify({ revision: current.revision, selectedVariant: state.selectedVariant ?? current.document.selectedVariant, positions: state.positions ?? {}, verification: current.verification.status }));
}
const safeStatus = (record, current) => ({
  ok: true, shared: Boolean(record), title: current.document.title,
  localRevision: current.revision, retention: 'until-revoked',
  ...(record ? {
    id: record.custody.id, url: `${record.custody.baseUrl}/d/${encodeURIComponent(record.custody.id)}`,
    revision: record.custody.currentRevision ?? record.publishedRevision ?? null,
    publishedRevision: record.publishedRevision ?? null, hasUpdate: record.publishedRevision !== current.revision || record.publishedPresentation !== presentationFingerprint(current),
    epoch: record.custody.epoch, commentsPaused: Boolean(record.custody.commentsPaused ?? record.commentsPaused),
    revoked: Boolean(record.revoked), deleted: Boolean(record.deleted),
    pending: Boolean(record.custody.pendingCreate || record.custody.pendingMutation || record.pendingReviewMetadata?.length),
    pendingAction: record.custody.pendingCreate ? 'create' : record.custody.pendingMutation?.action ?? (record.pendingReviewMetadata?.length ? 'review-metadata' : null),
    pendingReviewMetadata: Boolean(record.pendingReviewMetadata?.length),
  } : {}),
});

export function getDesignShareStatus(file, options = {}) {
  const { path, current } = custodyLocation(file, options);
  return safeStatus(readCustody(path), current);
}
export async function shareDesign(file, options = {}) {
  return withCustody(file, options, async ({ record, current, save }) => {
    if (record?.deleted) throw new Error('This shared review was deleted. Create a new design identity to share a new review.');
    if (!record) {
      const custody = await workspace.prepareWorkspace(prepareDesignShareBundle(file), { baseUrl: options.baseUrl ?? options.env?.OPENPLANR_SHARE_BASE ?? process.env.OPENPLANR_SHARE_BASE ?? 'https://share.openplanr.dev' });
      record = { schemaVersion: '1.0.0', kind: FORMAT, designId: current.document.id, custody, publishedRevision: null, pendingRevision: current.revision, pendingPresentation: presentationFingerprint(current), lastEvent: 0 };
      save(record); // Owner authority exists durably before the first network mutation.
    }
    if (record.custody.pendingCreate) {
      await workspace.commitWorkspace(record.custody, { fetchImpl: options.fetchImpl });
      record.publishedRevision = record.pendingRevision; record.publishedPresentation = record.pendingPresentation; delete record.pendingRevision; delete record.pendingPresentation;
      save(record);
    }
    return safeStatus(record, current);
  });
}
export async function publishDesignShare(file, options = {}) {
  return withCustody(file, options, async ({ record, current, save }) => {
    if (!record || record.custody.pendingCreate) throw new Error('Create the shared review before publishing an update.');
    if (record.deleted || record.revoked) throw new Error('Access was revoked or the review was deleted.');
    if (record.custody.pendingMutation && record.custody.pendingMutation.action !== 'publish') throw new Error(`Retry the pending ${record.custody.pendingMutation.action} operation first.`);
    if (!record.custody.pendingMutation) {
      await workspace.getWorkspace(record.custody, { fetchImpl: options.fetchImpl });
      await workspace.prepareWorkspaceMutation(record.custody, 'publish', prepareDesignShareBundle(file));
      record.pendingRevision = current.revision; record.pendingPresentation = presentationFingerprint(current); save(record);
    }
    await commitMutation(record, save, options);
    record.publishedRevision = record.pendingRevision; record.publishedPresentation = record.pendingPresentation;
    delete record.pendingRevision; delete record.pendingPresentation; save(record);
    return safeStatus(record, current);
  });
}
export async function manageDesignShare(file, action, options = {}) {
  if (!['rotate', 'pause', 'resume', 'revoke', 'delete', 'access'].includes(action)) throw new Error('Unknown design sharing action.');
  return withCustody(file, options, async ({ record, current, save }) => {
    if (!record || record.custody.pendingCreate) throw new Error('Create the shared review first.');
    if (action === 'access') {
      if (record.revoked || record.deleted) throw new Error('This review is no longer accessible.');
      return { ...safeStatus(record, current), token: record.custody.token };
    }
    if (action === 'rotate') await flushOwnerMetadata(record, save, options);
    if (record.custody.pendingMutation && record.custody.pendingMutation.action !== action) throw new Error(`Retry the pending ${record.custody.pendingMutation.action} operation first.`);
    if (!record.custody.pendingMutation) {
      if (!record.revoked) await workspace.getWorkspace(record.custody, { fetchImpl: options.fetchImpl });
      await workspace.prepareWorkspaceMutation(record.custody, action);
      save(record);
    }
    await commitMutation(record, save, options);
    if (action === 'pause' || action === 'resume') record.commentsPaused = action === 'pause';
    if (action === 'revoke') record.revoked = true;
    if (action === 'delete') record.deleted = true;
    save(record);
    return safeStatus(record, current);
  });
}

async function flushOwnerMetadata(record, save, options) {
  while (record.pendingReviewMetadata?.length) {
    await workspace.appendWorkspaceEvent(record.custody, null, { preparedEvent: record.pendingReviewMetadata[0], fetchImpl: options.fetchImpl });
    record.pendingReviewMetadata.shift(); save(record);
  }
}

/** Owner metadata uses owner authentication and the separately protected signing key. */
export async function publishDesignReviewMetadata(file, payload, { revisionId, ...options } = {}) {
  const location = custodyLocation(file, options, { allowMissing: true });
  if (!existsSync(location.path) || !revisionId) return { shared: false };
  return withCustody(file, options, async ({ record, save }) => {
    if (!record || record.deleted || record.revoked || record.custody.pendingCreate) return { shared: false };
    const event = await workspace.prepareWorkspaceEvent(record.custody, payload, {
      revisionId, reviewOf: payload.reviewOf,
      signer: { privateKey: record.custody.ownerPrivateKey, publicKey: record.custody.ownerPublicKey },
    });
    record.pendingReviewMetadata ??= [];
    record.pendingReviewMetadata.push(event); save(record);
    try { await flushOwnerMetadata(record, save, options); return { shared: true, pending: false }; }
    catch (error) { return { shared: true, pending: true, error: error.message }; }
  });
}

/** Explicit recovery export; normal status/CLI output never contains credentials. */
export async function exportDesignShareRecovery(file, { output, ...options } = {}) {
  if (!output) throw new Error('Recovery export requires a new private output path.');
  return withCustody(file, options, async ({ record }) => {
    if (!record) throw new Error('Create the shared review first.');
    const target = resolve(output); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { ok: true, output: target };
  });
}

/** Restore owner authority on a second machine without putting secrets in argv. */
export async function importDesignShareRecovery(file, { input, ...options } = {}) {
  if (!input) throw new Error('Recovery restore requires --input <private recovery file>.');
  const recovered = readCustody(resolve(input));
  if (!recovered) throw new Error('Recovery file could not be found.');
  const custody = recovered.custody;
  workspace.workspaceReviewUrl(custody);
  const proof = await workspace.signWorkspaceValue({ recovery: custody.id, nonce: workspace.newWorkspaceId() }, custody.ownerPrivateKey);
  if (!await workspace.verifyWorkspaceSignature(proof, custody.ownerPublicKey)) throw new Error('Recovery private key does not match its owner identity.');
  await workspace.deriveWorkspaceAuthentication(custody.token, custody.id);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(custody.ownerAuth ?? '')) throw new Error('Recovery owner capability is invalid.');
  return withCustody(file, options, async ({ record, current, save }) => {
    if (recovered.designId !== current.document.id) throw new Error('Recovery belongs to a different design.');
    if (record && (record.custody.id !== custody.id || JSON.stringify(record.custody.ownerPublicKey) !== JSON.stringify(custody.ownerPublicKey))) throw new Error('This design already has different owner credentials. Recovery will not overwrite them.');
    if (record && record.custody.version > custody.version) throw new Error('This recovery file is older than the locally saved owner credentials.');
    // Validate published identity before installing recovery from another machine.
    if (!custody.pendingCreate && !recovered.deleted && !recovered.revoked) {
      await workspace.getWorkspace(custody, { fetchImpl: options.fetchImpl });
      const bundle = await workspace.decryptWorkspaceRevision(custody, custody.currentRevision, { fetchImpl: options.fetchImpl });
      if (bundle.design.id !== current.document.id) throw new Error('Recovery belongs to a different design.');
    }
    recovered.lastEvent = 0; // A second machine must import the complete feedback history.
    save(recovered);
    return { ...safeStatus(recovered, current), restored: true };
  });
}

/** Read only encrypted hosted events; merge each revision without retargeting pins. */
export async function syncDesignShare(file, options = {}) {
  // Ordinary local feedback remains usable with project-scoped PLANR_HOME.
  // Only an existing attachment needs private owner storage validation.
  const location = custodyLocation(file, options, { allowMissing: true });
  if (!existsSync(location.path)) return { ok: true, shared: false, imported: 0 };
  return withCustody(file, options, async ({ record, current, save }) => {
    if (!record || record.custody.pendingCreate || record.deleted) return { ok: true, shared: Boolean(record), imported: 0 };
    await flushOwnerMetadata(record, save, options);
    const reviewKey = `design-${hash(current.document.id).slice(0, 24)}`;
    const reviewPath = resolveArtifactReviewDestination({ cwd: current.root, env: options.env ?? process.env, artifactId: reviewKey }).path;
    const currentDigest = digestArtifactEnvelope(current.envelope);
    let imported = 0, hasMore = true, issues = [];
    const ledgerPath = join(current.root, '.design/shared-feedback.json');
    while (hasMore) {
      const page = await workspace.readWorkspaceEvents(record.custody, { after: record.lastEvent ?? 0, fetchImpl: options.fetchImpl });
      const earlier = readJson(ledgerPath, { schemaVersion: '1.0.0', events: [], issues: [], importedReviews: {} });
      const events = [...earlier.events];
      const eventBytes = new Map(events.map((event) => [event.id, canonicalizeJson(event)]));
      const revisionBases = new Map();
      for (const event of events) {
        const previous = revisionBases.get(event.revisionId);
        if (previous && previous !== event.reviewOf) throw new Error('Saved shared feedback binds one revision to conflicting design content.');
        revisionBases.set(event.revisionId, event.reviewOf);
      }
      const pageIssues = [...(page.issues ?? [])];
      for (const event of page.events ?? []) {
        if (eventBytes.has(event.id)) {
          if (eventBytes.get(event.id) !== canonicalizeJson(event)) pageIssues.push({ id: event.id, sequence: event.sequence, reason: 'Shared feedback reuses an event identity with changed bytes.' });
          continue;
        }
        try {
          const boundReviewOf = revisionBases.get(event.revisionId);
          if (boundReviewOf && boundReviewOf !== event.reviewOf) throw new Error('A shared revision identity is bound to conflicting design content.');
          const candidate = mergeWorkspaceFeedback([...events, event], { revisionId: event.revisionId, reviewOf: event.reviewOf, ownerPublicKey: record.custody.ownerPublicKey });
          const invalid = candidate.issues?.find((issue) => (issue.id ?? issue.eventId) === event.id);
          if (invalid) throw new Error(invalid.reason);
          events.push(event); eventBytes.set(event.id, canonicalizeJson(event)); revisionBases.set(event.revisionId, event.reviewOf); imported++;
        } catch (error) {
          pageIssues.push({ id: event.id, sequence: event.sequence, reason: error.message });
        }
      }
      const revisions = new Map();
      for (const event of events) {
        const previous = revisions.get(event.revisionId);
        if (previous && previous !== event.reviewOf) throw new Error('Saved shared feedback binds one revision to conflicting design content.');
        revisions.set(event.revisionId, event.reviewOf);
      }
      const importedReviews = { ...(earlier.importedReviews ?? {}) }, directions = [], metadataByRevision = {};
      await withArtifactReviewLock(reviewPath, () => {
        const ledger = readArtifactReviewState(reviewPath, { allowMissing: true }) ?? createReviewLedger({ artifactId: reviewKey, currentReviewOf: currentDigest });
        const entries = new Map(ledger.reviews.map((entry) => [entry.review.reviewId, entry]));
        for (const [revisionId, reviewOf] of revisions) {
          const merged = mergeWorkspaceFeedback(events, { revisionId, reviewOf, ownerPublicKey: record.custody.ownerPublicKey });
          metadataByRevision[revisionId] = merged.metadata;
          directions.push(...merged.directions);
          pageIssues.push(...(merged.issues ?? []));
          const review = structuredClone(merged.review);
          const previous = entries.get(review.reviewId)?.review;
          const previousImport = earlier.importedReviews?.[review.reviewId];
          importedReviews[review.reviewId] = structuredClone(review);
          // Local owner decisions/resolutions and locally saved replies survive a pull.
          if (previous) {
            review.decision = previous.decision;
            if (previousImport && previous.overall !== previousImport.overall) review.overall = previous.overall;
            review.pins = review.pins.map((pin) => {
              const saved = previous.pins.find((item) => item.id === pin.id);
              const importedPin = previousImport?.pins.find((item) => item.id === pin.id);
              if (!saved) return pin;
              const replies = new Map([...pin.replies, ...saved.replies].map((reply) => [reply.id, reply]));
              return { ...pin, ...(importedPin && saved.status !== importedPin.status ? { status: saved.status, updatedAt: saved.updatedAt } : {}), replies: [...replies.values()] };
            });
          }
          entries.set(review.reviewId, { review, stale: reviewOf !== currentDigest });
        }
        writeArtifactReviewState(reviewPath, createReviewLedger({ artifactId: reviewKey, currentReviewOf: currentDigest, reviews: [...entries.values()] }));
      });
      issues = [...new Map([...(earlier.issues ?? []), ...pageIssues].map((issue) => [`${issue.id ?? issue.eventId}:${issue.sequence}`, issue])).values()];
      atomicJson(ledgerPath, { schemaVersion: '1.0.0', workspaceId: record.custody.id, events, issues, directions, metadataByRevision, importedReviews });
      const next = page.cursor;
      hasMore = Boolean(page.hasMore) && next > record.lastEvent;
      record.lastEvent = next; save(record);
    }
    return { ok: true, shared: true, imported, issues, reviewPath, ...safeStatus(record, current) };
  });
}
