// @ts-check
import { appearanceFields, clone, geometryFields, snapshot } from '../diagram/authoring/model.mjs';
import { copyDiagramSelection } from '../diagram/editor/clipboard.mjs';
import {
  addOrthogonalDetour,
  arrangementCommand,
  createObject,
  duplicateSelection,
  freshId,
  placement,
  processTemplate,
  transaction,
} from './diagram-editor-actions.mjs';
import { downloadJson } from './diagram-editor-dom.mjs';

/** @typedef {import('../diagram/editor/index.d.mts').DiagramEditorState} DiagramEditorState */
/** @typedef {import('@openplanr/protocol/diagram-authoring-contracts').DiagramAuthoringBundle} DiagramAuthoringBundle */
/**
 * One dispatched action with the state it was dispatched against.
 * @typedef {object} CommandInput
 * @property {string} action
 * @property {DiagramEditorState} state
 * @property {DiagramAuthoringBundle} bundle
 * @property {string[]} ids
 * @property {unknown} value
 * @property {{ additive?: boolean; fromOutline?: boolean }} options
 */
/** @typedef {(input: CommandInput) => void} CommandHandler */

/** Surfaces that dispatch their own clicks; actions inside them never reach the editor. */
const FOREIGN_ACTION_SCOPE = '.de-host-pane,.de-review-slot,.de-conflict,.de-source-panel';
const ROUTE_ACTIONS = new Set(['add-bend', 'remove-bend', 'reset-route', 'position-label']);

/** @returns {string} */
export const errText = (result) =>
  result?.diagnostics
    ?.map((item) => item.detail)
    .filter(Boolean)
    .join(' ') ||
  result?.message ||
  'The change could not be applied.';
export const safeAction = (fn, report) => {
  try {
    return fn();
  } catch (error) {
    report(error instanceof Error ? error.message : 'The edit is invalid.');
    return null;
  }
};
/** @param {DiagramEditorState} state */
export const bundleOf = (state) => {
  if (!state.bundle) throw new TypeError('The editor has no readable diagram.');
  return state.bundle;
};
/**
 * @param {DiagramAuthoringBundle} bundle
 * @param {string} id
 */
const placementOf = (bundle, id) => {
  const placement = bundle.presentation.elements.find((item) => item.elementId === id);
  if (!placement) throw new TypeError(`Element ${id} has no placement.`);
  return placement;
};
/** @returns {import('./diagram-editor-context.d.mts').DiagramEditorDraftRefusal} */
const draftRefusal = () => ({ ok: false, status: 'property-draft' });
function lockedSelection(bundle, ids, next) {
  const changes = ids
    .map((id) => bundle.presentation.elements.find((item) => item.elementId === id))
    .filter(Boolean)
    .map((item) => {
      const before = appearanceFields(item),
        after = clone(before);
      if (item.bounds) {
        after.locks.position = next;
        after.locks.size = next;
      }
      if (item.route) after.locks.route = next;
      return { elementId: item.elementId, before, after };
    });
  return { type: 'appearance', changes };
}

/**
 * Edit primitives, save, and the action table that every `data-action` control dispatches through.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorCommands}
 */
