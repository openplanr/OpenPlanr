/** Design presentation composes the artifact stage. Pins remain artifact-owned. */
import { createPrototypeStateRelay } from '@openplanr/artifact/ui/prototype-state.mjs';
import {
  cameraFromScreenTranslate,
  cameraToScreenTranslate,
  createCanvas,
} from '@openplanr/canvas';
import canvasStyles from '@openplanr/canvas/styles.css';
import { designFrameViewport } from '../frame-size.mjs';
import { boardPlacement } from './layout.mjs';
import { mountDesignChrome, mountDesignPanels } from './studio-chrome.mjs';

/**
 * Mounts the studio for one payload onto a mounted artifact stage.
 * Returns the controller, or null when the stage or a design preview is missing.
 */
export function mountDesignStudio({ payload, stage: artifactStage }) {
  const design = payload.document;
  const entries = payload.entries;
  const options = globalThis.__OPENPLANR_DESIGN_STUDIO_OPTIONS__ ?? {};
  const storageKey = `openplanr.design-studio.${design.id}`;
  const q = (selector) => document.querySelector(selector);
  const qa = (selector) => [...document.querySelectorAll(selector)];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const readyVariants = design.variants.filter(({ status }) => status === 'ready');
  const views = ['canvas', 'prototype', 'walkthrough'];
  const validId = (items, id, fallback) =>
    items.some((item) => (typeof item === 'string' ? item : item.id) === id) ? id : fallback;
  const normalizedViewport = (value) => {
    if (!Number.isFinite(value?.x) || !Number.isFinite(value?.y) || !Number.isFinite(value?.zoom))
      return null;
    return {
      x: clamp(value.x, -1e7, 1e7),
      y: clamp(value.y, -1e7, 1e7),
      zoom: clamp(value.zoom, 0.05, 2),
    };
  };

  function normalizeState(input = {}) {
    const view = views.includes(input.view) ? input.view : design.defaultView;
    const viewports = {};
    for (const name of views) {
      const viewport = normalizedViewport(input.viewports?.[name]);
      if (viewport) viewports[name] = viewport;
    }
    const legacyViewport = Number.isFinite(input.zoom)
      ? normalizedViewport({
          x: Number.isFinite(input.camera?.x) ? input.camera.x : 40,
          y: Number.isFinite(input.camera?.y) ? input.camera.y : 40,
          zoom: input.zoom,
        })
      : null;
    const activeViewport = viewports[view] ?? legacyViewport ?? { x: 40, y: 40, zoom: 0.5 };
    const state = {
      schemaVersion: '1.1.0',
      view,
      screenId: validId(design.screenOrder, input.screenId, design.screenOrder[0]),
      frameId: validId(design.frames, input.frameId, design.frames[0].id),
      variantId: validId(readyVariants, input.variantId, design.selectedVariant),
      selectedVariant: validId(readyVariants, input.selectedVariant, design.selectedVariant),
      compare: Boolean(input.compare),
      navOpen: input.navOpen === undefined ? true : Boolean(input.navOpen),
      reviewOpen: input.reviewOpen === undefined ? true : Boolean(input.reviewOpen),
      inspectionScale: input.inspectionScale === 'actual' ? 'actual' : 'fit',
      zoom: activeViewport.zoom,
      camera: { x: activeViewport.x, y: activeViewport.y },
      viewports,
      ratings: {},
      remix: {},
      preferences: { selected: [], rejected: [] },
    };
    for (const variant of readyVariants) {
      const rating = input.ratings?.[variant.id];
      if (Number.isInteger(rating) && rating >= 1 && rating <= 5)
        state.ratings[variant.id] = rating;
      if (typeof input.remix?.[variant.id] === 'string')
        state.remix[variant.id] = input.remix[variant.id].slice(0, 8192);
    }
    for (const kind of ['selected', 'rejected']) {
      state.preferences[kind] = [
        ...new Set(
          (Array.isArray(input.preferences?.[kind]) ? input.preferences[kind] : []).filter((id) =>
            readyVariants.some((variant) => variant.id === id),
          ),
        ),
      ];
    }
    return state;
  }

  let savedDraft = null;
  try {
    savedDraft = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
  } catch {
    /* Embedded exports may disallow storage. */
  }
  // Portable views supply only their initial view. Keep the rest of the saved
  // browser state; a live server replaces it with its authoritative GET below.
  let state = normalizeState({
    ...(savedDraft?.state ?? {}),
    ...(payload.state ?? {}),
  });
  function linkedState() {
    const params = new URLSearchParams(location.hash.slice(1));
    const linked = {};
    for (const [key, query] of [
      ['screenId', 'screen'],
      ['frameId', 'frame'],
      ['variantId', 'direction'],
      ['view', 'view'],
    ])
      if (params.has(query)) linked[key] = params.get(query);
    return linked;
  }
  state = normalizeState({ ...state, ...linkedState() });
  function recordLocation() {
    const params = new URLSearchParams({
      screen: state.screenId,
      frame: state.frameId,
      direction: state.variantId,
      view: state.view,
    });
    const next = `#${params}`;
    if (location.hash !== next) history.pushState(null, '', next);
  }
  let revision = payload.revision;
  let layout = clone(design.layout ?? {});
  const undoMoves = [];
  const redoMoves = [];
  const layoutOperations = [];
  let layoutSaving = false;
  let layoutDragDirty = false;
  let activeLayoutOperation = null;
  let layoutBlocked = false;
  let legacyMigrated = false;
  let legacyServerPositions = payload.state?.positions;
  let stateVersion = null;
  let stage = null;
  let root = null;
  let chrome = null;
  let scroll = null;
  let surface = null;
  let grid = null;
  let canvasBackground = null;
  let canvasAttached = false;
  const canvas = createCanvas({
    label: 'Design canvas',
    zoom: { min: 0.05, max: 2 },
    lod: false,
    motion: 'none',
    keyboard: { arrows: 'none' },
    shortcutsEnabled: () => false,
  });
  let cameraFrame = null;
  let selectionOutline = null;
  let dirty = false;
  let contentDirty = false;
  let contentSerial = 0;
  let reviewDirty = false;
  let reviewSerial = 0;
  let reviewSaving = Promise.resolve();
  let reviewTimer = null;
  let latestReview = null;
  let serial = 0;
  let saveTimer = null;
  let saving = Promise.resolve();
  let pollTimer = null;
  let noticeTimer = null;
  let activeNotice = null;
  const dismissedNotices = new Map();
  let readyReported = false;
  let readyReporting = false;
  let destroyed = false;
  let panEnabled = false;
  let spacePan = false;
  let spaceReturnTool = null;
  let activeTool = 'interact';
  let changingTool = false;
  let previousReviewMode = 'interact';
  let gesture = null;
  let rendering = false;
  let previousStageZoom = 100;
  let compactViewport = false;
  let activeArtifactId = '';
  let inspectedSelection = null;
  let viewContextTimer = null;
  let viewContextPending = null;
  let viewContextSignature = null;
  let viewContextConflictRevision = null;
  let viewContextSaving = false;
  const framesUsedWithComments = new Set();
  let frameReload = 0;
  let walkthroughTransition = null;
  let pendingScreen = null,
    screenRequest = 0,
    frameDemandTimer = null;
  let failedSelection = null;
  let frameDemandKey = '';
  let frameDemandGeneration = 0;
  let queuedSelection = null;
  let noteScreenId = null;
  let notesReturnFocus = null;
  const panels = new Map();
  const sectionHeadings = [];
  const canvasPointers = new Set();
  const cleanup = [];

  function listen(target, event, handler, settings) {
    target?.addEventListener(event, handler, settings);
    cleanup.push(() => target?.removeEventListener(event, handler, settings));
  }

  function status(message, phase = 'saved') {
    if (destroyed) return;
    if (chrome) chrome.update({ saveLabel: message, savePhase: phase });
    else {
      const node = q('[data-design-save-state]');
      node.textContent = message;
      node.dataset.status = phase;
    }
  }

  function hideNotice() {
    clearTimeout(noticeTimer);
    const node = q('.design-notice');
    const restoreFocus = node.contains(document.activeElement);
    node.hidden = true;
    activeNotice = null;
    q('[data-design-retry-layout]')?.remove();
    if (restoreFocus) q(`button[data-design-view="${state.view}"]`)?.focus();
  }

  function clearNotice(key) {
    dismissedNotices.delete(key);
    if (activeNotice?.key === key) hideNotice();
  }

  function clearFailedSelection() {
    if (failedSelection) clearNotice(`preview-load:${failedSelection.artifactId}`);
    failedSelection = null;
  }

  function notice(message, persistent = false, key = message) {
    if (destroyed || dismissedNotices.get(key) === message) return;
    const node = q('.design-notice');
    clearTimeout(noticeTimer);
    q('[data-design-retry-layout]')?.remove();
    activeNotice = { key, message, persistent };
    q('[data-design-notice-message]').textContent = message;
    node.hidden = false;
    if (!persistent) noticeTimer = setTimeout(hideNotice, 6000);
  }

  function storeDraft() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          revision,
          stateVersion,
          state:
            !legacyMigrated && (legacyServerPositions || savedDraft?.state?.positions)
              ? {
                  ...state,
                  positions: { ...savedDraft?.state?.positions, ...legacyServerPositions },
                }
              : state,
          unsaved: contentDirty,
          personalPending: dirty && !contentDirty,
        }),
      );
    } catch {
      /* Server persistence remains available when local storage is full. */
    }
  }

  async function jsonRequest(url, init = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...init });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(
        result.error?.message ??
          result.error ??
          result.message ??
          `Save failed (${response.status}).`,
      );
      error.conflict = response.status === 409;
      throw error;
    }
    return result;
  }

  function scheduleViewContext() {
    if (!options.viewContextUrl || !stage || !scroll || destroyed) return;
    if (state.view === 'canvas' && !canvasAttached) return;
    if (viewContextConflictRevision !== null && revision === viewContextConflictRevision) return;
    viewContextConflictRevision = null;
    if (inspectedSelection?.artifactId !== activeArtifactId) inspectedSelection = null;
    const board = ({ screenId, frameId, variantId }) => ({ screenId, frameId, variantId });
    const visible =
      state.view === 'canvas'
        ? visibleEntries().filter((entry) => {
            const bounds = placedBoardBounds(entry);
            if (!bounds) return false;
            const { width, height } = bounds;
            const { x, y } = canvas.worldToScreen(bounds);
            return (
              x < scroll.clientWidth &&
              y < scroll.clientHeight &&
              x + width * state.zoom > 0 &&
              y + height * state.zoom > 0
            );
          })
        : [entryFor()];
    visible.sort(
      (a, b) => design.screenOrder.indexOf(a.screenId) - design.screenOrder.indexOf(b.screenId),
    );
    const context = {
      revision,
      view: state.view,
      visibleScreens: visible.map(board),
      selected: { ...board(state), planrId: inspectedSelection?.planrId ?? null },
      dirty: contentDirty || reviewDirty || layoutDragDirty || layoutOperations.length > 0,
    };
    const signature = JSON.stringify(context);
    if (signature === viewContextSignature) return;
    viewContextSignature = signature;
    viewContextPending = signature;
    clearTimeout(viewContextTimer);
    viewContextTimer = setTimeout(() => {
      viewContextTimer = null;
      void flushViewContext();
    }, 250);
  }

  async function flushViewContext() {
    if (viewContextSaving || !viewContextPending || destroyed) return;
    const body = viewContextPending;
    viewContextPending = null;
    viewContextSaving = true;
    try {
      await jsonRequest(options.viewContextUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-openplanr-design': '1' },
        body,
      });
      clearNotice('view-context');
    } catch (error) {
      viewContextSignature = null;
      if (error.conflict) {
        viewContextConflictRevision = JSON.parse(body).revision;
        viewContextPending = null;
        clearTimeout(viewContextTimer);
        viewContextTimer = null;
        clearNotice('view-context');
        if (revision !== viewContextConflictRevision) scheduleViewContext();
      } else {
        notice(`View context could not be synchronized: ${error.message}`, false, 'view-context');
      }
    } finally {
      viewContextSaving = false;
      if (viewContextPending && viewContextTimer === null) void flushViewContext();
    }
  }

  function persist({ content = false } = {}) {
    dirty = true;
    serial += 1;
    if (content) {
      contentDirty = true;
      contentSerial += 1;
      status('Saving changes', 'saving');
    }
    storeDraft();
    scheduleViewContext();
    root.dispatchEvent(
      new CustomEvent('planr:design-state-change', {
        bubbles: true,
        detail: clone(state),
      }),
    );
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 180);
  }

  function flushState() {
    clearTimeout(saveTimer);
    if (!dirty) return saving;
    const captured = clone(state);
    const capturedSerial = serial;
    const capturedContent = contentDirty;
    const capturedContentSerial = contentSerial;
    saving = saving
      .catch(() => {})
      .then(async () => {
        if (destroyed) return;
        try {
          if (!legacyMigrated && (legacyServerPositions || savedDraft?.state?.positions))
            captured.positions = { ...savedDraft?.state?.positions, ...legacyServerPositions };
          let result;
          if (!capturedContent && typeof options.savePersonalState === 'function') {
            result = await options.savePersonalState(captured, { revision, stateVersion });
          } else if (typeof options.saveState === 'function') {
            result = await options.saveState(captured, {
              revision,
              stateVersion,
              personal: !capturedContent,
            });
          } else if (options.stateUrl) {
            result = await jsonRequest(options.stateUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ state: captured, revision, stateVersion }),
            });
          }
          if (result?.stateVersion !== undefined) stateVersion = result.stateVersion;
          if (result?.revision !== undefined) revision = result.revision;
          clearNotice('personal-save');
          if (capturedContent) clearNotice('content-save');
          if (capturedSerial === serial) {
            dirty = false;
          }
          if (capturedContent && capturedContentSerial === contentSerial) {
            contentDirty = false;
            if (!reviewDirty && !layoutOperations.length)
              status(
                options.stateUrl || options.saveState
                  ? 'All changes saved'
                  : 'Saved in this browser',
              );
          }
          storeDraft();
          scheduleViewContext();
        } catch (error) {
          if (capturedContent)
            status(
              error.conflict ? 'Save conflict' : 'Disconnected · unsaved',
              error.conflict ? 'failed' : 'disconnected',
            );
          notice(
            !capturedContent
              ? 'Canvas preferences could not be synchronized. Your arrangement remains saved in this browser.'
              : error.conflict
                ? 'This review changed in another window. Your unsaved edits remain in this browser. Reload to read the saved review before applying them again.'
                : 'Changes could not be saved. Your draft remains in this browser; reconnect to retry.',
            true,
            capturedContent ? 'content-save' : 'personal-save',
          );
          storeDraft();
        }
      });
    return saving;
  }

  function layoutUrl() {
    return options.layoutUrl ?? options.stateUrl?.replace(/design-state$/, 'design-layout');
  }

  function canSaveLayout() {
    return Boolean(options.saveLayout || layoutUrl());
  }

  function newRevisionNotice() {
    notice(
      'A new design revision is ready. Save or recover this browser’s unsaved changes before reloading.',
      true,
      'new-revision',
    );
  }

  async function rebaseLayout({ announce = true, expectedRevision = revision } = {}) {
    const url = options.statusUrl ?? options.stateUrl?.replace(/design-state$/, 'design-status');
    if (!url) throw new Error('Layout conflict recovery requires a design status URL.');
    const current = await jsonRequest(url);
    if (revision !== expectedRevision) return true;
    if (typeof current.revision !== 'string' || typeof current.contentIdentity !== 'string')
      throw new Error('Design status did not return a revision and authored content identity.');
    if (current.contentIdentity !== payload.contentIdentity) {
      layoutBlocked = true;
      newRevisionNotice();
      return false;
    }
    revision = current.revision;
    layout = clone(current.layout ?? {});
    const discardedRestores = layoutOperations.some((operation) => operation.restore);
    for (let index = layoutOperations.length - 1; index >= 0; index--)
      if (layoutOperations[index].restore) layoutOperations.splice(index, 1);
    for (const moves of [undoMoves, redoMoves])
      for (let index = moves.length - 1; index >= 0; index--)
        if (moves[index].afterRevision !== null) moves.splice(index, 1);
    for (const operation of layoutOperations) {
      const boards = operation.input().boards;
      if (operation.move?.applied) operation.move.before = clone(layout);
      for (const [key, point] of Object.entries(boards)) {
        layout.boards ??= {};
        if (point === null) delete layout.boards[key];
        else layout.boards[key] = { ...layout.boards[key], ...point };
      }
      if (operation.move?.applied) operation.move.after = clone(layout);
      else if (operation.move) {
        const move = operation.move;
        const movedBoard = move.after.boards?.[move.key];
        move.before = clone(layout);
        move.after = clone(layout);
        if (movedBoard) move.after.boards = { ...move.after.boards, [move.key]: movedBoard };
        else if (move.after.boards) delete move.after.boards[move.key];
      }
    }
    render();
    if (announce)
      notice(
        `The layout changed in another window. Pending board moves were rebased onto the current revision.${discardedRestores ? ' Stale undo and redo operations were dropped.' : ''}`,
        true,
        'layout-rebase',
      );
    return true;
  }

  function flushLayout() {
    if (layoutSaving || layoutBlocked || !layoutOperations.length) return saving;
    layoutSaving = true;
    saving = saving.then(async () => {
      let rebased = false;
      try {
        while (layoutOperations.length) {
          const operation = layoutOperations[0];
          const input = { revision, ...operation.input() };
          activeLayoutOperation = operation;
          operation.attempted = true;
          operation.appliedAtSave = operation.move?.applied;
          status('Saving layout', 'saving');
          let result;
          try {
            if (typeof options.saveLayout === 'function') result = await options.saveLayout(input);
            else if (layoutUrl())
              result = await jsonRequest(layoutUrl(), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-openplanr-design': '1' },
                body: JSON.stringify(input),
              });
            else
              throw new Error('Layout save requires a studio layout URL or saveLayout callback.');
          } catch (error) {
            activeLayoutOperation = null;
            operation.canceled = false;
            if (!error.conflict || rebased) throw error;
            rebased = true;
            if (!(await rebaseLayout())) return;
            continue;
          }
          if (typeof result.revision !== 'string')
            throw new Error('Layout save did not return a design revision.');
          operation.saved?.(revision, result.revision);
          revision = result.revision;
          layoutOperations.shift();
          activeLayoutOperation = null;
          storeDraft();
          scheduleViewContext();
        }
        clearNotice('layout-save');
        if (!contentDirty && !reviewDirty) status('All changes saved');
      } catch (error) {
        status(error.conflict ? 'Layout conflict' : 'Layout unsaved', 'failed');
        notice(`Board layout could not be saved: ${error.message}`, true, 'layout-save');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.dataset.designRetryLayout = '';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => void flushLayout());
        q('.design-notice').append(retry);
      } finally {
        activeLayoutOperation = null;
        layoutSaving = false;
      }
    });
    return saving;
  }

  function boardKey(entry) {
    return `${entry.screenId}/${entry.frameId}/${entry.variantId}`;
  }

  function queueMove(move) {
    const point = (value) => {
      const board = value.boards?.[move.key];
      return board ? { x: board.x, y: board.y } : null;
    };
    const operation = {
      move,
      boards: { [move.key]: point(move.after) },
      input: () => ({ boards: operation.boards }),
      saved(previous, next) {
        if (operation.appliedAtSave) {
          move.beforeRevision = previous;
          move.afterRevision = next;
        }
        if (operation.canceled) {
          const boards = { [move.key]: point(layout) };
          layoutOperations.push({ input: () => ({ boards }) });
        }
      },
    };
    layoutOperations.push(operation);
    scheduleViewContext();
    void flushLayout();
  }

  function completeMove(entry, before) {
    const after = clone(layout);
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    const move = {
      key: boardKey(entry),
      before,
      after,
      beforeRevision: null,
      afterRevision: null,
      applied: true,
    };
    undoMoves.push(move);
    redoMoves.length = 0;
    storeDraft();
    if (canSaveLayout()) queueMove(move);
  }

  function restoreMove(redo) {
    const source = redo ? redoMoves : undoMoves;
    const target = redo ? undoMoves : redoMoves;
    const move = source.pop();
    if (!move) return;
    move.applied = redo;
    layout = clone(redo ? move.after : move.before);
    target.push(move);
    render();
    if (!canSaveLayout()) return;
    if (move.beforeRevision === null || move.afterRevision === null) {
      const pending = layoutOperations.find((operation) => operation.move === move);
      if (pending) {
        const board = layout.boards?.[move.key];
        pending.boards = { [move.key]: board ? { x: board.x, y: board.y } : null };
      }
      if (pending === activeLayoutOperation && pending) pending.canceled = !redo;
      else if (!pending?.attempted) {
        if (pending) layoutOperations.splice(layoutOperations.indexOf(pending), 1);
        if (redo) queueMove(move);
      }
      if (!layoutOperations.length && !layoutSaving) {
        clearNotice('layout-save');
        if (!contentDirty && !reviewDirty) status('All changes saved');
      }
      scheduleViewContext();
      return;
    }
    layoutOperations.push({
      restore: true,
      input: () => ({ restoreRevision: redo ? move.afterRevision : move.beforeRevision }),
    });
    scheduleViewContext();
    void flushLayout();
  }

  function migrateLegacyPositions() {
    if (layoutBlocked) return;
    if (!legacyServerPositions && !savedDraft?.state?.positions) {
      legacyMigrated = true;
      return;
    }
    const boards = {};
    for (const positions of [legacyServerPositions, savedDraft?.state?.positions])
      for (const entry of entries) {
        const key = boardKey(entry);
        const point = positions?.[entry.artifactId];
        if (layout.boards?.[key] !== undefined || boards[key] !== undefined || !point) continue;
        if (
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          Math.abs(point.x) > 1e7 ||
          Math.abs(point.y) > 1e7
        )
          continue;
        boards[key] = { x: Math.round(point.x), y: Math.round(point.y) };
      }
    if (Object.keys(boards).length) layout.boards = { ...layout.boards, ...boards };
    render();
    const migrated = () => {
      legacyMigrated = true;
      legacyServerPositions = undefined;
      storeDraft();
      if (options.stateUrl) persist();
    };
    if (Object.keys(boards).length && canSaveLayout()) {
      layoutOperations.push({ input: () => ({ boards }), saved: migrated });
      void flushLayout();
    } else if (canSaveLayout()) migrated();
  }

  function reviewUrl() {
    return (
      options.reviewUrl ??
      (options.stateUrl ? options.stateUrl.replace(/design-state$/, 'review') : null)
    );
  }

  function storeReviewDraft() {
    if (!latestReview) return;
    try {
      localStorage.setItem(
        `${storageKey}.review`,
        JSON.stringify({ review: latestReview, unsaved: reviewDirty }),
      );
    } catch {
      /* Server remains authoritative. */
    }
  }

  function flushReview() {
    clearTimeout(reviewTimer);
    if (!reviewDirty || !latestReview) return reviewSaving;
    const captured = clone(latestReview);
    const capturedSerial = reviewSerial;
    reviewSaving = reviewSaving
      .catch(() => {})
      .then(async () => {
        try {
          if (reviewUrl())
            await jsonRequest(reviewUrl(), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ review: captured }),
            });
          clearNotice('review-save');
          if (capturedSerial === reviewSerial) {
            reviewDirty = false;
            if (!contentDirty && !layoutOperations.length)
              status(reviewUrl() ? 'All changes saved' : 'Saved in this browser');
          }
          storeReviewDraft();
          scheduleViewContext();
        } catch (error) {
          status('Comments unsaved', 'disconnected');
          notice(
            `Comments could not be saved: ${error.message} Your draft remains in this browser.`,
            true,
            'review-save',
          );
          storeReviewDraft();
        }
      });
    return reviewSaving;
  }

  function flush() {
    return Promise.all([flushState(), flushLayout(), flushReview()]);
  }

  function entryFor(
    screenId = state.screenId,
    variantId = state.variantId,
    frameId = state.frameId,
  ) {
    return entries.find(
      (entry) =>
        entry.screenId === screenId && entry.variantId === variantId && entry.frameId === frameId,
    );
  }

  function viewportFor(entry) {
    const frame = design.frames.find(({ id }) => id === entry.frameId);
    return (
      stage.getState().artifacts.find(({ id }) => id === entry.artifactId)?.viewport ??
      designFrameViewport(design, frame)
    );
  }

  function visibleEntries() {
    return entries.filter(
      (entry) =>
        ((state.view === 'canvas' && state.compare) || entry.variantId === state.variantId) &&
        (state.view === 'canvas' ||
          (entry.screenId === state.screenId && entry.frameId === state.frameId)),
    );
  }

  function updatePan() {
    root.dataset.designPanActive = String(state.view === 'canvas' && (panEnabled || spacePan));
    root.dataset.designTool = activeTool;
    canvas.setPointerMode(root.dataset.designInspect === 'true' ? 'none' : 'pan');
    q('[data-design-pan]').setAttribute('aria-pressed', String(activeTool === 'pan'));
    q('[data-planr-mode="interact"]').setAttribute(
      'aria-pressed',
      String(activeTool === 'interact'),
    );
    q('[data-planr-mode="comment"]').setAttribute(
      'aria-pressed',
      String(activeTool === 'annotate'),
    );
    q('[data-design-inspect-mode]')?.setAttribute('aria-pressed', String(activeTool === 'inspect'));
    for (const [id, panel] of panels) {
      const frame = stage.getFrame(id);
      if (frame) {
        const tabIndex =
          activeTool === 'interact' && !panel.hidden && stage.getState().status === 'ready'
            ? 0
            : -1;
        if (frame.tabIndex !== tabIndex) frame.tabIndex = tabIndex;
        frame.__openPlanrBridge?.setViewportGestures?.(state.view === 'canvas' && !panel.hidden);
      }
    }
  }

  function finishGesture() {
    if (!gesture) return;
    const completed = gesture;
    const pointerId = completed.pointerId;
    gesture = null;
    layoutDragDirty = false;
    // Clear our state first: releasing capture can synchronously notify listeners.
    try {
      if (scroll.hasPointerCapture?.(pointerId)) scroll.releasePointerCapture(pointerId);
    } catch {
      /* Already canceled by the browser. */
    }
    updatePan();
    if (completed.mode === 'artboard')
      completeMove(
        entries.find((entry) => entry.artifactId === completed.artifactId),
        completed.before,
      );
    else persist();
    scheduleViewContext();
  }

  // Chromium can stop routing pointer input into a sandboxed product document that stayed
  // live on Canvas through comment mode, so a focused view reloads such a frame once.
  function noteFramesUsedWithComments() {
    if (state.view !== 'canvas' || activeTool !== 'annotate') return;
    for (const id of stage.getLoadedArtifactIds()) framesUsedWithComments.add(id);
  }

  function reloadFrameUsedWithComments(artifactId) {
    if (!framesUsedWithComments.delete(artifactId)) return;
    if (!stage.getLoadedArtifactIds().includes(artifactId)) return;
    const reload = ++frameReload;
    root.dataset.designScreenLoading = 'true';
    const settle = () => {
      if (destroyed || reload !== frameReload) return false;
      if (!pendingScreen) delete root.dataset.designScreenLoading;
      updateFramePlaceholders();
      return true;
    };
    void stage.retryFrames([artifactId]).then(settle, (error) => {
      if (!settle() || error.name === 'AbortError') return;
      notice(
        'This screen could not reload. Select it again to retry; your review is preserved.',
        true,
        `preview-load:${artifactId}`,
      );
    });
  }

  function setTool(tool) {
    if (!['interact', 'annotate', 'pan', 'inspect'].includes(tool)) return;
    if (tool === 'pan' && state.view !== 'canvas') return;
    if (tool === 'annotate' && root.hasAttribute('data-planr-room-comments-paused')) return;
    finishWalkthroughTransition();
    finishGesture();
    if (canvasAttached && canvasPointers.size) {
      saveViewport();
      for (const pointerId of canvasPointers)
        if (scroll.hasPointerCapture?.(pointerId)) scroll.releasePointerCapture(pointerId);
      canvasPointers.clear();
    }
    spacePan = false;
    spaceReturnTool = null;
    activeTool = tool;
    panEnabled = tool === 'pan';
    previousReviewMode = tool === 'annotate' ? 'comment' : 'interact';
    changingTool = true;
    try {
      stage.dispatch({ type: 'set-review-mode', reviewMode: previousReviewMode });
    } finally {
      changingTool = false;
    }
    noteFramesUsedWithComments();
    root.dispatchEvent(new CustomEvent('planr:design-tool-change', { detail: { tool } }));
    updatePan();
  }

  function releaseTemporaryPan() {
    const previous = spaceReturnTool;
    finishGesture();
    if (spacePan) setTool(previous || 'interact');
  }

  function readCanvasCamera() {
    if (!canvasAttached || state.view !== 'canvas') return;
    const { x, y, scale } = cameraToScreenTranslate(canvas.getCamera());
    state.camera = { x, y };
    state.zoom = scale;
  }

  function applyCanvasCamera() {
    canvas.setCamera(cameraFromScreenTranslate({ ...state.camera, scale: state.zoom }));
    saveViewport();
  }

  function saveViewport() {
    readCanvasCamera();
    state.viewports[state.view] = {
      x: state.camera.x,
      y: state.camera.y,
      zoom: state.zoom,
    };
  }

  function restoreViewport(view) {
    const viewport = state.viewports[view];
    if (!viewport) return false;
    state.camera = { x: viewport.x, y: viewport.y };
    state.zoom = viewport.zoom;
    if (canvasAttached && view === 'canvas') applyCanvasCamera();
    return true;
  }

  function switchView(view, { save = true } = {}) {
    if (!views.includes(view)) throw new TypeError(`Unknown design view: ${view}`);
    if (view === state.view) return;
    // A view switch changes presentation, not the screen the user requested.
    // Keep a document load in flight and apply it in the new view when ready.
    const queued = pendingScreen ? null : queuedSelection;
    finishWalkthroughTransition();
    closeDesignNotes();
    saveViewport();
    state.view = view;
    const restored = view === 'canvas' && restoreViewport(view);
    setTool(view === 'canvas' && activeTool === 'annotate' ? 'annotate' : 'interact');
    // Enter a focused viewer with product interaction, not a carried-over pin
    // or inspector cursor. Drafts stay in the review controller untouched.
    root.dispatchEvent(new CustomEvent('planr:design-view-change', { detail: { view } }));
    render();
    if (!restored) fit({ save: false });
    if (queued) selectEntry(queued.entry, { ...queued.settings, save: false });
    if (save) {
      persist();
      recordLocation();
    }
  }

  function syncCanvasChrome() {
    if (!canvasAttached) return;
    const stageRect = scroll.getBoundingClientRect();
    for (const [id, selector, edge, open] of [
      ['toolbar', '.design-toolbar', 'top', true],
      ['navigator', '.design-navigator', 'left', state.navOpen],
      ['review', '.planr-review-rail', 'right', stage.getState().railOpen],
    ]) {
      const rect = q(selector).getBoundingClientRect();
      const x = Math.max(0, rect.left - stageRect.left);
      const y = Math.max(0, rect.top - stageRect.top);
      const width = Math.max(0, Math.min(stageRect.width, rect.right - stageRect.left) - x);
      const height = Math.max(0, Math.min(stageRect.height, rect.bottom - stageRect.top) - y);
      canvas.setChrome({
        id,
        edge,
        rect: { x, y, width, height },
        open: open && width > 0 && height > 0,
      });
    }
  }

  function placedBoardBounds(entry) {
    const panel = panels.get(entry.artifactId);
    if (!panel || panel.hidden) return null;
    const bounds = {
      ...viewportFor(entry),
      x: parseFloat(panel.style.left),
      y: parseFloat(panel.style.top),
    };
    return Object.values(bounds).every(Number.isFinite) ? bounds : null;
  }

  function syncCanvasNodes() {
    if (!canvasAttached) return;
    const placed = visibleEntries().flatMap((entry) => {
      const bounds = placedBoardBounds(entry);
      return bounds ? [{ entry, bounds }] : [];
    });
    const nodes = placed.flatMap(({ entry, bounds }) => {
      return [
        { id: entry.artifactId, bounds },
        // Include the artboard heading's established fit clearance.
        { id: `label:${entry.artifactId}`, bounds: { ...bounds, y: bounds.y - 64, height: 64 } },
      ];
    });
    sectionHeadings.forEach((heading, index) => {
      const bounds = {
        x: parseFloat(heading.style.left),
        y: parseFloat(heading.style.top),
        width: heading.offsetWidth,
        height: heading.offsetHeight,
      };
      if (Object.values(bounds).every(Number.isFinite))
        nodes.push({ id: `section:${layout.sections[index].id}`, bounds });
    });
    canvas.setNodes(nodes);
    for (const { entry } of placed)
      canvas.registerNodeElement(entry.artifactId, panels.get(entry.artifactId));
    canvas.setSelection(
      placed.some(({ entry }) => entry.artifactId === activeArtifactId) ? [activeArtifactId] : [],
    );
  }

  function syncCanvas() {
    if (state.view !== 'canvas') {
      if (canvasAttached) canvas.detach();
      canvasPointers.clear();
      canvasAttached = false;
      return;
    }
    if (!canvasAttached) {
      canvas.attach({ stage: scroll, world: grid });
      canvasAttached = true;
      applyCanvasCamera();
    }
    syncCanvasNodes();
    syncCanvasChrome();
  }

  function centerEntry(entry) {
    if (state.view !== 'canvas' || !placedBoardBounds(entry)) return;
    canvas.reveal(entry.artifactId, { mode: 'center' });
    saveViewport();
    renderCamera();
  }

  function updateDesignNotes() {
    const notes = q('[data-design-notes]');
    if (!notes) return;
    notes.querySelector(':scope > summary').setAttribute('aria-expanded', String(notes.open));
    for (const button of qa('[data-design-note]'))
      button.setAttribute(
        'aria-expanded',
        String(notes.open && button.dataset.designNote === noteScreenId),
      );
    if (!notes.open) return;
    const panel = q('.design-guidance-panel');
    const anchor = notes.querySelector(':scope > summary').getBoundingClientRect();
    const width = panel.getBoundingClientRect().width || Math.min(340, window.innerWidth - 24);
    const top = clamp(anchor.bottom + 7, 12, Math.max(12, window.innerHeight - 100));
    panel.style.left = `${clamp(anchor.right - width, 12, Math.max(12, window.innerWidth - width - 12))}px`;
    panel.style.top = `${top}px`;
    panel.style.maxHeight = `${Math.min(520, Math.max(60, window.innerHeight - top - 12))}px`;
  }

  function closeDesignNotes({ restoreFocus = false } = {}) {
    const notes = q('[data-design-notes]');
    if (!notes?.open) return;
    notes.open = false;
    noteScreenId = null;
    updateDesignNotes();
    if (restoreFocus) {
      const target = notesReturnFocus?.isConnected
        ? notesReturnFocus
        : notes.querySelector(':scope > summary');
      target?.focus({ preventScroll: true });
    }
    notesReturnFocus = null;
  }

  function openDesignNote(screenId, trigger) {
    const notes = q('[data-design-notes]');
    if (!notes) return;
    if (notes.open && noteScreenId === screenId) {
      closeDesignNotes();
      return;
    }
    notesReturnFocus = trigger;
    noteScreenId = screenId;
    notes.open = true;
    let target = null;
    for (const item of qa('[data-design-note-screen]')) {
      const selected = item.dataset.designNoteScreen === screenId;
      item.open = selected;
      item.dataset.active = String(selected);
      if (selected) target = item;
    }
    updateDesignNotes();
    const panel = q('.design-guidance-panel');
    if (target)
      panel.scrollTop = Math.max(0, target.offsetTop - panel.querySelector('header').offsetHeight);
  }

  function render() {
    if (!stage || rendering || destroyed) return;
    rendering = true;
    try {
      if (window.innerWidth <= 680)
        root.style.setProperty(
          '--planr-toolbar-height',
          `${q('.design-toolbar').getBoundingClientRect().height}px`,
        );
      else root.style.removeProperty('--planr-toolbar-height');
      const screen = design.screens.find(({ id }) => id === state.screenId);
      const variant = design.variants.find(({ id }) => id === state.variantId);
      const stageState = stage.getState();
      root.dataset.designView = state.view;
      root.dataset.designNavOpen = String(state.navOpen);
      const navigator = q('.design-navigator');
      navigator.inert = !state.navOpen;
      navigator.setAttribute('aria-hidden', String(!state.navOpen));
      for (const toggle of qa('[data-design-toggle-nav]'))
        toggle.setAttribute('aria-expanded', String(state.navOpen));
      for (const button of qa('[data-design-view]')) {
        if (button.tagName === 'BUTTON')
          button.setAttribute('aria-pressed', String(button.dataset.designView === state.view));
      }
      for (const button of qa('[data-design-screen]'))
        button.setAttribute(
          'aria-current',
          button.dataset.designScreen === state.screenId ? 'page' : 'false',
        );
      q('[data-design-variant]').value = failedSelection?.variantId ?? state.variantId;
      q('[data-design-frame]').value = failedSelection?.frameId ?? state.frameId;
      if (q('[data-design-compare]')) q('[data-design-compare]').checked = state.compare;
      q('[data-design-screen-title]').textContent =
        state.view === 'canvas' ? design.title : screen.title;
      q('[data-design-stage-description]').textContent =
        state.view === 'canvas'
          ? `${design.screenOrder.length} screens · ${design.frames.length} responsive ${design.frames.length === 1 ? 'frame' : 'frames'}${state.compare ? ` · ${readyVariants.length} directions` : ''}`
          : state.view === 'prototype'
            ? 'Explore the working journey'
            : 'A guided journey through the design';
      q('[data-design-direction-label]').textContent = variant.label;
      const chosen =
        state.selectedVariant === state.variantId &&
        state.preferences.selected.includes(state.variantId);
      q('[data-design-selected-direction]').textContent = chosen ? 'Selected' : '';
      q('[data-design-select-direction]').disabled = chosen;
      q('[data-design-select-direction]').textContent = chosen
        ? 'Selected direction'
        : 'Use this direction';
      for (const button of qa('[data-design-rating]')) {
        const selected =
          Number(button.dataset.designRating) <= (state.ratings[state.variantId] ?? 0);
        button.setAttribute('aria-pressed', String(selected));
        button.textContent = selected ? '★' : '☆';
      }
      if (document.activeElement !== q('[data-design-remix]'))
        q('[data-design-remix]').value = state.remix[state.variantId] ?? '';
      q('[data-design-pan]').hidden = state.view !== 'canvas';
      for (const control of qa('[data-design-zoom]')) control.hidden = state.view !== 'canvas';
      q('[data-design-actual-size]').hidden = state.view === 'canvas';
      q('[data-design-actual-size]').setAttribute(
        'aria-pressed',
        String(state.inspectionScale === 'actual'),
      );
      root.dataset.designInspectionScale = state.inspectionScale;
      q('.design-canvas-tools').setAttribute(
        'aria-label',
        state.view === 'canvas' ? 'Canvas controls' : 'Screen controls',
      );
      const fitControl = q('[data-design-fit]');
      fitControl.textContent = state.view === 'canvas' ? 'Fit' : 'Fit screen';
      fitControl.setAttribute(
        'aria-label',
        state.view === 'canvas' ? 'Fit all visible artboards' : 'Fit screen',
      );
      const comparison = q('[data-design-compare]');
      if (comparison) comparison.closest('label').hidden = state.view !== 'canvas';
      const caption = q('.design-walkthrough-caption');
      caption.hidden = state.view !== 'walkthrough';
      q('[data-design-step]').textContent =
        `Step ${design.screenOrder.indexOf(state.screenId) + 1} of ${design.screenOrder.length}`;
      q('[data-design-narrative-title]').textContent = screen.title;
      q('[data-design-narrative]').textContent =
        screen.description ??
        design.flows?.find((flow) => flow.screens.includes(screen.id))?.title ??
        design.brief?.text ??
        '';
      q('[data-design-step-change="-1"]').disabled = requestedScreen() === design.screenOrder[0];
      q('[data-design-step-change="1"]').disabled = requestedScreen() === design.screenOrder.at(-1);
      for (const item of qa('[data-design-note-screen]'))
        item.dataset.active = String(item.dataset.designNoteScreen === state.screenId);

      for (const heading of sectionHeadings) heading.hidden = state.view !== 'canvas';
      const visible = visibleEntries();
      const visibleIds = new Set(visible.map(({ artifactId }) => artifactId));
      for (const entry of entries) {
        const panel = panels.get(entry.artifactId);
        const isVisible = visibleIds.has(entry.artifactId);
        const outgoing = walkthroughTransition?.from === entry.artifactId;
        panel.hidden = !isVisible && !outgoing;
        panel.dataset.designActive = String(entry.artifactId === activeArtifactId);
        const frameElement = stage.getFrame(entry.artifactId);
        const layer = panel.querySelector('[data-planr-annotation-layer]');
        const ready =
          stageState.status === 'ready' &&
          (!stage.frameBudget || frameElement.dataset.planrFrameState === 'ready');
        frameElement.tabIndex = isVisible && ready && stageState.reviewMode === 'interact' ? 0 : -1;
        layer.tabIndex = isVisible && ready && stageState.reviewMode === 'comment' ? 0 : -1;
        layer.setAttribute('aria-disabled', String(layer.tabIndex < 0));
        if (!isVisible && !outgoing) continue;
        const placement = boardPlacement(design, entry, {
          layout,
          compare: state.compare,
          variantId: state.variantId,
        });
        let { x, y } = placement;
        if (state.view !== 'canvas') {
          x = 0;
          y = 0;
        }
        panel.style.left = `${x}px`;
        panel.style.top = `${y}px`;
        panel.querySelector('.design-artboard-drag strong').textContent = placement.title;
      }
      grid.style.width = '1px';
      grid.style.height = '1px';
      surface.style.width = '100%';
      surface.style.height = '100%';
      syncCanvas();
      updatePan();
      renderCamera();
      chrome?.update({ view: state.view, navOpen: state.navOpen, reviewOpen: stageState.railOpen });
      if (state.view !== 'canvas' && activeArtifactId)
        reloadFrameUsedWithComments(activeArtifactId);
      root.dispatchEvent(new CustomEvent('planr:design-render', { detail: clone(state) }));
    } finally {
      rendering = false;
    }
  }

  // Moving the viewport must not rewrite artboard visibility, geometry or frame
  // focus state. Those belong to structural renders; the compositor owns motion.
  function scheduleCamera() {
    if (cameraFrame !== null || destroyed) return;
    cameraFrame = requestAnimationFrame(() => {
      cameraFrame = null;
      renderCamera();
    });
  }
  function renderCamera() {
    if (!stage || destroyed) return;
    if (cameraFrame !== null) {
      cancelAnimationFrame(cameraFrame);
      cameraFrame = null;
    }
    readCanvasCamera();
    if (state.view !== 'canvas') {
      // A focused view has no navigable world: fit the authored frame inside
      // its viewport. Scrolling and gestures within the iframe remain native.
      const frame = viewportFor(entryFor());
      const inset = window.innerWidth <= 680 ? 12 : 24;
      state.zoom =
        state.inspectionScale === 'actual'
          ? 1
          : Math.max(
              0.001,
              Math.min(
                1,
                Math.max(1, scroll.clientWidth - inset * 2) / frame.width,
                Math.max(1, scroll.clientHeight - inset * 2) / frame.height,
              ),
            );
      state.camera = {
        x:
          state.inspectionScale === 'actual'
            ? inset
            : (scroll.clientWidth - frame.width * state.zoom) / 2,
        y:
          state.inspectionScale === 'actual'
            ? inset
            : (scroll.clientHeight - frame.height * state.zoom) / 2,
      };
      if (state.inspectionScale === 'actual') {
        surface.style.width = `${Math.max(scroll.clientWidth, frame.width + inset * 2)}px`;
        surface.style.height = `${Math.max(scroll.clientHeight, frame.height + inset * 2)}px`;
      }
      saveViewport();
    }
    const zoom = String(state.zoom);
    if (grid.style.getPropertyValue('--design-zoom') !== zoom)
      grid.style.setProperty('--design-zoom', zoom);
    if (state.view !== 'canvas')
      grid.style.transform = `translate(${state.camera.x}px, ${state.camera.y}px) scale(${state.zoom})`;
    // Translate a bounded background layer rather than invalidating inherited
    // properties on the entire shell or repainting its full stage background.
    const pixelRatio = window.devicePixelRatio || 1;
    const backgroundOffset = (value) => Math.round((value % 24) * pixelRatio) / pixelRatio;
    canvasBackground.style.transform = `translate3d(${backgroundOffset(state.camera.x)}px, ${backgroundOffset(state.camera.y)}px, 0)`;
    const active = entries.find((entry) => entry.artifactId === activeArtifactId);
    const bounds = active ? placedBoardBounds(active) : null;
    if (selectionOutline) {
      selectionOutline.hidden = state.view !== 'canvas' || !bounds;
      if (!selectionOutline.hidden) {
        const frame = design.frames.find((item) => item.id === active.frameId);
        const ratio = window.devicePixelRatio || 1;
        const pixel = (value) => Math.round(value * ratio) / ratio;
        const x = pixel(state.camera.x + bounds.x * state.zoom);
        const y = pixel(state.camera.y + bounds.y * state.zoom);
        selectionOutline.style.transform = `translate3d(${x - 3}px, ${y - 3}px, 0)`;
        selectionOutline.style.width = `${pixel(frame.width * state.zoom) + 6}px`;
        selectionOutline.style.height = `${pixel(viewportFor(active).height * state.zoom) + 6}px`;
      }
    }
    const label = `${Math.round(state.zoom * 100)}%`;
    const reset = q('[data-design-zoom="reset"]');
    if (reset.textContent !== label) reset.textContent = label;
    scheduleFrameDemand();
    root.dispatchEvent(
      new CustomEvent('planr:design-camera', {
        detail: { view: state.view, zoom: state.zoom, camera: { ...state.camera } },
      }),
    );
  }

  function updateFramePlaceholders() {
    if (!stage?.frameBudget || destroyed) return;
    for (const [id, panel] of panels) {
      const frame = stage.getFrame(id),
        placeholder = panel.querySelector('[data-design-load-frame]');
      if (!placeholder) continue;
      const status = frame.dataset.planrFrameState || 'unloaded';
      placeholder.hidden = status === 'ready';
      placeholder.disabled = status === 'loading';
      const copy =
        status === 'loading'
          ? 'Loading screen…'
          : status === 'error'
            ? 'Retry screen'
            : 'Open screen';
      if (placeholder.textContent !== copy) placeholder.textContent = copy;
      frame.style.visibility = status === 'ready' ? '' : 'hidden';
    }
  }
  function scheduleFrameDemand() {
    if (!stage?.frameBudget || destroyed) return;
    clearTimeout(frameDemandTimer);
    const generation = frameDemandGeneration;
    frameDemandTimer = setTimeout(() => {
      if (
        destroyed ||
        generation !== frameDemandGeneration ||
        !readyReported ||
        pendingScreen ||
        walkthroughTransition ||
        state.view !== 'canvas' ||
        root.dataset.sharedOpening ||
        document.querySelector('.design-welcome[open]')
      )
        return;
      const box = scroll.getBoundingClientRect();
      const nearby = visibleEntries()
        .map((entry) => {
          const rect = panels.get(entry.artifactId).getBoundingClientRect();
          return {
            id: entry.artifactId,
            visible:
              rect.right > box.left &&
              rect.left < box.right &&
              rect.bottom > box.top &&
              rect.top < box.bottom,
            distance: Math.hypot(
              (rect.left + rect.right - box.left - box.right) / 2,
              (rect.top + rect.bottom - box.top - box.bottom) / 2,
            ),
          };
        })
        .filter((item) => item.visible)
        .sort((a, b) => a.distance - b.distance);
      const ids = [
        ...new Set([activeArtifactId, ...nearby.map((item) => item.id)].filter(Boolean)),
      ].slice(0, stage.frameBudget);
      const key = ids.join('|');
      if (key === frameDemandKey) return;
      frameDemandKey = key;
      void stage
        .ensureFrames(ids, () => !destroyed && generation === frameDemandGeneration)
        .then(() => {
          noteFramesUsedWithComments();
          updateFramePlaceholders();
        })
        .catch((error) => {
          if (!destroyed && error.name !== 'AbortError') {
            frameDemandKey = '';
            updateFramePlaceholders();
          }
        });
    }, 120);
  }

  // A display:none iframe has no painted layer. Keep the previous screen in
  // place while the next one's existing frame lays out, then reveal it above
  // that fully opaque backing. Never clone/reload authored DOM or fade both
  // screens out together: that exposes the stage as a flash between steps.
  function finishWalkthroughTransition({ continueQueued = false } = {}) {
    const transition = walkthroughTransition;
    const queued = continueQueued ? queuedSelection : null;
    queuedSelection = null;
    if (!transition) return;
    walkthroughTransition = null;
    cancelAnimationFrame(transition.frame);
    clearTimeout(transition.timeout);
    for (const animation of transition.animations ?? []) animation.cancel();
    for (const visual of transition.visuals ?? []) delete visual.dataset.designTransitionVisual;
    for (const id of [transition.from, transition.to]) {
      const panel = panels.get(id);
      panel.inert = false;
      panel.removeAttribute('aria-hidden');
      delete panel.dataset.designTransitionOutgoing;
      delete panel.dataset.designTransitionIncoming;
    }
    delete root.dataset.designTransition;
    render();
    if (queued && !destroyed) selectEntry(queued.entry, queued.settings);
  }

  function prepareWalkthroughTransition(entry) {
    const from = activeArtifactId;
    const outgoing = panels.get(from);
    const incoming = panels.get(entry.artifactId);
    const direction =
      design.screenOrder.indexOf(entry.screenId) < design.screenOrder.indexOf(state.screenId)
        ? -1
        : 1;
    const transition = {
      from,
      to: entry.artifactId,
      direction,
      frame: null,
      timeout: null,
      animations: [],
      visuals: [],
    };
    walkthroughTransition = transition;
    root.dataset.designTransition = 'preparing';
    outgoing.dataset.designTransitionOutgoing = '';
    incoming.dataset.designTransitionIncoming = '';
    if (outgoing.contains(document.activeElement))
      q(`[data-design-step-change="${direction}"]`).focus({ preventScroll: true });
    outgoing.inert = incoming.inert = true;
    outgoing.setAttribute('aria-hidden', 'true');
    const finish = () => {
      if (walkthroughTransition === transition)
        finishWalkthroughTransition({ continueQueued: true });
    };
    // Background tabs and interrupted animations must never leave an inert
    // screen behind. The deadline only settles; it never starts late motion.
    transition.timeout = setTimeout(finish, 1000);
    transition.frame = requestAnimationFrame(() => {
      transition.frame = requestAnimationFrame(() => {
        if (walkthroughTransition !== transition || destroyed) return;
        if (
          document.hidden ||
          window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ||
          typeof incoming.animate !== 'function'
        ) {
          finish();
          return;
        }
        root.dataset.designTransition = 'running';
        const frameVisual = incoming.querySelector('.planr-frame iframe');
        const annotationVisual = incoming.querySelector('[data-planr-annotation-layer]');
        transition.visuals = [frameVisual, annotationVisual].filter(Boolean);
        for (const visual of transition.visuals) visual.dataset.designTransitionVisual = '';
        const options = { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' };
        transition.animations = [
          frameVisual.animate(
            [
              { opacity: 0, transform: `translate3d(${(direction * 12) / state.zoom}px, 0, 0)` },
              { opacity: 1, transform: 'translate3d(0, 0, 0)' },
            ],
            options,
          ),
        ];
        if (annotationVisual)
          transition.animations.push(
            annotationVisual.animate([{ opacity: 0 }, { opacity: 1 }], options),
          );
        Promise.all(transition.animations.map((animation) => animation.finished)).then(
          finish,
          () => {},
        );
      });
    });
  }

  function requestedSelection() {
    return pendingScreen?.entry ?? queuedSelection?.entry ?? failedSelection ?? state;
  }

  function requestedEntry(changes = {}) {
    const requested = requestedSelection();
    return entryFor(
      changes.screenId ?? requested.screenId,
      changes.variantId ?? requested.variantId,
      changes.frameId ?? requested.frameId,
    );
  }

  function requestedScreen() {
    return requestedSelection().screenId;
  }

  function selectEntry(entry, { save = true, reveal = false, loaded = false } = {}) {
    if (!entry) return false;
    if (
      stage.frameBudget &&
      !loaded &&
      (pendingScreen || !stage.getLoadedArtifactIds().includes(entry.artifactId))
    ) {
      // The newest load supersedes an older animation's queued selection.
      queuedSelection = null;
      if (pendingScreen?.entry.artifactId === entry.artifactId) return true;
      clearFailedSelection();
      const request = ++screenRequest;
      pendingScreen = { entry };
      root.dataset.designScreenLoading = 'true';
      const ids = [...new Set([activeArtifactId, entry.artifactId].filter(Boolean))];
      void stage
        .ensureFrames(ids)
        .then(() => {
          if (destroyed || request !== screenRequest) return;
          pendingScreen = null;
          delete root.dataset.designScreenLoading;
          selectEntry(entry, { save, reveal, loaded: true });
          updateFramePlaceholders();
        })
        .catch((error) => {
          if (destroyed || request !== screenRequest || error.name === 'AbortError') return;
          pendingScreen = null;
          failedSelection = entry;
          delete root.dataset.designScreenLoading;
          notice(
            'This screen could not load. Select it again to retry; your review is preserved.',
            true,
            `preview-load:${entry.artifactId}`,
          );
          render();
          updateFramePlaceholders();
        });
      return true;
    }
    clearFailedSelection();
    const sameFrame = entry.frameId === state.frameId && entry.variantId === state.variantId;
    if (walkthroughTransition && state.view === 'walkthrough' && sameFrame) {
      // Coalesce rapid requests instead of cutting an animation halfway or
      // ignoring clicks. Subsequent step buttons advance from this target.
      queuedSelection =
        entry.artifactId === activeArtifactId ? null : { entry, settings: { save, reveal } };
      q('[data-design-step-change="-1"]').disabled = requestedScreen() === design.screenOrder[0];
      q('[data-design-step-change="1"]').disabled = requestedScreen() === design.screenOrder.at(-1);
      return true;
    }
    finishWalkthroughTransition();
    if (
      state.view === 'walkthrough' &&
      sameFrame &&
      readyReported &&
      entry.artifactId !== activeArtifactId &&
      !document.hidden
    )
      prepareWalkthroughTransition(entry);
    state.screenId = entry.screenId;
    state.frameId = entry.frameId;
    state.variantId = entry.variantId;
    activeArtifactId = entry.artifactId;
    stage.dispatch({ type: 'set-active', artifactId: entry.artifactId });
    render();
    if (reveal) centerEntry(entry);
    if (save) {
      persist();
      recordLocation();
    }
    return true;
  }

  function fit({ save = true, selection = null } = {}) {
    state.inspectionScale = 'fit';
    render();
    if (state.view !== 'canvas') {
      if (save) persist();
      return;
    }
    syncCanvasChrome();
    canvas.fit(selection ? [selection.artifactId, `label:${selection.artifactId}`] : 'all', {
      padding: 36,
      maxZoom: 1,
    });
    saveViewport();
    renderCamera();
    if (save) persist();
  }

  function zoomTo(value, point = null) {
    if (state.view !== 'canvas') return;
    const rect = scroll.getBoundingClientRect();
    canvas.zoomAt(
      value / canvas.getCamera().zoom,
      point ? { x: point.x - rect.left, y: point.y - rect.top } : undefined,
    );
    saveViewport();
    renderCamera();
    persist();
  }

  async function exportArtifact(kind) {
    const artifactId = activeArtifactId;
    try {
      let blob;
      if (kind === 'png') {
        const result =
          typeof options.exportPng === 'function'
            ? await options.exportPng({ artifactId })
            : await stage.getFrame(artifactId)?.__openPlanrBridge?.exportPng('screen');
        const dataUrl = typeof result === 'string' ? result : result?.dataUrl;
        if (!dataUrl?.startsWith('data:image/png;base64,'))
          throw new Error(
            'PNG capture is unavailable. Open the local review with the artifact bridge and retry.',
          );
        const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (character) =>
          character.charCodeAt(0),
        );
        blob = new Blob([bytes], { type: 'image/png' });
      } else {
        const result =
          typeof options.exportHtml === 'function'
            ? await options.exportHtml({ artifactId })
            : null;
        if (result instanceof Blob) blob = result;
        else if (typeof result === 'string')
          blob = new Blob([result], { type: 'text/html;charset=utf-8' });
        else
          throw new Error(
            'Portable export is unavailable in this viewer. Use the design export utility from the project.',
          );
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${design.id}-${state.screenId}.${kind === 'png' ? 'png' : 'html'}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      q('.design-export').open = false;
      notice(kind === 'png' ? 'Screen PNG exported.' : 'Portable HTML exported.');
    } catch (error) {
      notice(error.message, true);
    }
  }

  function editable(target) {
    return Boolean(target?.closest?.('input,textarea,select,[contenteditable="true"]'));
  }

  function installEvents() {
    listen(scroll, 'focusin', (event) => {
      // Notes describe a board without navigating to it.
      if (event.target.closest('[data-design-note]')) event.stopImmediatePropagation();
    });
    listen(scroll, 'keydown', (event) => {
      if (state.view !== 'canvas') return;
      if (['Escape', ' ', 'Enter', 'Home', 'End'].includes(event.key) || event.code === 'Space') {
        event.stopImmediatePropagation();
        if (
          event.key !== 'Escape' ||
          event.defaultPrevented ||
          event.isComposing ||
          editable(event.target) ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        const menu = q('.planr-more-menu:not([hidden])');
        if (menu) {
          q('[data-planr-action="more"]')?.click();
          return;
        }
        if (!root.dispatchEvent(new CustomEvent('planr:design-escape', { cancelable: true })))
          return;
        if (stage.getState().railOpen) {
          stage.dispatch({ type: 'set-rail-open', railOpen: false });
          q('[data-planr-action="feedback"]')?.focus();
        }
        return;
      }
      if (canvas.handleKey(event)) event.stopPropagation();
    });
    listen(scroll, 'gotpointercapture', (event) => {
      if (canvasAttached && gesture?.pointerId !== event.pointerId)
        canvasPointers.add(event.pointerId);
    });
    listen(root, 'planr:design-camera', scheduleViewContext);
    listen(root, 'planr:design-inspection-change', (event) => {
      const { screenId, frameId, variantId, planrId } = event.detail;
      if (screenId !== state.screenId || frameId !== state.frameId || variantId !== state.variantId)
        return;
      inspectedSelection = { artifactId: activeArtifactId, planrId };
      scheduleViewContext();
    });
    listen(window, 'message', (event) => {
      if (
        event.origin !== 'null' ||
        !['openplanr:design-size', 'openplanr:design-size-error'].includes(event.data?.type)
      )
        return;
      const entry = entries.find(
        ({ artifactId }) => stage.getFrame(artifactId)?.contentWindow === event.source,
      );
      if (!entry) return;
      const frame = design.frames.find(({ id }) => id === entry.frameId);
      if (frame.height !== 'auto') return;
      if (event.data.type === 'openplanr:design-size-error') {
        notice(`Could not measure ${entry.screenId}: ${event.data.message}`, true);
        return;
      }
      const { screenId, width, height } = event.data;
      if (
        screenId !== entry.screenId ||
        width !== frame.width ||
        !Number.isInteger(height) ||
        height < 1 ||
        height > 16384
      )
        return;
      const viewport = viewportFor(entry);
      if (viewport.height === height) return;
      // The stage and bridge share this live viewport; the immutable render envelope keeps its initial size.
      viewport.height = height;
      panels.get(entry.artifactId).style.setProperty('--planr-artifact-height', `${height}px`);
      render();
    });
    listen(root, 'planr:artifact-viewport-zoom', (event) => {
      if (state.view !== 'canvas') return;
      const entry = entries.find((item) => stage.getFrame(item.artifactId) === event.target);
      if (!entry || panels.get(entry.artifactId)?.hidden) return;
      const { x, y, deltaY } = event.detail;
      const frame = design.frames.find((item) => item.id === entry.frameId);
      const rect = event.target.getBoundingClientRect();
      chrome?.update({ exportMenuOpen: false });
      zoomTo(
        canvas.getCamera().zoom * clamp(Math.exp(-deltaY * 0.01), 0.8, 1.25),
        {
          x: rect.left + (x * rect.width) / frame.width,
          y: rect.top + (y * rect.height) / viewportFor(entry).height,
        },
        { scheduled: true },
      );
    });
    listen(root, 'planr:artifact-viewport-pan', (event) => {
      if (state.view !== 'canvas') return;
      const entry = entries.find((item) => stage.getFrame(item.artifactId) === event.target);
      if (!entry || panels.get(entry.artifactId)?.hidden) return;
      chrome?.update({ exportMenuOpen: false });
      canvas.panBy(event.detail.deltaX, event.detail.deltaY);
      saveViewport();
      scheduleCamera();
      persist();
    });
    // Handle explicit choices even when the generic stage's reviewMode has not
    // changed (Pan and Inspect both suspend the stage in interact mode).
    listen(
      root,
      'click',
      (event) => {
        const button = event.target.closest('[data-planr-mode],[data-planr-action="add-comment"]');
        if (!button || button.disabled) return;
        setTool(button.dataset.planrMode === 'interact' ? 'interact' : 'annotate');
      },
      true,
    );
    listen(
      document,
      'keydown',
      (event) => {
        if (
          editable(event.target) ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          document.querySelector('dialog[open],[role=dialog][data-state=open]')
        )
          return;
        const key = event.key.toLowerCase();
        if (['i', 'c', 'h'].includes(key)) {
          if (key === 'h' && state.view !== 'canvas') return;
          event.preventDefault();
          setTool({ i: 'interact', c: 'annotate', h: 'pan' }[key]);
        } else if (
          event.key === 'Escape' &&
          (panEnabled || spacePan || gesture || activeTool === 'inspect') &&
          !q('[data-design-notes][open]') &&
          !q('[data-planr-annotation-composer]')
        ) {
          event.preventDefault();
          setTool('interact');
          event.stopPropagation();
          q('[data-planr-mode="interact"]').focus();
        }
      },
      true,
    );
    // Sidebar transitions resize the stage without a window resize. Refit only
    // the focused views; the free canvas retains its personal camera position.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (state.view !== 'canvas' && root.dataset.designRestoring !== 'true')
          fit({ save: false });
        syncCanvasChrome();
        updateDesignNotes();
        scheduleViewContext();
      });
      for (const selector of ['.design-toolbar', '.design-navigator', '.planr-review-rail'])
        observer.observe(q(selector));
      observer.observe(scroll);
      cleanup.push(() => observer.disconnect());
    }
    const notes = q('[data-design-notes]');
    listen(notes?.querySelector(':scope > summary'), 'click', (event) => {
      event.preventDefault();
      if (notes.open) closeDesignNotes();
      else {
        notesReturnFocus = event.currentTarget;
        notes.open = true;
        updateDesignNotes();
      }
    });
    listen(notes, 'toggle', updateDesignNotes);
    listen(
      document,
      'pointerdown',
      (event) => {
        if (
          notes?.open &&
          !notes.contains(event.target) &&
          !event.target.closest?.('[data-design-note]')
        )
          closeDesignNotes();
      },
      true,
    );
    listen(
      document,
      'keydown',
      (event) => {
        if (event.key === 'Escape' && notes?.open) {
          event.preventDefault();
          event.stopPropagation();
          closeDesignNotes({ restoreFocus: true });
        }
      },
      true,
    );
    listen(root, 'click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.designLoadFrame) {
        selectEntry(
          entries.find((item) => item.artifactId === button.dataset.designLoadFrame),
          { reveal: true },
        );
      } else if (button.hasAttribute('data-design-actual-size')) {
        state.inspectionScale = 'actual';
        render();
        persist();
      } else if (button.hasAttribute('data-design-focus')) {
        state.navOpen = false;
        state.reviewOpen = false;
        stage.dispatch({ type: 'set-rail-open', railOpen: false });
        if (state.view === 'canvas') switchView('prototype');
        render();
        persist();
      } else if (button.dataset.designView) {
        switchView(button.dataset.designView);
      } else if (button.hasAttribute('data-design-toggle-nav')) {
        state.navOpen = !state.navOpen;
        if (!state.navOpen && button.closest('.design-navigator'))
          q('.design-toolbar [data-design-toggle-nav]').focus();
        render();
        persist();
      } else if (button.dataset.designScreen) {
        selectEntry(requestedEntry({ screenId: button.dataset.designScreen }), {
          reveal: state.view === 'canvas',
        });
      } else if (button.dataset.designNote) {
        openDesignNote(button.dataset.designNote, button);
      } else if (button.hasAttribute('data-design-close-notes')) {
        closeDesignNotes({ restoreFocus: true });
      } else if (button.hasAttribute('data-design-fit')) fit();
      else if (button.dataset.designZoom)
        zoomTo(
          button.dataset.designZoom === 'reset'
            ? 1
            : state.zoom * (button.dataset.designZoom === 'in' ? 1.2 : 1 / 1.2),
        );
      else if (button.hasAttribute('data-design-pan')) {
        if (state.view !== 'canvas') return;
        setTool(activeTool === 'pan' ? 'interact' : 'pan');
      } else if (button.dataset.designStepChange) {
        const index = clamp(
          design.screenOrder.indexOf(requestedScreen()) + Number(button.dataset.designStepChange),
          0,
          design.screenOrder.length - 1,
        );
        selectEntry(requestedEntry({ screenId: design.screenOrder[index] }));
      } else if (button.dataset.designRating) {
        const rating = Number(button.dataset.designRating);
        state.ratings[state.variantId] = rating;
        if (rating <= 2)
          state.preferences.rejected = [
            ...new Set([...state.preferences.rejected, state.variantId]),
          ];
        else
          state.preferences.rejected = state.preferences.rejected.filter(
            (id) => id !== state.variantId,
          );
        render();
        persist({ content: true });
      } else if (button.hasAttribute('data-design-select-direction')) {
        state.selectedVariant = state.variantId;
        state.preferences.selected = [...new Set([...state.preferences.selected, state.variantId])];
        state.preferences.rejected = state.preferences.rejected.filter(
          (id) => id !== state.variantId,
        );
        render();
        persist({ content: true });
      } else if (button.hasAttribute('data-design-save-remix')) {
        state.remix[state.variantId] = q('[data-design-remix]').value.trim();
        persist({ content: true });
        notice('Refinement note saved for the next design iteration.');
      } else if (button.dataset.designExport) void exportArtifact(button.dataset.designExport);
    });
    listen(q('[data-design-variant]'), 'change', (event) =>
      selectEntry(requestedEntry({ variantId: event.target.value })),
    );
    listen(q('[data-design-frame]'), 'change', (event) => {
      selectEntry(requestedEntry({ frameId: event.target.value }), {
        reveal: state.view === 'canvas',
      });
    });
    listen(q('[data-design-compare]'), 'change', (event) => {
      state.compare = event.target.checked;
      render();
      persist();
    });
    listen(root, 'planr:stage-change', (event) => {
      const next = event.detail;
      if (!changingTool && next.reviewMode !== previousReviewMode)
        setTool(next.reviewMode === 'comment' ? 'annotate' : 'interact');
      const reviewChanged =
        typeof next.railOpen === 'boolean' && next.railOpen !== state.reviewOpen;
      if (reviewChanged) state.reviewOpen = next.railOpen;
      const entry = entries.find(({ artifactId }) => artifactId === next.activeArtifactId);
      if (entry && entry.artifactId !== activeArtifactId) {
        if (stage.frameBudget && !stage.getLoadedArtifactIds().includes(entry.artifactId)) {
          selectEntry(entry, { save: false });
        } else {
          finishWalkthroughTransition();
          activeArtifactId = entry.artifactId;
          state.screenId = entry.screenId;
          state.frameId = entry.frameId;
          state.variantId = entry.variantId;
        }
      }
      if (next.zoom !== previousStageZoom) {
        state.zoom = clamp(next.zoom / 100, 0.05, 2);
        if (canvasAttached) applyCanvasCamera();
        previousStageZoom = next.zoom;
        saveViewport();
      }
      render();
      if (reviewChanged) persist();
    });
    listen(root, 'planr:artifact-review-change', (event) => {
      latestReview = clone(event.detail);
      reviewDirty = true;
      scheduleViewContext();
      reviewSerial += 1;
      status('Saving comments', 'saving');
      storeReviewDraft();
      clearTimeout(reviewTimer);
      reviewTimer = setTimeout(flushReview, 180);
    });
    // Capturing activation lets the artifact-owned pin controller annotate any
    // artboard in the canvas while preserving its active-artifact invariant.
    listen(
      root,
      'pointerdown',
      (event) => {
        const panel = event.target.closest('.planr-artifact-panel');
        if (
          event.button === 0 &&
          panel &&
          !panEnabled &&
          !spacePan &&
          !event.target.closest('[data-design-note]')
        ) {
          selectEntry(
            entries.find(({ artifactId }) => artifactId === panel.dataset.artifactId),
            { save: false },
          );
        }
      },
      true,
    );
    listen(scroll, 'pointerdown', (event) => {
      if (state.view !== 'canvas') return;
      if (root.dataset.designInspect === 'true') return;
      if (event.button !== 0 && event.button !== 1) return;
      const label = event.target.closest('[data-design-drag]');
      const dragging =
        event.button === 0 && state.view === 'canvas' && label && !panEnabled && !spacePan;
      if (!dragging) return;
      event.preventDefault();
      const panel = label?.closest('.planr-artifact-panel');
      const entry = entries.find((item) => item.artifactId === panel.dataset.artifactId);
      const bounds = placedBoardBounds(entry);
      if (!bounds) return;
      gesture = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        mode: 'artboard',
        artifactId: panel.dataset.artifactId,
        left: bounds.x,
        top: bounds.y,
        before: clone(layout),
      };
      scroll.setPointerCapture?.(event.pointerId);
      updatePan();
    });
    listen(scroll, 'pointermove', (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      const entry = entries.find((item) => item.artifactId === gesture.artifactId);
      const key = boardKey(entry);
      const point = {
        x: Math.round(clamp(gesture.left + dx / state.zoom, -1e7, 1e7)),
        y: Math.round(clamp(gesture.top + dy / state.zoom, -1e7, 1e7)),
      };
      layout.boards = { ...layout.boards, [key]: { ...layout.boards?.[key], ...point } };
      const panel = panels.get(gesture.artifactId);
      layoutDragDirty = point.x !== gesture.left || point.y !== gesture.top;
      panel.style.left = `${point.x}px`;
      panel.style.top = `${point.y}px`;
      syncCanvasNodes();
      scheduleCamera();
    });
    for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture'])
      listen(scroll, eventName, (event) => {
        canvasPointers.delete(event.pointerId);
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (eventName === 'pointerup') finishGesture();
        else releaseTemporaryPan();
      });
    listen(
      document,
      'keydown',
      (event) => {
        if (editable(event.target)) return;
        if (
          state.view === 'canvas' &&
          event.code === 'Space' &&
          !event.defaultPrevented &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !document.querySelector('dialog[open],[role=dialog][data-state=open]') &&
          !event.target.closest('button,[data-planr-annotation-layer]')
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          const previous = activeTool;
          setTool('pan');
          panEnabled = false;
          spacePan = true;
          spaceReturnTool = previous;
          updatePan();
        }
      },
      true,
    );
    listen(document, 'keydown', (event) => {
      if (editable(event.target)) return;
      if (
        state.view === 'canvas' &&
        !event.defaultPrevented &&
        !event.altKey &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'z' &&
        !document.querySelector('dialog[open],[role=dialog][data-state=open]')
      ) {
        event.preventDefault();
        restoreMove(event.shiftKey);
        return;
      }
      const label = event.target.closest('[data-design-drag]');
      if (
        label &&
        state.view === 'canvas' &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        event.preventDefault();
        const panel = label.closest('.planr-artifact-panel');
        const distance = event.shiftKey ? 40 : 8;
        const entry = entries.find((item) => item.artifactId === panel.dataset.artifactId);
        const bounds = placedBoardBounds(entry);
        if (!bounds) return;
        const key = boardKey(entry);
        const before = clone(layout);
        const point = {
          x: Math.round(
            clamp(
              bounds.x +
                (event.key === 'ArrowRight' ? distance : event.key === 'ArrowLeft' ? -distance : 0),
              -1e7,
              1e7,
            ),
          ),
          y: Math.round(
            clamp(
              bounds.y +
                (event.key === 'ArrowDown' ? distance : event.key === 'ArrowUp' ? -distance : 0),
              -1e7,
              1e7,
            ),
          ),
        };
        layout.boards = { ...layout.boards, [key]: { ...layout.boards?.[key], ...point } };
        render();
        completeMove(entry, before);
      } else if (
        state.view === 'walkthrough' &&
        ['ArrowLeft', 'ArrowRight'].includes(event.key) &&
        !event.target.closest('button,[role="radio"]')
      ) {
        event.preventDefault();
        const index = clamp(
          design.screenOrder.indexOf(requestedScreen()) + (event.key === 'ArrowRight' ? 1 : -1),
          0,
          design.screenOrder.length - 1,
        );
        selectEntry(requestedEntry({ screenId: design.screenOrder[index] }));
      }
    });
    listen(document, 'keyup', (event) => {
      if (event.code === 'Space') {
        releaseTemporaryPan();
      }
    });
    listen(window, 'blur', () => {
      releaseTemporaryPan();
      // Pointer events inside sandboxed product frames do not bubble to the studio.
      if (document.activeElement?.tagName === 'IFRAME') closeDesignNotes();
    });
    listen(document, 'visibilitychange', () => {
      if (document.hidden) {
        releaseTemporaryPan();
        finishWalkthroughTransition();
      }
    });
    listen(window.matchMedia?.('(prefers-reduced-motion: reduce)'), 'change', () =>
      finishWalkthroughTransition(),
    );
    listen(window, 'resize', () => {
      const compact = window.innerWidth <= 960;
      if (compact && !compactViewport) {
        state.navOpen = false;
        state.reviewOpen = false;
        stage.dispatch({ type: 'set-rail-open', railOpen: false });
        persist();
      }
      compactViewport = compact;
      render();
      if (state.view !== 'canvas' && root.dataset.designRestoring !== 'true') fit({ save: false });
      updateDesignNotes();
    });
    listen(window, 'online', () => {
      if (dirty || reviewDirty || layoutOperations.length) void flush();
      viewContextSignature = null;
      scheduleViewContext();
    });
    listen(window, 'beforeunload', (event) => {
      // A canceled navigation keeps ready frames; only retire background demand.
      clearTimeout(frameDemandTimer);
      frameDemandGeneration += 1;
      frameDemandKey = '';
      storeDraft();
      storeReviewDraft();
      if (
        (contentDirty || reviewDirty || layoutOperations.length) &&
        (options.stateUrl ||
          options.saveState ||
          options.layoutUrl ||
          options.saveLayout ||
          reviewUrl())
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    listen(window, 'message', (event) => {
      // Authored navigation is accepted only from one of this studio's exact
      // sandbox windows, then resolved against the declared screen identities.
      if (
        event.origin !== 'null' ||
        !['openplanr:design-navigate', 'navigate'].includes(event.data?.type) ||
        typeof event.data.screenId !== 'string'
      )
        return;
      const source = entries.find(
        ({ artifactId }) => stage.getFrame(artifactId)?.contentWindow === event.source,
      );
      if (!source || !design.screenOrder.includes(event.data.screenId)) return;
      const nonce = stage.getFrame(source.artifactId)?.__openPlanrBridge?.getPrototypeNonce?.();
      if (!nonce) return;
      if (
        event.data.type === 'navigate' &&
        (event.data.channel !== nonce ||
          event.data.viewId !== source.artifactId ||
          event.data.schemaVersion !== '1.0.0')
      )
        return;
      if (
        state.view !== 'canvas' &&
        (source.artifactId !== activeArtifactId || walkthroughTransition)
      )
        return;
      chrome?.update({ exportMenuOpen: false });
      selectEntry(entryFor(event.data.screenId, source.variantId, source.frameId));
    });
  }

  async function refreshSavedState() {
    if (!options.stateUrl) return;
    try {
      const observedRevision = revision;
      const result = await jsonRequest(options.stateUrl);
      if (destroyed) return;
      if (
        observedRevision === revision &&
        result.revision !== undefined &&
        result.revision !== revision
      )
        await rebaseLayout({ announce: false, expectedRevision: observedRevision });
      if (result.stateVersion !== undefined) stateVersion = result.stateVersion;
      legacyServerPositions = result.state?.positions ?? legacyServerPositions;
      if (result.state && !dirty) {
        state = normalizeState({ ...result.state, ...linkedState() });
        if (canvasAttached && state.view === 'canvas') applyCanvasCamera();
        if (compactViewport) {
          state.navOpen = false;
          state.reviewOpen = false;
        }
        stage.dispatch({ type: 'set-rail-open', railOpen: state.reviewOpen });
      }
      if (savedDraft?.unsaved)
        notice(
          'A previous unsaved draft is available in this browser. The saved review is shown; your draft has not overwritten it.',
          true,
        );
      selectEntry(entryFor(), { save: false });
      if (!layoutOperations.length) status('All changes saved');
    } catch {
      status('Disconnected · local draft', 'disconnected');
    }
  }

  async function pollRevision() {
    if (!options.statusUrl || destroyed) return;
    try {
      const observedRevision = revision;
      const result = await jsonRequest(options.statusUrl);
      if (destroyed) return;
      if (typeof result.verification === 'string')
        q('[data-design-verification]').textContent =
          result.verification === 'verified'
            ? 'Browser inspection complete'
            : 'Browser inspection pending';
      if (
        observedRevision === revision &&
        result.revision !== undefined &&
        revision !== null &&
        result.revision !== revision
      ) {
        if (contentDirty || reviewDirty || layoutOperations.length || layoutSaving)
          newRevisionNotice();
        else {
          storeDraft();
          window.location.reload();
          return;
        }
      }
      if (result.status === 'failed')
        notice(
          result.message ?? 'The new revision failed. This working design remains available.',
          true,
        );
    } catch {
      if (!dirty) status('Disconnected', 'disconnected');
    }
    pollTimer = setTimeout(pollRevision, 4000);
  }

  async function reportReady() {
    if (readyReported || readyReporting || destroyed) return;
    readyReporting = true;
    try {
      const requiredEntries = [entryFor()];
      await stage.ensureFrames(requiredEntries.map((entry) => entry.artifactId));
      if (destroyed) return;
      const loaded = requiredEntries.filter(({ artifactId }) => {
        const frame = stage.getFrame(artifactId);
        return (
          (frame?.src?.startsWith('blob:') || Boolean(frame?.srcdoc)) &&
          frame.dataset.planrFrameState === 'ready' &&
          frame.dataset.planrArtifactDigest &&
          (!frame.__openPlanrBridge || frame.dataset.planrBridgeTrusted === 'true')
        );
      });
      if (loaded.length !== requiredEntries.length) throw new Error('Preview bridge is not ready.');
      readyReported = true;
      render();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (destroyed) return;
      root.dataset.designReady = 'true';
      if (!root.dataset.sharedOpening) delete document.documentElement.dataset.designOpening;
      chrome?.update({ previewLabel: 'Preview ready' });
      if (!chrome) q('[data-design-preview-state]').textContent = 'Preview ready';
      if (
        !contentDirty &&
        !reviewDirty &&
        !layoutOperations.length &&
        (!options.stateUrl || stateVersion !== null)
      )
        status(options.stateUrl ? 'All changes saved' : 'Local preview');
      const detail = {
        revision,
        status: 'ready',
        artifacts: loaded.map((entry) => entry.artifactId),
      };
      root.dispatchEvent(new CustomEvent('planr:design-ready', { bubbles: true, detail }));
      if (typeof options.onReady === 'function') await options.onReady(detail);
      if (options.readyUrl) {
        try {
          await jsonRequest(options.readyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(detail),
          });
        } catch {
          status('Server disconnected · local draft', 'disconnected');
        }
      }
    } catch {
      if (destroyed) return;
      delete document.documentElement.dataset.designOpening;
      chrome?.update({ previewLabel: 'Preview unavailable' });
      if (!chrome) q('[data-design-preview-state]').textContent = 'Preview unavailable';
      notice(
        'This preview could not load. Use Retry screen; your saved feedback remains available.',
        true,
      );
    } finally {
      readyReporting = false;
    }
  }

  function mount() {
    stage = artifactStage;
    if (!stage) {
      status('Review runtime unavailable', 'failed');
      return null;
    }
    root = q('.planr-shell');
    const structuralStyle = document.createElement('style');
    structuralStyle.textContent = canvasStyles;
    document.head.prepend(structuralStyle);
    cleanup.push(() => structuralStyle.remove());
    cleanup.push(
      canvas.on('camera', () => {
        if (!canvasAttached || state.view !== 'canvas') return;
        const previous = state.viewports.canvas;
        saveViewport();
        renderCamera();
        const next = state.viewports.canvas;
        if (previous?.x !== next.x || previous?.y !== next.y || previous?.zoom !== next.zoom)
          persist();
      }),
    );
    chrome = mountDesignChrome({ root, title: design.title, state });
    if (chrome) cleanup.push(() => chrome.destroy());
    previousReviewMode = stage.getState().reviewMode;
    activeTool = previousReviewMode === 'comment' ? 'annotate' : 'interact';
    scroll = q('.planr-stage-scroll');
    surface = q('.planr-stage-surface');
    grid = q('.planr-frame-grid');
    canvasBackground = document.createElement('div');
    canvasBackground.className = 'design-canvas-background';
    canvasBackground.setAttribute('aria-hidden', 'true');
    scroll.prepend(canvasBackground);
    selectionOutline = document.createElement('div');
    selectionOutline.className = 'design-selection-outline';
    selectionOutline.setAttribute('aria-hidden', 'true');
    selectionOutline.hidden = true;
    scroll.append(selectionOutline);
    for (const section of layout.sections ?? []) {
      const heading = document.createElement('div');
      heading.className = 'design-section-heading';
      heading.setAttribute('role', 'heading');
      heading.setAttribute('aria-level', '2');
      heading.textContent = section.text;
      heading.style.left = `${section.x}px`;
      heading.style.top = `${section.y}px`;
      if (section.maxW) heading.style.maxWidth = `${section.maxW}px`;
      grid.append(heading);
      sectionHeadings.push(heading);
    }
    for (const entry of entries) {
      const panel = stage.getPanel(entry.artifactId);
      if (!panel) {
        status('Missing design preview', 'failed');
        return null;
      }
      panels.set(entry.artifactId, panel);
      const nodeId = panel.getAttribute('data-canvas-node-id');
      panel.dataset.canvasNodeId = entry.artifactId;
      cleanup.push(() => {
        if (nodeId === null) panel.removeAttribute('data-canvas-node-id');
        else panel.setAttribute('data-canvas-node-id', nodeId);
      });
      const screen = design.screens.find(({ id }) => id === entry.screenId);
      const variant = design.variants.find(({ id }) => id === entry.variantId);
      const frame = design.frames.find(({ id }) => id === entry.frameId);
      if (frame.height === 'auto') {
        const iframe = stage.getFrame(entry.artifactId);
        const measure = () =>
          iframe.contentWindow?.postMessage({ type: 'openplanr:design-measure' }, '*');
        listen(iframe, 'planr:artifact-bridge-ready', measure);
        listen(iframe, 'load', measure);
        measure();
      }
      const label = document.createElement('div');
      label.className = 'design-artboard-label';
      label.setAttribute('role', 'group');
      const drag = document.createElement('button');
      drag.type = 'button';
      drag.className = 'design-artboard-drag';
      drag.dataset.designDrag = entry.artifactId;
      drag.setAttribute(
        'aria-label',
        `Move ${screen.title}, ${variant.label}, ${frame.label}. Use arrow keys to arrange.`,
      );
      const title = document.createElement('strong');
      title.textContent = `${screen.title}${readyVariants.length > 1 ? ` / ${variant.label}` : ''}`;
      const size = document.createElement('span');
      size.textContent = `${frame.label} · ${frame.width} × ${frame.height}`;
      drag.append(title, size);
      label.append(drag);
      if (screen.description) {
        const note = document.createElement('button');
        note.type = 'button';
        note.className = 'design-artboard-note';
        note.dataset.designNote = screen.id;
        note.setAttribute('aria-controls', 'design-guidance-panel');
        note.setAttribute('aria-expanded', 'false');
        note.title = screen.description;
        note.setAttribute('aria-label', `Open design notes for ${screen.title}`);
        note.textContent = 'i';
        label.append(note);
      }
      panel.prepend(label);
      if (stage.frameBudget) {
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'design-frame-placeholder';
        load.dataset.designLoadFrame = entry.artifactId;
        load.setAttribute('aria-label', `Open screen: ${screen.title}, ${frame.label}`);
        load.textContent = 'Open screen';
        panel.querySelector('.planr-frame').append(load);
      }
    }
    const verified = payload.verification?.status === 'verified';
    q('[data-design-verification]').textContent = verified
      ? 'Browser inspection complete'
      : 'Browser inspection pending';
    const prototypeState = createPrototypeStateRelay({
      contextId: `${design.id}:${payload.revision ?? payload.reviewOf ?? 'local'}`,
      parentWindow: window,
      frames: () =>
        entries.map((entry) => ({
          screenId: entry.screenId,
          viewId: entry.artifactId,
          window: stage.getFrame(entry.artifactId)?.contentWindow ?? null,
          nonce: stage.getFrame(entry.artifactId)?.__openPlanrBridge?.getPrototypeNonce?.() ?? null,
          generation: stage
            .getFrame(entry.artifactId)
            ?.__openPlanrBridge?.getPrototypeGeneration?.(),
          aliases: options.prototypeStateAliases?.[entry.screenId],
        })),
    });
    cleanup.push(() => prototypeState.dispose());
    installEvents();
    listen(q('[data-design-dismiss-notice]'), 'click', () => {
      if (activeNotice?.persistent) dismissedNotices.set(activeNotice.key, activeNotice.message);
      hideNotice();
    });
    function previewHealth() {
      for (const entry of entries) {
        const frame = stage.getFrame(entry.artifactId);
        const nonce = frame?.__openPlanrBridge?.getPrototypeNonce?.() ?? null;
        if (nonce)
          prototypeState.restore({
            screenId: entry.screenId,
            viewId: entry.artifactId,
            window: frame.contentWindow,
            nonce,
            generation: frame.__openPlanrBridge?.getPrototypeGeneration?.(),
            aliases: options.prototypeStateAliases?.[entry.screenId],
          });
      }
      const selected = stage
        .getFrameDiagnostics?.()
        .find((item) => item.artifactId === activeArtifactId);
      const node = q('[data-design-preview-state]');
      const phase = selected?.status ?? stage.getState().status;
      const previewLabel =
        phase === 'ready'
          ? 'Preview ready'
          : phase === 'error' || phase === 'invalid'
            ? 'Preview unavailable'
            : 'Loading preview';
      if (chrome) chrome.update({ previewLabel });
      else node.textContent = previewLabel;
      node.dataset.status = phase;
      if (selected)
        node.title = `${selected.phase} · ${Math.round(selected.elapsedMs ?? 0)} ms${selected.code ? ` · ${selected.code}` : ''}`;
      if (!readyReported && phase === 'ready') void reportReady();
    }
    listen(root, 'planr:artifact-frame-state', previewHealth);
    listen(root, 'planr:artifact-state', previewHealth);
    previewHealth();
    const search = q('[data-design-screen-search]'),
      group = q('[data-design-screen-group]');
    function filterScreens() {
      const term = search.value.trim().toLocaleLowerCase();
      const flow = design.flows?.find((item) => item.id === group?.value);
      let count = 0;
      for (const button of qa('[data-design-screen]')) {
        button.hidden = !(
          button.textContent.toLocaleLowerCase().includes(term) &&
          (!flow || flow.screens.includes(button.dataset.designScreen))
        );
        if (!button.hidden) count++;
      }
      q('[data-design-search-empty]').hidden = count > 0;
    }
    listen(search, 'input', filterScreens);
    listen(group, 'change', filterScreens);
    function followLocation() {
      const next = normalizeState({ ...state, ...linkedState() });
      if (next.view !== state.view) switchView(next.view, { save: false });
      selectEntry(entryFor(next.screenId, next.variantId, next.frameId), { save: false });
    }
    listen(window, 'popstate', followLocation);
    listen(window, 'hashchange', followLocation);
    if (stage.frameBudget) {
      listen(root, 'planr:artifact-frame-state', updateFramePlaceholders);
      updateFramePlaceholders();
    }
    compactViewport = window.innerWidth <= 960;
    if (compactViewport) {
      state.navOpen = false;
      state.reviewOpen = false;
      stage.dispatch({ type: 'set-rail-open', railOpen: false });
    } else stage.dispatch({ type: 'set-rail-open', railOpen: state.reviewOpen });
    selectEntry(entryFor(), { save: false });
    if (!reviewUrl() && !stage.review.getState().review) {
      try {
        const storedReview = JSON.parse(localStorage.getItem(`${storageKey}.review`) ?? 'null');
        if (storedReview?.review) stage.review.replaceReview(storedReview.review);
      } catch {
        /* A different render digest must not inherit coordinate pins. */
      }
    }
    const panelDialogs = mountDesignPanels({
      root,
      closePanel(side) {
        if (side === 'left') state.navOpen = false;
        else {
          state.reviewOpen = false;
          stage.dispatch({ type: 'set-rail-open', railOpen: false });
        }
        render();
        persist();
        q(
          side === 'left'
            ? '.design-toolbar [data-design-toggle-nav]'
            : '.design-toolbar [data-planr-action=feedback]',
        )?.focus();
      },
    });
    cleanup.push(() => panelDialogs.destroy());
    const controller = Object.freeze({
      setTool,
      getTool: () => activeTool,
      getState: () => {
        readCanvasCamera();
        return clone(state);
      },
      getLayout: () => clone(layout),
      getViewport: (artifactId) => ({
        ...viewportFor(entries.find((entry) => entry.artifactId === artifactId)),
      }),
      getRevision: () => revision,
      getSaveState: () => ({
        dirty: contentDirty || reviewDirty || layoutOperations.length > 0,
        personalPending: dirty && !contentDirty,
        commentsPending: reviewDirty,
        revision,
        stateVersion,
      }),
      selectScreen: (screenId) => selectEntry(requestedEntry({ screenId })),
      selectEntry: (entry) => selectEntry(entry),
      fitSelection: ({ save = true } = {}) => fit({ selection: entryFor(), save }),
      setCamera(camera) {
        if (state.view !== 'canvas') return;
        if (!Number.isFinite(camera?.x) || !Number.isFinite(camera?.y)) return;
        state.camera = { x: clamp(camera.x, -1e7, 1e7), y: clamp(camera.y, -1e7, 1e7) };
        if (Number.isFinite(camera.zoom)) state.zoom = clamp(camera.zoom, 0.05, 2);
        applyCanvasCamera();
        saveViewport();
        renderCamera();
        persist();
      },
      setPanels({ navOpen = state.navOpen, reviewOpen = state.reviewOpen }, { save = true } = {}) {
        state.navOpen = Boolean(navOpen);
        state.reviewOpen = Boolean(reviewOpen);
        stage.dispatch({ type: 'set-rail-open', railOpen: state.reviewOpen });
        render();
        if (save) persist();
      },
      restorePresentation(snapshot) {
        finishWalkthroughTransition();
        const personal = {};
        for (const key of [
          'view',
          'screenId',
          'frameId',
          'variantId',
          'compare',
          'navOpen',
          'reviewOpen',
          'inspectionScale',
          'zoom',
          'camera',
          'viewports',
        ])
          if (snapshot[key] !== undefined) personal[key] = clone(snapshot[key]);
        state = normalizeState({ ...state, ...personal });
        if (canvasAttached && state.view === 'canvas') applyCanvasCamera();
        stage.dispatch({ type: 'set-rail-open', railOpen: state.reviewOpen });
        selectEntry(entryFor(), { save: false });
        render();
        persist();
      },
      setView(view) {
        switchView(view);
      },
      fit,
      flush,
      exportArtifact,
      destroy() {
        if (destroyed) return;
        finishWalkthroughTransition();
        root.dispatchEvent(new CustomEvent('planr:design-destroy'));
        for (const { artifactId } of entries)
          stage.getFrame(artifactId)?.__openPlanrBridge?.setViewportGestures?.(false);
        destroyed = true;
        canvasAttached = false;
        canvas.destroy();
        ++screenRequest;
        pendingScreen = null;
        failedSelection = null;
        clearTimeout(frameDemandTimer);
        clearTimeout(saveTimer);
        clearTimeout(reviewTimer);
        clearTimeout(pollTimer);
        clearTimeout(noticeTimer);
        clearTimeout(viewContextTimer);
        if (cameraFrame !== null) cancelAnimationFrame(cameraFrame);
        for (const heading of sectionHeadings) heading.remove();
        canvasBackground?.remove();
        selectionOutline?.remove();
        for (const remove of cleanup.splice(0)) remove();
      },
    });
    void refreshSavedState().then(() => {
      migrateLegacyPositions();
      return reportReady();
    });
    pollTimer = setTimeout(pollRevision, 4000);
    return controller;
  }

  return mount();
}
