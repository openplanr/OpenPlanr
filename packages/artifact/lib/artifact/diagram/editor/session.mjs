import {
  compileDiagramCommand,
  createConditionalInverse,
  diffDiagramBundles,
  previewAutomaticLayout,
  previewDiagramTransaction,
  validateAuthoringBundle,
} from '../authoring/index.mjs';
import { clone, inspectPlainData, same, snapshot } from '../authoring/model.mjs';
import { createDiagramGeometryIndex } from './geometry-index.mjs';

const fail = (rule, detail) => ({ ok: false, diagnostics: [{ path: '$session', rule, detail }] });
const defaultId = () => `edit-${globalThis.crypto.randomUUID()}`;
const validId = (value) =>
  typeof value === 'string' &&
  value.length <= 128 &&
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
const MAX_PENDING = 100;
const MAX_HISTORY = 100;
const idOf = (bundle) => bundle.bundleDigest;
const validBundle = (value) => {
  const result = validateAuthoringBundle(value);
  if (!result.ok) throw new TypeError(result.diagnostics[0].detail);
  return clone(value);
};
/** Stable for the same pending prefix, so an unconfirmed batch is retried with the same identity. */
const batchIdFor = (initialization, transactions) =>
  `batch-${transactions.length}-${transactions.at(-1)?.transactionId ?? initialization}`;