export function createEditorCommands(ctx) {
  const { doc, session, dom } = ctx;
  const current = ctx.current,
    report = ctx.report,
    notice = ctx.notice;
  let clipboard = null,
    actionTrigger = null;

  const select = (ids, { force = false } = {}) => {
    const next = [...new Set(ids)],
      previous = current().view.selection;
    const changed =
      next.length !== previous.length || next.some((id, index) => id !== previous[index]);
    if (changed && !force && !ctx.inspector.guardDraft()) return draftRefusal();
    const result = session.setView({ selection: next });
    if (!result.ok) report(errText(result));
    else {
      report('');
      notice(
        next.length
          ? next.length + ' object' + (next.length === 1 ? '' : 's') + ' selected.'
          : 'Selection cleared.',
      );
    }
    return result;
  };
  const submit = (command, selectIds) => {
    if (ctx.inspector.dirty()) {
      ctx.inspector.guardDraft();
      return draftRefusal();
    }
    const result = session.submit(command);
    if (!result.ok) {
      report(errText(result));
      return result;
    }
    report('');
    if (selectIds?.length) select(selectIds);
    return result;
  };
  const submitTransaction = (value, { allowDirty = false } = {}) => {
    if (!allowDirty && ctx.inspector.dirty()) {
      ctx.inspector.guardDraft();
      return draftRefusal();
    }
    const result = session.submitTransaction(value);
    if (!result.ok) report(errText(result));
    else report('');
    return result;
  };
  async function save() {
    const state = current();
    if (state.saveState === 'conflict') {
      act('conflict');
      return;
    }
    if (!(await ctx.inspector.applyDraft())) return;
    const result = await session.save();
    if (ctx.isDisposed()) return;
    if (!result.ok) {
      report(errText(result));
      if (result.status === 'conflict' && ctx.host.readCurrent) {
        try {
          const authoritative = await ctx.host.readCurrent();
          const compared = session.refresh(authoritative);
          if (!compared.ok && current().comparison) act('conflict');
        } catch (error) {
          report(
            error instanceof Error
              ? error.message
              : 'Could not read current revision. Pending edits remain.',
          );
        }
      }
    } else {
      report('');
      notice('Diagram saved.');
    }
  }
  function useTool(next, state) {
    ctx.canvas.setTool(next);
    ctx.chrome.render(state, { force: true });
    notice(next === 'select' ? 'Select mode' : 'Pan mode');
  }
  function toggleRail(side, action) {
    const open = ctx.chrome.railOpen(side);
    ctx.chrome.setRail(side, action === 'close' ? false : !open, {
      focusPanel: action === 'toggle' && !open,
    });
  }
  function editRoute({ action, bundle, ids, value }) {
    const id = ids[0],
      place = placementOf(bundle, id),
      before = geometryFields(place),
      after = clone(before);
    const points = session.geometry(id)?.points ?? [];
    if (action === 'reset-route') {
      after.route.mode = 'automatic';
      after.route.points = [];
    }
    if (action === 'add-bend') {
      const bent = safeAction(() => addOrthogonalDetour(points), report);
      if (!bent) return;
      after.route.mode = 'manual';
      after.route.strategy = 'orthogonal';
      after.route.points = bent;
    }
    if (action === 'remove-bend') {
      after.route.points.splice(Number(value) + 1, 1);
      if (
        after.route.points.some(
          (point, index, all) =>
            index > 0 && point.x !== all[index - 1].x && point.y !== all[index - 1].y,
        )
      ) {
        report('This corner joins perpendicular segments. Move adjacent bends or reset the route.');
        return;
      }
      if (after.route.points.length === 2) {
        after.route.mode = 'automatic';
        after.route.points = [];
      }
    }
    if (action === 'position-label') {
      const middle = points[Math.floor(points.length / 2)];
      after.label = { x: middle.x, y: middle.y, width: 140 };
    }
    submit({ type: 'geometry', changes: [{ elementId: id, before, after }] });
  }
  function arrange({ action, bundle, ids }) {
    const command = safeAction(() => arrangementCommand(bundle, ids, action), report);
    if (command) submit(command);
  }

  /**
   * Actions that run even when the session has no readable diagram.
   * @type {Map<string, (input: { state: DiagramEditorState }) => void>}
   */
  const handlersWithoutBundle = new Map([
    [
      'host-action',
      ({ state }) => {
        const entry = ctx.config.actions.find(
          (item) => item.id === actionTrigger?.dataset.hostAction,
        );
        if (entry && !actionTrigger.disabled)
          entry.onSelect({ session, state, trigger: actionTrigger });
      },
    ],
    ['cancel-dialog', ({ state }) => ctx.dialogs.cancel(state)],
  ]);
  /** @type {Map<string, CommandHandler>} */
  const handlers = new Map([
    [
      'toggle-group',
      () => {
        if (actionTrigger?.dataset.id) ctx.outline.toggleGroup(actionTrigger.dataset.id);
      },
    ],
    ['save', () => void save()],
    [
      'undo',
      () => {
        if (!ctx.inspector.guardDraft()) return;
        const result = session.undo();
        if (!result.ok) report(errText(result));
      },
    ],
    [
      'redo',
      () => {
        if (!ctx.inspector.guardDraft()) return;
        const result = session.redo();
        if (!result.ok) report(errText(result));
      },
    ],
    ['outline', () => toggleRail('left', 'toggle')],
    ['close-outline', () => toggleRail('left', 'close')],
    ['properties', () => toggleRail('right', 'toggle')],
    ['close-properties', () => toggleRail('right', 'close')],
    ['close-drawers', () => ctx.chrome.closeDrawers()],
    [
      'outline-tab',
      ({ state }) => {
        ctx.outline.showTab('outline');
        ctx.chrome.render(state, { force: true });
      },
    ],
    [
      'shapes-tab',
      ({ state }) => {
        ctx.outline.showTab('shapes');
        ctx.chrome.render(state, { force: true });
      },
    ],
    ['properties-tab', () => ctx.inspector.showTab(actionTrigger?.dataset.tab ?? 'properties')],
    ['review-tab', () => ctx.inspector.showTab(actionTrigger?.dataset.tab ?? 'review')],
    ['host-panel-tab', () => ctx.inspector.showTab(actionTrigger?.dataset.tab ?? 'properties')],
    ['select-tool', ({ state }) => useTool('select', state)],
    ['pan-tool', ({ state }) => useTool('pan', state)],
    [
      'snap',
      ({ state }) => {
        session.setView({ snap: !state.view.snap });
        notice(state.view.snap ? 'Snap off' : 'Snap on');
      },
    ],
    ['fit', () => ctx.canvas.fit()],
    ['zoom-in', () => ctx.canvas.zoom(1.2)],
    ['zoom-out', () => ctx.canvas.zoom(1 / 1.2)],
    [
      'more',
      () => {
        const open = ctx.chrome.overflowOpen();
        ctx.chrome.setOverflow(!open, { focus: !open });
      },
    ],
    [
      'source-panel',
      ({ state }) => {
        ctx.dialogs.openSourcePanel(ctx.readOnly(state) ? { tab: 'export' } : undefined);
      },
    ],
    [
      'show-source',
      ({ bundle }) =>
        ctx.dialogs.showJson('Source', {
          originalSource: bundle.originalSource,
          sourceMap: bundle.sourceMap,
        }),
    ],
    ['show-revision', ({ bundle }) => ctx.dialogs.showJson('Current revision', snapshot(bundle))],
    [
      'export-json',
      ({ bundle }) => {
        ctx.chrome.setOverflow(false, { restoreFocus: false });
        downloadJson(doc, bundle, bundle.diagramId + '.planr-diagram-bundle.json');
        dom.moreButton.focus({ preventScroll: true });
      },
    ],
    ['conflict', () => ctx.dialogs.compareRevisions()],
    ['layout', () => ctx.dialogs.openLayout()],
    ['lane-horizontal', () => ctx.dialogs.openLayout('horizontal')],
    ['lane-vertical', () => ctx.dialogs.openLayout('vertical')],
    ['preview-layout', ({ state, bundle, ids }) => ctx.dialogs.previewLayout(state, bundle, ids)],
    ['apply-layout', () => ctx.dialogs.applyLayout()],
    ['cancel-layout', () => ctx.dialogs.cancelLayout()],
    [
      'blank',
      ({ state }) => {
        dom.empty.hidden = true;
        ctx.outline.preferTab('shapes');
        ctx.chrome.render(state, { force: true });
      },
    ],
    [
      'template',
      () => {
        const { stage } = dom;
        const at = ctx.canvas.worldPoint({
          x: stage.clientWidth / 2 - 200,
          y: stage.clientHeight / 2,
        });
        const command = processTemplate({ x: Math.round(at.x), y: Math.round(at.y) });
        submit(
          command,
          command.elements
            .filter((item) => item.collection === 'nodes')
            .map((item) => item.value.id),
        );
        ctx.canvas.fit();
      },
    ],
    [
      'create',
      ({ state, bundle, value }) => {
        const { stage } = dom;
        const kind = value,
          at = ctx.canvas.worldPoint({ x: stage.clientWidth / 2, y: stage.clientHeight / 2 });
        const existing = bundle.presentation.elements
          .map((item) => item.bounds)
          .filter((rect) => rect !== null);
        const right = existing.length
          ? Math.max(...existing.map((item) => item.x + item.width))
          : null;
        const y = existing.length
          ? Math.min(...existing.map((item) => item.y))
          : Math.round(at.y - 36);
        const command = createObject(kind, {
          x: right === null ? Math.round(at.x - 80) : Math.round(right + 64),
          y: Math.round(y),
        });
        const result = submit(command, [command.elements[0].value.id]);
        if (result.ok) {
          if (state.view.camera.fit) ctx.canvas.fit();
          stage.focus();
        }
      },
    ],
    ['select-id', selectObject],
    ['select-member', selectObject],
    ['connect', () => ctx.dialogs.openConnect()],
    ['confirm-connect', () => ctx.dialogs.confirmConnect()],
    ['delete', () => ctx.dialogs.openDelete()],
    ['confirm-delete', ({ ids }) => ctx.dialogs.confirmDelete(ids)],
    [
      'update-title',
      ({ bundle, value }) => {
        const before = {
          title: bundle.document.title,
          summary: bundle.document.summary,
          audience: bundle.document.audience,
          accessibility: bundle.document.accessibility,
        };
        const after = clone(before);
        after.title = value;
        after.accessibility.title = value;
        submitTransaction(
          transaction(bundle, [
            { type: 'update-semantics', collection: 'document', before, after },
          ]),
        );
      },
    ],
    [
      'copy',
      ({ bundle, ids }) => {
        const copied = copyDiagramSelection(bundle, ids);
        if (!copied.ok) report(errText(copied));
        else {
          clipboard = copied.value;
          notice('Selection copied.');
        }
      },
    ],
    ['paste', ({ bundle }) => duplicate(bundle, clipboard?.ids ?? [], clipboard)],
    ['duplicate', ({ bundle, ids }) => duplicate(bundle, ids, null)],
    ['lock', ({ bundle, ids }) => void submit(lockedSelection(bundle, ids, true))],
    ['unlock', ({ bundle, ids }) => void submit(lockedSelection(bundle, ids, false))],
    [
      'group',
      ({ bundle, ids }) => {
        const selected = ids
          .map((id) => bundle.presentation.elements.find((item) => item.elementId === id)?.bounds)
          .filter((rect) => rect != null);
        if (selected.length < 2) {
          report('Select at least two bounded objects to group.');
          return;
        }
        const x = Math.min(...selected.map((item) => item.x)) - 20,
          y = Math.min(...selected.map((item) => item.y)) - 40;
        const width = Math.max(...selected.map((item) => item.x + item.width)) - x + 20,
          height = Math.max(...selected.map((item) => item.y + item.height)) - y + 20;
        const id = freshId('group');
        submit(
          {
            type: 'group',
            group: { id, label: 'Group' },
            ids,
            placement: placement(id, 'container', { x, y, width, height }),
          },
          [id],
        );
      },
    ],
    ['ungroup', ({ ids }) => void submit({ type: 'ungroup', ids })],
    ['reparent', ({ ids, value }) => void submit({ type: 'reparent', ids, parentId: value })],
    ['lane-up', ({ bundle, ids }) => moveLane(bundle, ids, -1)],
    ['lane-down', ({ bundle, ids }) => moveLane(bundle, ids, 1)],
    [
      'collapse',
      ({ state, ids }) => {
        const collapsed = new Set(state.view.collapsedGroups);
        if (collapsed.has(ids[0])) collapsed.delete(ids[0]);
        else collapsed.add(ids[0]);
        session.setView({ collapsedGroups: [...collapsed] });
      },
    ],
    ...[...ROUTE_ACTIONS].map(
      (action) => /** @type {[string, CommandHandler]} */ ([action, editRoute]),
    ),
  ]);
  function selectObject({ ids, value, options }) {
    const selected = options.additive
      ? ids.includes(value)
        ? ids.filter((id) => id !== value)
        : [...ids, value]
      : [value];
    const result = select(selected);
    if (result.ok) {
      const outlineItem = options.fromOutline
        ? [...dom.outlinePane.querySelectorAll('[data-action="select-id"]')].find(
            (item) => /** @type {HTMLElement} */ (item).dataset.id === value,
          )
        : null;
      /** @type {HTMLElement} */ (outlineItem ?? dom.stage).focus();
    }
  }
  function duplicate(bundle, ids, copied) {
    const result = duplicateSelection(bundle, ids, copied);
    if (!result?.ok) {
      report(errText(result));
      return;
    }
    const submitted = submitTransaction(result.transaction);
    if (submitted.ok) select(result.selectedIds);
  }
  function moveLane(bundle, ids, delta) {
    const order = [...bundle.document.laneOrder],
      index = order.indexOf(ids[0]);
    if (index < 0 || index + delta < 0 || index + delta >= order.length) return;
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    submit({ type: 'reorder-lanes', ids: order });
  }
  function act(action, value, options = {}) {
    const state = current(),
      bundle = state.bundle,
      ids = state.view.selection;
    const early = handlersWithoutBundle.get(action);
    if (early) return void early({ state });
    if (!bundle) return;
    const handler =
      handlers.get(action) ??
      (action.startsWith('align-') || action.startsWith('distribute-') ? arrange : undefined);
    handler?.({ action, state, bundle, ids, value, options });
  }
  function click(event) {
    const target = event.target.closest('[data-action]');
    if (!target || target.closest(FOREIGN_ACTION_SCOPE)) return;
    if (ctx.chrome.overflowOpen() && !target.closest('.de-more-wrap'))
      ctx.chrome.setOverflow(false, { restoreFocus: false });
    const action = target.dataset.action;
    actionTrigger = target;
    try {
      if (action === 'create') act(action, target.dataset.kind);
      else if (action === 'select-id')
        act(action, target.dataset.id, {
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
          fromOutline: true,
        });
      else if (action === 'select-member') act(action, target.dataset.member);
      else act(action);
    } finally {
      actionTrigger = null;
    }
  }
  return {
    act,
    select,
    submit,
    submitTransaction,
    useTool,
    trigger: () => actionTrigger,
    hasClipboard: () => !!clipboard,
    click,
  };
}
