import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

import { digestBytes, jsonBytes } from '../custody/bytes.mjs';
import { readDiagramSet } from '../custody/workspace.mjs';
import { inspectPlainData, same, snapshot, validateAuthoringBundle } from './model.mjs';
import { previewDiagramTransaction } from './transactions.mjs';

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

export class DiagramAuthoringStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DiagramAuthoringStoreError';
    this.code = `E_DIAGRAM_STORE_${code}`;
    this.details = details;
  }
}
const fail = (code, message, details) => { throw new DiagramAuthoringStoreError(code, message, details); };
const hex = digest => {
  if (typeof digest !== 'string' || !DIGEST.test(digest)) fail('IDENTITY', 'Expected a SHA-256 content identity.');
  return digest.slice(7);
};
const identifier = value => {
  if (typeof value !== 'string' || value.length > 128 || !ID.test(value)) fail('IDENTITY', 'Expected a bounded lowercase identifier.');
  return value;
};

/**
 * Node-only, single-file canonical custody. The configured root must already exist.
 * Observed symlinks and hard-linked files are refused. Node path APIs do not isolate
 * this store from a hostile same-user process replacing ancestor directories.
 */
export function createDiagramAuthoringStore({ root, slug, maxBundleBytes = DEFAULT_MAX_BYTES, faultInjector } = {}) {
  if (typeof root !== 'string' || !root.trim() || root.includes('\0')) fail('PATH', 'A workspace root is required.');
  const base = resolve(root);
  if (base === parse(base).root) fail('PATH', 'The filesystem root cannot be a workspace.');
  identifier(slug);
  if (!Number.isSafeInteger(maxBundleBytes) || maxBundleBytes < 1 || maxBundleBytes > 128 * 1024 * 1024) fail('CAPACITY', 'Bundle capacity must be between 1 byte and 128 MiB.');
  if (faultInjector !== undefined && typeof faultInjector !== 'function') fail('OPTIONS', 'faultInjector must be a function.');
  const directory = join(base, 'diagrams', slug);
  const canonical = join(directory, `${slug}.planr-diagram-bundle.json`);
  const metadata = join(directory, '.authoring');
  const ownerPath = join(metadata, 'owner.json');
  const journalPath = join(metadata, 'pending.json');
  const headPath = join(metadata, 'head.json');
  const snapshots = join(metadata, 'snapshots');
  const receipts = join(metadata, 'receipts');
  const locks = join(base, '.openplanr-authoring-locks');
  const lockPath = join(locks, `${slug}.lock`);
  const reclaimPath = join(locks, `${slug}.reclaim`);
  const metadataLimit = maxBundleBytes * 4;
  const receiptPath = transactionId => join(receipts, `${digestBytes(identifier(transactionId)).slice(7)}.json`);
  const snapshotPath = byteDigest => join(snapshots, `${hex(byteDigest)}.json`);
  const inject = async phase => { await faultInjector?.(phase); };

  async function inspect(path, { missing = false, directory: wantDirectory = false, allowLinks = false } = {}) {
    const absolute = resolve(path);
    const parts = absolute.slice(parse(absolute).root.length).split(sep).filter(Boolean);
    let cursor = parse(absolute).root;
    for (let index = 0; index < parts.length; index++) {
      cursor = join(cursor, parts[index]);
      let info;
      try { info = await lstat(cursor); } catch (error) {
        if (error.code === 'ENOENT' && missing) return null;
        throw error;
      }
      const last = index === parts.length - 1;
      if (info.isSymbolicLink() || ((!last || wantDirectory) ? !info.isDirectory() : !info.isFile())) fail('PATH', 'Store paths must contain real directories and regular files.', { path: cursor });
      if (last && !wantDirectory && !allowLinks && info.nlink !== 1) fail('PATH', 'Hard-linked store files are not accepted.', { path: cursor });
      if (last) return info;
    }
    fail('PATH', 'Invalid store path.');
  }

  async function ensureDirectory(path) {
    await inspect(base, { directory: true });
    const child = relative(base, path);
    if (child === '..' || child.startsWith(`..${sep}`)) fail('PATH', 'Store directory escapes its workspace.');
    let cursor = base;
    for (const part of child.split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      try { await mkdir(cursor, { mode: 0o700 }); await flushDirectory(dirname(cursor)); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await inspect(cursor, { directory: true });
    }
  }

  async function flushDirectory(path) {
    await inspect(path, { directory: true });
    const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    try {
      try { await handle.sync(); } catch (error) {
        // Some filesystems do not support directory fsync. Other failures are real.
        if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error;
      }
    } finally { await handle.close(); }
  }

  async function readBytes(path, limit = metadataLimit, optional = false, allowLinks = false) {
    const before = await inspect(path, { missing: optional, allowLinks });
    if (!before) return null;
    if (before.size > limit) fail('CAPACITY', 'Stored content exceeds its bounded capacity.', { path });
    const handle = await open(path, constants.O_RDONLY | NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || (!allowLinks && opened.nlink !== 1)) fail('PATH', 'Store member changed while opening it.', { path });
      const bytes = await handle.readFile();
      if (bytes.length > limit) fail('CAPACITY', 'Stored content exceeds its bounded capacity.', { path });
      return bytes;
    } finally { await handle.close(); }
  }

  async function readJson(path, optional = false, limit = metadataLimit, allowLinks = false) {
    const bytes = await readBytes(path, limit, optional, allowLinks);
    if (!bytes) return null;
    try { return JSON.parse(bytes.toString('utf8')); } catch { fail('CORRUPT', 'Store metadata is not valid JSON.', { path }); }
  }

  async function temporary(path, bytes) {
    await inspect(dirname(path), { directory: true });
    const target = join(dirname(path), `.${randomUUID()}.tmp`);
    const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (digestBytes(await readBytes(target, Math.max(metadataLimit, bytes.length))) !== digestBytes(bytes)) fail('CORRUPT', 'Temporary write did not preserve exact bytes.');
    return target;
  }

  async function remove(path, allowLinks = false) {
    if (!await inspect(path, { missing: true, allowLinks })) return;
    await unlink(path);
    await flushDirectory(dirname(path));
  }

  async function immutable(path, bytes, { allowExisting = true } = {}) {
    const existing = await readBytes(path, Math.max(metadataLimit, bytes.length), true);
    if (existing) {
      if (allowExisting && existing.equals(bytes)) return;
      fail('COLLISION', 'Existing immutable content does not match this operation.', { path });
    }
    const temp = await temporary(path, bytes);
    try {
      // All immutable writes hold the per-diagram lock. Atomic rename avoids a
      // crash window in which a linked snapshot has two surviving names.
      const raced = await readBytes(path, Math.max(metadataLimit, bytes.length), true);
      if (raced) {
        if (!allowExisting || !raced.equals(bytes)) fail('COLLISION', 'Existing immutable content changed before publication.', { path });
      } else await rename(temp, path);
    } finally { await remove(temp); }
    await flushDirectory(dirname(path));
  }

  async function replace(path, bytes) {
    await inspect(path, { missing: true });
    const temp = await temporary(path, bytes);
    try { await inspect(path, { missing: true }); await rename(temp, path); await flushDirectory(dirname(path)); }
    finally { await remove(temp); }
  }

  async function acquire() {
    await ensureDirectory(locks);
    const owner = { pid: process.pid, host: hostname(), token: randomUUID() };
    const candidate = await temporary(lockPath, jsonBytes(owner));
    let acquired = false;
    let reclaimed = false;
    try {
      if (await inspect(reclaimPath, { missing: true })) fail('LOCKED', 'Lock recovery is already in progress.');
      try { await link(candidate, lockPath); acquired = true; } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const previous = await readJson(lockPath, false, 4096, true);
        if (previous?.host !== hostname() || !Number.isSafeInteger(previous.pid) || previous.pid <= 0 || typeof previous.token !== 'string') fail('LOCKED', 'Lock owner cannot be safely identified.');
        try { process.kill(previous.pid, 0); fail('LOCKED', 'Another live process owns this diagram.'); } catch (signalError) { if (signalError.code !== 'ESRCH') throw signalError; }
        // Serialize stale-owner reclamation. Never steal a lock just because it is old.
        try { await link(candidate, reclaimPath); reclaimed = true; } catch (claimError) { if (claimError.code === 'EEXIST') fail('LOCKED', 'Another process is recovering this lock.'); throw claimError; }
        const current = await readJson(lockPath, true, 4096, true);
        if (current && current.token !== previous.token) fail('LOCKED', 'Lock ownership changed during recovery.');
        if (current) await remove(lockPath, true);
        try { await link(candidate, lockPath); acquired = true; } catch (claimError) { if (claimError.code === 'EEXIST') fail('LOCKED', 'Another process acquired the diagram.'); throw claimError; }
      }
    } finally {
      if (reclaimed) await remove(reclaimPath, true);
      await remove(candidate, true);
    }
    if (!acquired) fail('LOCKED', 'The diagram could not be locked.');
    return async () => {
      const current = await readJson(lockPath, true, 4096);
      if (current?.token !== owner.token) fail('LOCKED', 'Lock ownership changed before release.');
      await remove(lockPath);
    };
  }

  async function locked(operation) {
    const release = await acquire();
    try { return await operation(); } finally { await release(); }
  }

  function validBundle(bundle) {
    const validity = validateAuthoringBundle(bundle);
    if (!validity.ok) fail('INVALID', 'The complete bundle is invalid.', { diagnostics: validity.diagnostics });
    if (bundle.diagramId !== slug) fail('IDENTITY', 'Bundle identity must match the store slug.');
    const bytes = jsonBytes(bundle);
    if (bytes.length > maxBundleBytes) fail('CAPACITY', 'The bundle exceeds the configured storage quota.');
    return bytes;
  }

  async function owned({ initialize = false } = {}) {
    await inspect(base, { directory: true });
    const owner = await readJson(ownerPath, true, 4096);
    if (owner) {
      if (owner.kind !== 'diagram-authoring-store' || owner.version !== 1 || owner.diagramId !== slug) fail('COLLISION', 'Store ownership is not recognized.');
      await inspect(snapshots, { directory: true });
      await inspect(receipts, { directory: true });
      return true;
    }
    if (await inspect(canonical, { missing: true })) fail('COLLISION', 'An unowned canonical bundle already exists.');
    const incomplete = await inspect(metadata, { missing: true, directory: true });
    if (incomplete) {
      // An interrupted first initialization may have created only empty folders.
      // These can be completed without deleting or replacing any unknown bytes.
      for (const name of await readdir(metadata)) {
        if (!['snapshots', 'receipts'].includes(name)) fail('COLLISION', 'Unowned or incomplete store metadata needs explicit inspection.');
        await inspect(join(metadata, name), { directory: true });
        if ((await readdir(join(metadata, name))).length) fail('COLLISION', 'Unowned store history already exists.');
      }
    }
    if (!initialize) return false;
    const present = await inspect(directory, { missing: true, directory: true });
    if (present && (await readdir(directory)).filter(name => !incomplete || name !== '.authoring').length) {
      // Explicit adoption may coexist with a verified legacy set, never loose files.
      for (const name of await readdir(directory)) {
        if (incomplete && name === '.authoring') continue;
        await inspect(join(directory, name));
      }
      const legacy = await readDiagramSet(base, slug);
      // The only exception is our independently checked, empty initialization
      // folders. Keep every legacy byte/digest and every other collision checked.
      const changes = legacy?.generatedChanges.filter(change => !(incomplete &&
        change.reason === 'unowned' && change.path === `diagrams/${slug}/.authoring`));
      if (!legacy || legacy.sourceChanges.length || changes.length) fail('COLLISION', 'Existing legacy custody is changed or unowned.');
    }
    await ensureDirectory(metadata);
    await ensureDirectory(snapshots);
    await ensureDirectory(receipts);
    await inject('before-ownership');
    await immutable(ownerPath, jsonBytes({ kind: 'diagram-authoring-store', version: 1, diagramId: slug }));
    return true;
  }

  async function loadSnapshot(byteDigest) {
    const bytes = await readBytes(snapshotPath(byteDigest), maxBundleBytes);
    if (digestBytes(bytes) !== byteDigest) fail('CORRUPT', 'Historical snapshot bytes changed.');
    let bundle;
    try { bundle = JSON.parse(bytes.toString('utf8')); } catch { fail('CORRUPT', 'Historical snapshot is unreadable.'); }
    validBundle(bundle);
    return { bundle, bytes };
  }

  function validateReceipt(receipt, transactionId) {
    if (receipt?.kind !== 'diagram-authoring-receipt' || receipt.version !== 1 || receipt.diagramId !== slug || receipt.transactionId !== transactionId || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1 || !DIGEST.test(receipt.fingerprint) || !DIGEST.test(receipt.resultBytesDigest) || !DIGEST.test(receipt.result?.bundleDigest)) fail('CORRUPT', 'Invalid transaction receipt.');
    return receipt;
  }

  async function saved(receipt, replayed = false) {
    validateReceipt(receipt, receipt.transactionId);
    const { bundle } = await loadSnapshot(receipt.resultBytesDigest);
    if (!same(snapshot(bundle), receipt.result)) fail('CORRUPT', 'Receipt and snapshot identities disagree.');
    return { ok: true, status: 'saved', bundle, receipt, replayed };
  }

  async function current() {
    if (!await owned()) return { ok: true, status: 'absent', path: canonical };
    const pending = await readJson(journalPath, true);
    if (pending) return { ok: false, status: 'unknown', path: canonical, transactionId: pending.transactionId, fingerprint: pending.fingerprint, reason: 'A durable transaction is awaiting recovery.' };
    const head = await readJson(headPath, true, 8192);
    const bytes = await readBytes(canonical, maxBundleBytes, true);
    if (!head && !bytes) return { ok: true, status: 'absent', path: canonical };
    if (!head || !bytes || head.kind !== 'diagram-authoring-head' || head.version !== 1 || head.diagramId !== slug || digestBytes(bytes) !== head.byteDigest) fail('CHANGED', 'Canonical bytes do not match the last known complete save.');
    const receipt = validateReceipt(await readJson(receiptPath(head.transactionId)), head.transactionId);
    if (receipt.resultBytesDigest !== head.byteDigest || receipt.result.bundleDigest !== head.bundleDigest || receipt.sequence !== head.sequence) fail('CORRUPT', 'Head and receipt identities disagree.');
    const { bundle, bytes: immutableBytes } = await loadSnapshot(head.byteDigest);
    if (!bytes.equals(immutableBytes)) fail('CHANGED', 'Canonical source differs from its immutable snapshot.');
    return { ok: true, status: 'ready', path: canonical, bundle, byteDigest: head.byteDigest, basis: snapshot(bundle), receipt };
  }

  async function settle(pending) {
    const receipt = validateReceipt(pending.receipt, pending.transactionId);
    if (pending.kind !== 'diagram-authoring-pending' || pending.version !== 1 || pending.fingerprint !== receipt.fingerprint || pending.baseBytesDigest !== receipt.baseBytesDigest) fail('CORRUPT', 'The pending recovery identity is invalid.');
    const { bundle, bytes } = await loadSnapshot(receipt.resultBytesDigest);
    if (!same(snapshot(bundle), receipt.result)) fail('CORRUPT', 'Pending result and immutable snapshot disagree.');
    if (pending.transaction) {
      if (inspectPlainData(pending.transaction).length || digestBytes(jsonBytes(pending.transaction)) !== receipt.fingerprint || pending.transaction.transactionId !== receipt.transactionId) fail('CORRUPT', 'Pending transaction fingerprint changed.');
      const prior = await loadSnapshot(receipt.baseBytesDigest);
      const replay = previewDiagramTransaction(prior.bundle, pending.transaction);
      if (!replay.ok || !same(snapshot(prior.bundle), receipt.base) || digestBytes(validBundle(replay.bundle)) !== receipt.resultBytesDigest || !same(replay.inverse, receipt.inverse)) fail('CORRUPT', 'Recovery does not reproduce the exact transaction result.');
    } else if (receipt.base !== null || receipt.baseBytesDigest !== null || digestBytes(jsonBytes({ initialize: bundle, transactionId: receipt.transactionId })) !== receipt.fingerprint) fail('CORRUPT', 'Pending initialization fingerprint changed.');
    const canonicalBytes = await readBytes(canonical, maxBundleBytes, true);
    const observed = canonicalBytes ? digestBytes(canonicalBytes) : null;
    if (observed !== receipt.baseBytesDigest && observed !== receipt.resultBytesDigest) return { ok: false, status: 'unknown', transactionId: receipt.transactionId, fingerprint: receipt.fingerprint, reason: 'Canonical bytes changed outside the pending transaction; no content was overwritten.' };
    if (observed !== receipt.resultBytesDigest) {
      const temp = await temporary(canonical, bytes);
      try {
        await inject('after-temporary-flush');
        const reread = await readBytes(canonical, maxBundleBytes, true);
        if ((reread ? digestBytes(reread) : null) !== receipt.baseBytesDigest) fail('CHANGED', 'Canonical bytes changed before replacement.');
        await rename(temp, canonical);
        await flushDirectory(directory);
      } finally { await remove(temp); }
    }
    await inject('after-replacement');
    await immutable(receiptPath(receipt.transactionId), jsonBytes(receipt));
    await inject('after-receipt');
    await replace(headPath, jsonBytes({ kind: 'diagram-authoring-head', version: 1, diagramId: slug, sequence: receipt.sequence, transactionId: receipt.transactionId, byteDigest: receipt.resultBytesDigest, bundleDigest: receipt.result.bundleDigest }));
    await inject('after-head');
    await remove(journalPath);
    await inject('before-acknowledgement');
    return saved(receipt);
  }

  async function recoverInternal({ transactionId, fingerprint } = {}) {
    if (transactionId !== undefined) identifier(transactionId);
    if (fingerprint !== undefined) hex(fingerprint);
    if (!await owned()) return { ok: true, status: 'absent', path: canonical };
    const pending = await readJson(journalPath, true);
    if (pending) {
      if ((transactionId && pending.transactionId !== transactionId) || (fingerprint && pending.fingerprint !== fingerprint)) fail('IDENTITY', 'Recovery request does not identify the pending transaction.');
      return settle(pending);
    }
    if (transactionId) {
      const receipt = await readJson(receiptPath(transactionId), true);
      if (!receipt) return { ok: true, status: 'not-found', transactionId };
      validateReceipt(receipt, transactionId);
      if (fingerprint && receipt.fingerprint !== fingerprint) fail('ID_REUSE', 'Transaction ID was already used with different bytes.');
      return saved(receipt, true);
    }
    return current();
  }

  async function writeRequest({ bundle, transaction, transactionId }) {
    const request = transaction ?? { initialize: bundle, transactionId };
    const diagnostics = inspectPlainData(request);
    if (diagnostics.length) fail('INVALID', 'The save request must contain inert bounded JSON.', { diagnostics });
    transactionId = transaction ? transaction.transactionId : transactionId;
    identifier(transactionId);
    const fingerprint = digestBytes(jsonBytes(request));
    const pendingIdentity = await readJson(journalPath, true);
    if (pendingIdentity?.transactionId === transactionId && pendingIdentity.fingerprint !== fingerprint) fail('ID_REUSE', 'Transaction ID is pending with different bytes.');
    const recovered = await recoverInternal();
    if (!recovered.ok) return recovered;
    const existing = await readJson(receiptPath(transactionId), true);
    if (existing) {
      validateReceipt(existing, transactionId);
      if (existing.fingerprint !== fingerprint) fail('ID_REUSE', 'Transaction ID was already used with different bytes.');
      return saved(existing, true);
    }
    const before = await current();
    if (!before.ok) return before;
    let preview;
    if (transaction) {
      if (before.status !== 'ready') fail('MISSING', 'Initialize the canonical bundle before editing it.');
      preview = previewDiagramTransaction(before.bundle, transaction);
      if (!preview.ok) fail('INVALID_TRANSACTION', 'The transaction does not apply to the current exact base.', { diagnostics: preview.diagnostics });
      bundle = preview.bundle;
    } else if (before.status !== 'absent') fail('COLLISION', 'Initialization never replaces an existing diagram.');
    const bytes = validBundle(bundle);
    await owned({ initialize: true });
    const receipt = { kind: 'diagram-authoring-receipt', version: 1, diagramId: slug, sequence: (before.receipt?.sequence ?? 0) + 1,
      transactionId, fingerprint, base: before.basis ?? null, baseBytesDigest: before.byteDigest ?? null,
      result: snapshot(bundle), resultBytesDigest: digestBytes(bytes), inverse: preview?.inverse ?? null };
    const pending = { kind: 'diagram-authoring-pending', version: 1, transactionId, fingerprint, baseBytesDigest: receipt.baseBytesDigest, transaction: transaction ?? null, receipt };
    const pendingBytes = jsonBytes(pending);
    if (pendingBytes.length > metadataLimit) fail('CAPACITY', 'Recovery metadata exceeds its bounded capacity.');
    await immutable(snapshotPath(receipt.resultBytesDigest), bytes);
    await inject('before-journal');
    await immutable(journalPath, pendingBytes, { allowExisting: false });
    try {
      await inject('after-journal');
      return await settle(pending);
    } catch (error) {
      // A durable intent may already have committed. Only recovery can settle it.
      return { ok: false, status: 'unknown', transactionId, fingerprint, reason: error.message, code: error.code ?? 'E_DIAGRAM_STORE_INTERRUPTED' };
    }
  }

  function captured(value, operation) {
    // Snapshot inert caller input before lock acquisition or any other await.
    // A caller can mutate its own objects without changing this save's identity.
    try {
      const diagnostics = inspectPlainData(value);
      if (diagnostics.length) fail('INVALID', 'Store input must contain inert bounded JSON.', { diagnostics });
      const copy = JSON.parse(JSON.stringify(value));
      return locked(() => operation(copy));
    } catch (error) { return Promise.reject(error); }
  }

  return Object.freeze({
    path: canonical,
    read: () => locked(current),
    initialize: (bundle, identity = {}) => captured({ bundle, identity }, value => writeRequest({ bundle: value.bundle, transactionId: value.identity.transactionId })),
    preview: transaction => captured(transaction, async transaction => {
      const state = await current();
      if (!state.ok) return state;
      if (state.status !== 'ready') fail('MISSING', 'Initialize the canonical bundle before previewing edits.');
      return previewDiagramTransaction(state.bundle, transaction);
    }),
    commit: transaction => captured(transaction, transaction => writeRequest({ transaction })),
    recover: (options = {}) => captured(options, recoverInternal),
    readSnapshot: byteDigest => locked(async () => { if (!await owned()) fail('MISSING', 'The diagram has no snapshot history.'); return (await loadSnapshot(byteDigest)).bundle; }),
    history: ({ limit = 100, beforeSequence = Infinity } = {}) => locked(async () => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000 || (beforeSequence !== Infinity && (!Number.isSafeInteger(beforeSequence) || beforeSequence < 1))) fail('OPTIONS', 'Invalid history page.');
      if (!await owned()) return [];
      const entries = [];
      for (const name of await readdir(receipts)) {
        if (!/^[a-f0-9]{64}\.json$/u.test(name)) fail('COLLISION', 'An unowned history entry exists.');
        const receipt = await readJson(join(receipts, name));
        validateReceipt(receipt, receipt.transactionId);
        if (receiptPath(receipt.transactionId) !== join(receipts, name)) fail('CORRUPT', 'Receipt filename does not match its identity.');
        if (receipt.sequence < beforeSequence) entries.push(receipt);
      }
      return entries.sort((a, b) => b.sequence - a.sequence).slice(0, limit);
    }),
  });
}

export { previewLegacyDiagramMigration, previewLegacyDiagramDocument } from './migration.mjs';