/** Framework-neutral content session. View state never enters a saved bundle. */
export function createDiagramEditorSession({
  bundle,
  acknowledged = false,
  transport = null,
  recovery = null,
  nextTransactionId = defaultId,
  capabilities = { read: true, write: true },
  retainRecoveryOnAccessLoss = false,
}) {
  let current = validBundle(bundle);
  let base = clone(current);
  let saved = acknowledged ? clone(current) : null;
  let initialization = acknowledged ? null : nextTransactionId();
  if (initialization !== null && !validId(initialization))
    throw new TypeError('Initialization needs a valid transaction identity.');
  let pending = [];
  let undo = [];
  let redo = [];
  let gesture = null;
  let comparison = null;
  let diagnostics = [];
  let saveState = acknowledged ? 'saved' : 'unsaved';
  let capability = { read: capabilities.read === true, write: capabilities.write === true };
  let disposed = false;
  let epoch = 0;
  let saving = null;
  // A sent batch whose outcome is unknown; the next save resends exactly this prefix first.
  let uncertain = null;
  const listeners = new Set();
  const usedIds = new Set(initialization ? [initialization] : []);
  let view = {
    camera: { x: 0, y: 0, scale: 1, fit: 'all' },
    selection: [],
    collapsedGroups: [],
    trace: [],
    snap: true,
  };
  let recoveryWarning = null;
  const indexResult = createDiagramGeometryIndex(current);
  if (!indexResult.ok) throw new TypeError(indexResult.diagnostics[0].detail);
  const geometry = indexResult.index;

  function emit(type, affectedIds = []) {
    if (disposed) return;
    const event = { type, affectedIds: [...affectedIds], revision: idOf(current), saveState };
    for (const listener of [...listeners]) {
      try {
        listener(clone(event));
      } catch {
        /* A subscriber cannot interrupt a content commit. */
      }
    }
  }
  function persist() {
    if (!recovery || disposed || !capability.read || recoveryWarning) return;
    if (!initialization && !pending.length) recovery.clear();
    else
      recovery.save({
        base,
        initialization,
        transactions: pending.map((item) => item.transaction),
        ...(uncertain ? { uncertain: { ...uncertain } } : {}),
      });
  }
  function guard() {
    if (disposed) return fail('disposed', 'This editor session is closed.');
    if (!capability.read || !capability.write)
      return fail('access-changed', 'This session no longer has owner editing access.');
    return null;
  }
  function pruneView() {
    const ids = new Set(current.presentation.elements.map((item) => item.elementId));
    const containers = new Set(
      [...current.document.groups, ...current.document.lanes].map((item) => item.id),
    );
    view.selection = view.selection.filter((id) => ids.has(id));
    view.trace = view.trace.filter((id) => ids.has(id));
    view.collapsedGroups = view.collapsedGroups.filter((id) => containers.has(id));
  }
  function updateGeometry(next, ids) {
    const result = geometry.update(next, ids);
    if (!result.ok) throw new Error(result.diagnostics[0].detail);
  }
  function accept(preview, history = 'edit') {
    if (!preview.ok || !preview.transaction) return preview;
    if (idOf(preview.bundle) === idOf(current))
      return { ok: true, changed: false, transaction: null };
    if (pending.length >= MAX_PENDING)
      return fail('pending-limit', 'Save the pending edits before adding more.');
    if (usedIds.has(preview.transaction.transactionId))
      return fail('transaction-id', 'Each new edit needs a fresh transaction identity.');
    usedIds.add(preview.transaction.transactionId);
    updateGeometry(preview.bundle, preview.impact.affectedIds);
    pending.push({
      transaction: clone(preview.transaction),
      bundle: clone(preview.bundle),
      inverse: clone(preview.inverse),
    });
    current = clone(preview.bundle);
    if (history === 'edit') {
      undo.push(clone(preview.inverse));
      undo = undo.slice(-MAX_HISTORY);
      redo = [];
    }
    diagnostics = [];
    saveState = comparison ? 'conflict' : saving ? 'saving' : 'unsaved';
    pruneView();
    persist();
    emit('content', preview.impact.affectedIds);
    return clone(preview);
  }
  function checkIdentity(transactionId) {
    return validId(transactionId) && !usedIds.has(transactionId)
      ? null
      : fail('transaction-id', 'Each new edit needs a fresh transaction identity.');
  }
  function submit(command, options = {}) {
    const blocked = guard();
    if (blocked) return blocked;
    if (gesture) return fail('gesture-active', 'Finish or cancel the gesture before another edit.');
    const transactionId = options.transactionId ?? nextTransactionId();
    const invalid = checkIdentity(transactionId);
    if (invalid) return invalid;
    return accept(compileDiagramCommand(current, command, { transactionId }));
  }
  function submitTransaction(transaction) {
    const blocked = guard();
    if (blocked) return blocked;
    if (gesture) return fail('gesture-active', 'Finish or cancel the gesture before another edit.');
    return accept(previewDiagramTransaction(current, transaction));
  }
  function adoptInitialCopy(bundle) {
    const blocked = guard();
    if (blocked) return blocked;
    const isEmpty =
      current.presentation.elements.length === 0 &&
      current.originalSource === null &&
      current.sourceMap === null;
    if (
      saveState !== 'unsaved' ||
      saved !== null ||
      initialization === null ||
      pending.length ||
      undo.length ||
      redo.length ||
      gesture ||
      saving ||
      comparison ||
      !isEmpty
    )
      return fail(
        'initial-copy-state',
        'A complete copy can only initialize a new, empty, unsaved diagram.',
      );
    const validation = validateAuthoringBundle(bundle);
    if (!validation.ok) return validation;
    if (bundle.diagramId !== current.diagramId)
      return fail('diagram-scope', 'An initial copy cannot switch the session to another diagram.');
    if (
      bundle.document.title !== current.document.title ||
      bundle.document.accessibility.title !== current.document.accessibility.title
    ) {
      return fail(
        'diagram-title',
        "Create the copy with this diagram's current title before adopting it.",
      );
    }
    const affectedIds = bundle.presentation.elements.map((item) => item.elementId);
    updateGeometry(bundle, affectedIds);
    current = clone(bundle);
    base = clone(bundle);
    diagnostics = [];
    pruneView();
    persist();
    emit('refresh', affectedIds);
    return { ok: true, bundle: clone(current) };
  }
  function cancelGesture(reason = 'cancel') {
    if (!gesture) return { ok: true, cancelled: false };
    const affected = gesture.preview?.impact.affectedIds ?? [];
    gesture = null;
    updateGeometry(current, affected);
    emit('gesture-cancel', affected);
    return { ok: true, cancelled: true, reason };
  }
  function beginGesture({ transactionId = nextTransactionId() } = {}) {
    const blocked = guard();
    if (blocked) return blocked;
    if (gesture) return fail('gesture-active', 'Finish or cancel the current gesture first.');
    const invalid = checkIdentity(transactionId);
    if (invalid) return invalid;
    gesture = { transactionId, basis: idOf(current), preview: null, diagnostics: [] };
    emit('gesture-start');
    return { ok: true };
  }
  function setPreview(preview) {
    const previous = gesture.preview?.impact.affectedIds ?? [];
    gesture.preview = preview.ok && preview.transaction ? preview : null;
    gesture.diagnostics = preview.ok ? [] : clone(preview.diagnostics);
    const affected = [...new Set([...previous, ...(gesture.preview?.impact.affectedIds ?? [])])];
    updateGeometry(gesture.preview?.bundle ?? current, affected);
    emit('gesture-preview', affected);
    return clone(preview);
  }
  function previewGesture(command) {
    const blocked = guard();
    if (blocked) return blocked;
    if (!gesture) return fail('no-gesture', 'Start a gesture before previewing it.');
    return setPreview(
      compileDiagramCommand(current, command, { transactionId: gesture.transactionId }),
    );
  }
  function previewLayout(options) {
    const blocked = guard();
    if (blocked) return blocked;
    if (!gesture) return fail('no-gesture', 'Start a gesture before previewing layout.');
    return setPreview(
      previewAutomaticLayout(current, { ...options, transactionId: gesture.transactionId }),
    );
  }
  function completeGesture() {
    const blocked = guard();
    if (blocked) return blocked;
    if (!gesture) return fail('no-gesture', 'No gesture is pending.');
    if (gesture.diagnostics.length) return { ok: false, diagnostics: clone(gesture.diagnostics) };
    if (comparison || gesture.basis !== idOf(current))
      return fail(
        'stale-gesture',
        'The authoritative revision changed. Retain or cancel this preview and compare before applying it.',
      );
    const preview = gesture.preview;
    gesture = null;
    if (!preview) return { ok: true, changed: false, transaction: null };
    const result = accept(preview);
    if (!result.ok) updateGeometry(current, preview.impact.affectedIds);
    return result;
  }
  function compensate(source, target, transactionId) {
    const blocked = guard();
    if (blocked) return blocked;
    if (gesture) return fail('gesture-active', 'Finish or cancel the gesture before undo or redo.');
    if (comparison)
      return fail('conflict', 'Compare the authoritative revision before undo or redo.');
    if (!source.length) return { ok: true, changed: false, transaction: null };
    const inverse = createConditionalInverse(current, source.at(-1), { transactionId });
    if (!inverse.ok) {
      diagnostics = clone(inverse.diagnostics);
      emit('undo-conflict');
      return inverse;
    }
    const preview = previewDiagramTransaction(current, inverse.transaction);
    const result = accept(preview, 'compensation');
    if (result.ok && result.transaction) {
      source.pop();
      target.push(clone(result.inverse));
      if (target.length > MAX_HISTORY) target.shift();
      emit('history');
    }
    return result;
  }
  function refresh(authoritative) {
    const blocked = disposed || !capability.read;
    if (blocked) return fail('access-changed', 'This session cannot read a revision.');
    const validation = validateAuthoringBundle(authoritative);
    if (!validation.ok) return validation;
    if (authoritative.diagramId !== current.diagramId)
      return fail('diagram-scope', 'A refresh cannot switch the session to another diagram.');
    if (saved && idOf(authoritative) === idOf(saved)) return { ok: true, changed: false };
    if (pending.length || initialization || gesture || saving) {
      comparison = clone(authoritative);
      saveState = 'conflict';
      emit('conflict');
      return {
        ok: false,
        diagnostics: [
          {
            path: '$session',
            rule: 'conflict',
            detail: 'The authoritative revision changed; your pending work is retained.',
          },
        ],
        comparison: diffDiagramBundles(authoritative, current),
      };
    }
    const diff = diffDiagramBundles(current, authoritative);
    updateGeometry(authoritative, diff.impact.affectedIds);
    current = clone(authoritative);
    base = clone(authoritative);
    saved = clone(authoritative);
    saveState = 'saved';
    comparison = null;
    diagnostics = [];
    pruneView();
    emit('refresh', diff.impact.affectedIds);
    return { ok: true, changed: true };
  }
  function acknowledge(result, expected, transactionId) {
    if (
      !result?.ok ||
      result.status !== 'saved' ||
      !validateAuthoringBundle(result.bundle).ok ||
      !same(result.bundle, expected) ||
      result.receipt?.transactionId !== transactionId ||
      !same(result.receipt.result, snapshot(expected))
    )
      return false;
    saved = clone(expected);
    base = clone(expected);
    if (comparison && idOf(comparison) === idOf(expected)) comparison = null;
    return true;
  }
  async function failureState(result) {
    diagnostics = clone(
      result?.diagnostics ?? [
        {
          path: '$save',
          rule: result?.status === 'unknown' ? 'save-unknown' : 'save-failed',
          detail: 'Save was not acknowledged. Pending work is retained for an exact retry.',
        },
      ],
    );
    const status = result?.httpStatus;
    // A client rejection committed nothing, so the next save may rebatch; unknown outcomes keep the exact batch.
    if (
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500 &&
      status !== 408 &&
      status !== 429
    )
      uncertain = null;
    if (result?.httpStatus === 401 || result?.httpStatus === 403) {
      capability = { read: false, write: false };
      saveState = 'access-changed';
      if (!retainRecoveryOnAccessLoss) recovery?.clear();
      epoch++;
      // This response ended access, so the finally block will not emit; report the final state here.
      emit('save');
    } else if (
      result?.httpStatus === 409 ||
      result?.diagnostics?.some((item) => ['stale-base', 'precondition'].includes(item.rule))
    ) {
      saveState = 'conflict';
      uncertain = null;
    } else saveState = 'offline';
    return { ok: false, status: saveState, diagnostics: clone(diagnostics) };
  }
  function acknowledgeBatch(result, expected, batchId) {
    if (
      !result?.ok ||
      result.status !== 'saved' ||
      !validateAuthoringBundle(result.bundle).ok ||
      !same(result.bundle, expected) ||
      result.receipt?.batchId !== batchId ||
      !same(result.receipt.result, snapshot(expected))
    )
      return false;
    saved = clone(expected);
    base = clone(expected);
    if (comparison && idOf(comparison) === idOf(expected)) comparison = null;
    return true;
  }
  async function performBatches(live, count) {
    const sizes =
      uncertain && uncertain.count <= count ? [uncertain.count, count - uncertain.count] : [count];
    for (const size of sizes) {
      const items = pending.slice(0, size);
      if (!initialization && !items.length) continue;
      const expected = clone(items.length ? items.at(-1).bundle : base);
      const batch = {
        batchId: batchIdFor(
          initialization,
          items.map((item) => item.transaction),
        ),
        initialization: initialization
          ? { bundle: clone(base), transactionId: initialization }
          : null,
        base: initialization ? null : clone(base),
        transactions: items.map((item) => clone(item.transaction)),
        result: clone(expected),
      };
      uncertain = { count: items.length, batchId: batch.batchId };
      persist();
      const result = await transport.saveBatch(clone(batch));
      if (!live())
        return fail(
          'disposed',
          'The save completed after this session lost access or closed. Reopen to read its authoritative outcome.',
        );
      if (
        (items.length && pending[0] !== items[0]) ||
        !acknowledgeBatch(result, expected, batch.batchId)
      )
        return await failureState(result);
      uncertain = null;
      initialization = null;
      pending.splice(0, items.length);
      persist();
      emit(
        'acknowledged',
        items
          .flatMap((item) => item.inverse.changes.semantic.map((change) => change.elementId))
          .filter(Boolean),
      );
    }
    return null;
  }
  async function performSave(runEpoch, count) {
    const live = () => !disposed && epoch === runEpoch && capability.read && capability.write;
    if (!live()) return fail('disposed', 'This session is closed.');
    try {
      if (typeof transport.saveBatch === 'function') {
        const failure = await performBatches(live, count);
        if (failure) return failure;
      } else if (initialization) {
        const requestId = initialization;
        const expected = clone(base);
        const result = await transport.initialize(clone(expected), { transactionId: requestId });
        if (!live())
          return fail(
            'disposed',
            'The save completed after this session lost access or closed. Reopen to read its authoritative outcome.',
          );
        if (!acknowledge(result, expected, requestId)) return await failureState(result);
        initialization = null;
        persist();
        emit('acknowledged');
      }
      if (typeof transport.saveBatch !== 'function')
        for (let index = 0; index < count; index++) {
          const item = pending[0];
          if (!item) break;
          const result = await transport.commit(clone(item.transaction));
          if (!live())
            return fail(
              'disposed',
              'The save completed after this session lost access or closed. Reopen to read its authoritative outcome.',
            );
          if (
            pending[0] !== item ||
            !acknowledge(result, item.bundle, item.transaction.transactionId)
          )
            return await failureState(result);
          pending.shift();
          persist();
          emit(
            'acknowledged',
            item.inverse.changes.semantic.map((change) => change.elementId).filter(Boolean),
          );
        }
      if (!live()) return fail('disposed', 'This session is closed.');
      saveState = comparison ? 'conflict' : pending.length ? 'unsaved' : 'saved';
      diagnostics = [];
      return { ok: true, status: saveState, bundle: clone(saved) };
    } catch (error) {
      if (!live()) return fail('disposed', 'This session is closed.');
      return await failureState({
        ok: false,
        httpStatus: error?.httpStatus,
        diagnostics: error?.details?.diagnostics ?? [
          {
            path: '$save',
            rule: 'save-unavailable',
            detail:
              'The owner did not acknowledge this save. Retry without discarding pending work.',
          },
        ],
      });
    } finally {
      if (live()) {
        persist();
        emit('save');
      }
    }
  }
  function save() {
    const blocked = guard();
    if (blocked) return Promise.resolve(blocked);
    if (saving) return saving;
    if (!transport) {
      saveState = 'offline';
      emit('save');
      return Promise.resolve(
        fail('no-transport', 'No owner store is connected. Pending changes remain unsaved.'),
      );
    }
    if (!initialization && !pending.length) return Promise.resolve({ ok: true, status: saveState });
    saveState = 'saving';
    const runEpoch = epoch;
    const count = pending.length;
    // Install the latch before notifying subscribers; they may call save again.
    const settled = Promise.resolve()
      .then(() => performSave(runEpoch, count))
      .finally(() => {
        if (saving === settled) saving = null;
      });
    saving = settled;
    emit('save');
    return settled;
  }
  function setView(patch) {
    if (disposed || !capability.read)
      return fail('access-changed', 'This session cannot update view state.');
    if (
      inspectPlainData(patch).length ||
      !patch ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => !Object.hasOwn(view, key))
    )
      return fail('view', 'Unknown or non-JSON view preference.');
    const next = { ...view, ...clone(patch) };
    const camera = next.camera;
    if (
      !camera ||
      Object.keys(camera).some((key) => !['x', 'y', 'scale', 'fit'].includes(key)) ||
      !Number.isFinite(camera.x) ||
      !Number.isFinite(camera.y) ||
      !Number.isFinite(camera.scale) ||
      camera.scale <= 0 ||
      ![null, 'all', 'width'].includes(camera.fit) ||
      typeof next.snap !== 'boolean' ||
      ['selection', 'collapsedGroups', 'trace'].some(
        (key) =>
          !Array.isArray(next[key]) ||
          next[key].length > 10000 ||
          next[key].some((id) => typeof id !== 'string'),
      )
    )
      return fail('view', 'Invalid camera or selection preference.');
    view = next;
    pruneView();
    emit('view');
    return { ok: true };
  }
  function restore() {
    if (!recovery || !capability.read) return;
    const record = recovery.load();
    if (!record) return;
    try {
      if (
        inspectPlainData(record).length ||
        Object.keys(record).some(
          (key) => !['base', 'initialization', 'transactions', 'uncertain'].includes(key),
        ) ||
        !validateAuthoringBundle(record.base).ok ||
        record.base.diagramId !== current.diagramId ||
        !(record.initialization === null || validId(record.initialization)) ||
        !Array.isArray(record.transactions) ||
        record.transactions.length > MAX_PENDING ||
        (record.uncertain !== undefined &&
          (!record.uncertain ||
            Object.keys(record.uncertain).some((key) => !['count', 'batchId'].includes(key)) ||
            !Number.isInteger(record.uncertain.count) ||
            record.uncertain.count < 0 ||
            record.uncertain.count > record.transactions.length ||
            record.uncertain.batchId !==
              batchIdFor(
                record.initialization,
                record.transactions.slice(0, record.uncertain.count),
              )))
      )
        throw new Error('Invalid recovery.');
      let draft = clone(record.base);
      const entries = [];
      const ids = new Set(record.initialization ? [record.initialization] : []);
      for (const transaction of record.transactions) {
        const preview = previewDiagramTransaction(draft, transaction);
        if (!preview.ok || ids.has(transaction.transactionId))
          throw new Error('Invalid recovery transaction.');
        ids.add(transaction.transactionId);
        draft = preview.bundle;
        entries.push({
          transaction: preview.transaction,
          bundle: preview.bundle,
          inverse: preview.inverse,
        });
      }
      if (!record.initialization && !entries.length) return;
      const authoritative = saved;
      base = clone(record.base);
      initialization = record.initialization;
      pending = entries;
      uncertain = record.uncertain ? { ...record.uncertain } : null;
      undo = entries.map((item) => clone(item.inverse)).slice(-MAX_HISTORY);
      usedIds.clear();
      ids.forEach((id) => usedIds.add(id));
      const diff = diffDiagramBundles(current, draft);
      updateGeometry(draft, diff.impact.affectedIds);
      current = draft;
      if (authoritative && idOf(authoritative) !== idOf(base)) {
        comparison = authoritative;
        saveState = 'conflict';
      } else saveState = 'unsaved';
    } catch {
      recoveryWarning =
        'Stored edits failed validation and were not applied. The authoritative diagram remains unchanged.';
    }
  }
  restore();
  // Probe storage before exposing a recoverable-draft claim, including blank drafts.
  persist();
  return {
    getState() {
      return {
        bundle: capability.read ? clone(current) : null,
        acknowledged: capability.read && saved ? snapshot(saved) : null,
        pendingCount: pending.length,
        needsInitialization: initialization !== null,
        saveState,
        capabilities: { ...capability },
        view: clone(view),
        gesture: gesture
          ? {
              transactionId: gesture.transactionId,
              basis: gesture.basis,
              diagnostics: clone(gesture.diagnostics),
              bundle: capability.read && gesture.preview ? clone(gesture.preview.bundle) : null,
            }
          : null,
        canUndo: undo.length > 0 && capability.write,
        canRedo: redo.length > 0 && capability.write,
        comparison:
          capability.read && comparison
            ? {
                base: clone(base),
                bundle: clone(comparison),
                diff: diffDiagramBundles(comparison, current),
              }
            : null,
        diagnostics: clone(diagnostics),
        recovery: {
          ...(recovery?.status() ?? {
            mode: 'memory-only',
            warning: 'Refresh recovery is unavailable in this session.',
          }),
          ...(recoveryWarning ? { mode: 'memory-only', warning: recoveryWarning } : {}),
        },
        disposed,
      };
    },
    submit,
    submitTransaction,
    adoptInitialCopy,
    beginGesture,
    previewGesture,
    previewLayout,
    completeGesture,
    cancelGesture,
    undo: (options = {}) => compensate(undo, redo, options.transactionId ?? nextTransactionId()),
    redo: (options = {}) => compensate(redo, undo, options.transactionId ?? nextTransactionId()),
    refresh,
    save,
    setView,
    query: (options) =>
      disposed || !capability.read
        ? fail('access-changed', 'This session cannot inspect geometry.')
        : geometry.query({
            ...options,
            camera: { x: view.camera.x, y: view.camera.y, scale: view.camera.scale },
          }),
    geometry: (id) => (disposed || !capability.read ? null : geometry.get(id)),
    geometryStats: () => geometry.stats(),
    subscribe(listener) {
      if (disposed) return () => {};
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setCapabilities(next) {
      if (disposed) return;
      capability = { read: next.read === true, write: next.write === true };
      epoch++;
      if (!capability.read || !capability.write) {
        cancelGesture('access-changed');
        saveState = 'access-changed';
        if (!capability.read && !retainRecoveryOnAccessLoss) recovery?.clear();
      } else
        saveState = comparison
          ? 'conflict'
          : initialization || pending.length
            ? 'unsaved'
            : 'saved';
      emit('capabilities');
    },
    /** Deliberate conflict resolution; callers must offer draft export before discarding it. */
    useAuthoritative() {
      const blocked = guard();
      if (blocked) return blocked;
      if (saving)
        return fail('save-in-flight', 'Wait for the save result before discarding a draft.');
      if (!comparison) return fail('no-conflict', 'There is no authoritative comparison to adopt.');
      cancelGesture('use-authoritative');
      const target = clone(comparison);
      const diff = diffDiagramBundles(current, target);
      updateGeometry(target, diff.impact.affectedIds);
      current = target;
      base = clone(target);
      saved = clone(target);
      initialization = null;
      pending = [];
      undo = [];
      redo = [];
      comparison = null;
      diagnostics = [];
      uncertain = null;
      saveState = 'saved';
      pruneView();
      persist();
      emit('refresh', diff.impact.affectedIds);
      return { ok: true };
    },
    dispose() {
      if (disposed) return;
      persist();
      cancelGesture('dispose');
      disposed = true;
      epoch++;
      listeners.clear();
    },
  };
}

/** Owner transport is injected; creation and editing never need a company account. */
export async function openDiagramEditorSession({ transport, create, ...options }) {
  const result = await transport.read();
  if (result?.ok && result.status === 'ready')
    return createDiagramEditorSession({
      ...options,
      transport,
      bundle: result.bundle,
      acknowledged: true,
    });
  if (result?.ok && result.status === 'absent' && create)
    return createDiagramEditorSession({
      ...options,
      transport,
      bundle: create,
      acknowledged: false,
    });
  throw new Error(
    'The owner could not provide a complete diagram. Recover or retry before opening an editor.',
  );
}
