import {
  type DiagramPlacement,
  getDiagramAuthoringCapability,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type {
  VersionedDiagramAuthoringBundle as DiagramAuthoringBundle,
  VersionedDiagramEditTransaction as DiagramEditTransaction,
} from '@openplanr/protocol/studio-presentation-contracts';
import type { DiagramCommand, DiagramCommandResult } from '../diagram/authoring/index.mjs';
import { appearanceFields, clone, geometryFields, snapshot } from '../diagram/authoring/model.mjs';
import {
  copyDiagramSelection,
  type DiagramSelectionClipboard,
} from '../diagram/editor/clipboard.mjs';
import type { DiagramEditorSession, DiagramEditorState } from '../diagram/editor/index.mjs';
import {
  addOrthogonalDetour,
  arrangementCommand,
  connector,
  createObject,
  type DiagramEditorPoint,
  type DiagramObjectKind,
  duplicateSelection,
  freshId,
  placement,
  processTemplate,
  transaction,
} from './diagram-editor-actions.mjs';
import type { DiagramEditorTool } from './diagram-editor-canvas.mjs';
import type { DiagramEditorRail } from './diagram-editor-chrome.mjs';
import { downloadJson } from './diagram-editor-dom.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';

/** An edit refused because the inspector holds unapplied property changes. */
export interface DiagramEditorDraftRefusal {
  ok: false;
  status: 'property-draft';
}
interface ActionOptions {
  additive?: boolean;
  fromOutline?: boolean;
}
export interface DiagramEditorCommands {
  /** Run one `data-action`; unknown actions do nothing. */
  act(action: string, value?: unknown, options?: ActionOptions): void;
  select(
    ids: string[],
    options?: { force?: boolean },
  ): ReturnType<DiagramEditorSession['setView']> | DiagramEditorDraftRefusal;
  submit(
    command: DiagramCommand,
    selectIds?: string[],
  ): DiagramCommandResult | DiagramEditorDraftRefusal;
  submitTransaction(
    value: DiagramEditTransaction,
    options?: { allowDirty?: boolean },
  ): DiagramCommandResult | DiagramEditorDraftRefusal;
  useTool(tool: DiagramEditorTool, state: DiagramEditorState): void;
  /** The control whose click is being dispatched, or null outside a click. */
  trigger(): HTMLElement | null;
  hasClipboard(): boolean;
  click(event: MouseEvent): void;
}
/** One dispatched action with the state it was dispatched against. */
interface CommandInput {
  action: string;
  state: DiagramEditorState;
  bundle: DiagramAuthoringBundle;
  ids: string[];
  value: unknown;
  options: ActionOptions;
}
type CommandHandler = (input: CommandInput) => void;
/** The value the inspector dispatches with reparent: a parent id, or null for the diagram root. */
type ParentId = string | null;
/** A result or error whose diagnostics or message explain a failure. */
interface Explained {
  ok?: boolean;
  diagnostics?: ReadonlyArray<{ detail: string }>;
  message?: string;
}

/** Surfaces that dispatch their own clicks; actions inside them never reach the editor. */
const FOREIGN_ACTION_SCOPE = '.de-host-pane,.de-review-slot,.de-conflict,.de-source-panel';
const ROUTE_ACTIONS = new Set(['add-bend', 'remove-bend', 'reset-route', 'position-label']);

export const errText = (result: Explained | null | undefined): string =>
  result?.diagnostics
    ?.map((item) => item.detail)
    .filter(Boolean)
    .join(' ') ||
  result?.message ||
  'The change could not be applied.';
export const safeAction = <Result,>(fn: () => Result, report: (message: string) => void) => {
  try {
    return fn();
  } catch (error) {
    report(error instanceof Error ? error.message : 'The edit is invalid.');
    return null;
  }
};
export const bundleOf = (state: DiagramEditorState) => {
  if (!state.bundle) throw new TypeError('The editor has no readable diagram.');
  return state.bundle;
};
const placementOf = (bundle: DiagramAuthoringBundle, id: string) => {
  const placement = bundle.presentation.elements.find((item) => item.elementId === id);
  if (!placement) throw new TypeError(`Element ${id} has no placement.`);
  return placement;
};
const draftRefusal = (): DiagramEditorDraftRefusal => ({ ok: false, status: 'property-draft' });
function lockedSelection(
  bundle: DiagramAuthoringBundle,
  ids: string[],
  next: boolean,
): DiagramCommand {
  // The filter keeps the selected objects that have a placement.
  const changes = (
    ids
      .map((id) => bundle.presentation.elements.find((item) => item.elementId === id))
      .filter(Boolean) as DiagramPlacement[]
  ).map((item) => {
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

/** Edit primitives, save, and the action table that every `data-action` control dispatches through. */
export function createEditorCommands(ctx: DiagramEditorContext): DiagramEditorCommands {
  const { doc, session, dom } = ctx;
  const current = ctx.current,
    report = ctx.report,
    notice = ctx.notice;
  let clipboard: DiagramSelectionClipboard | null = null,
    actionTrigger: HTMLElement | null = null;

  const select = (ids: string[], { force = false }: { force?: boolean } = {}) => {
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
  const submit = (command: DiagramCommand, selectIds?: string[]) => {
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
  const submitTransaction = (
    value: DiagramEditTransaction,
    { allowDirty = false }: { allowDirty?: boolean } = {},
  ) => {
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
  function useTool(next: DiagramEditorTool, state: DiagramEditorState) {
    ctx.canvas.setTool(next);
    ctx.chrome.render(state, { force: true });
    notice(next === 'select' ? 'Select mode' : 'Pan mode');
  }
  function toggleRail(side: DiagramEditorRail, action: 'toggle' | 'close') {
    const open = ctx.chrome.railOpen(side);
    ctx.chrome.setRail(side, action === 'close' ? false : !open, {
      focusPanel: action === 'toggle' && !open,
    });
  }
  function editRoute({ action, bundle, ids, value }: CommandInput) {
    const id = ids[0],
      place = placementOf(bundle, id),
      before = geometryFields(place),
      after = clone(before);
    if (!after.route) {
      report('Select a connector with a route.');
      return;
    }
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
          (point: DiagramEditorPoint, index: number, all: DiagramEditorPoint[]) =>
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
  function arrange({ action, bundle, ids }: CommandInput) {
    const command = safeAction(() => arrangementCommand(bundle, ids, action), report);
    if (command) submit(command);
  }

  /** Actions that run even when the session has no readable diagram. */
  const handlersWithoutBundle = new Map<string, (input: { state: DiagramEditorState }) => void>([
    [
      'host-action',
      ({ state }) => {
        const entry = ctx.config.actions.find(
          (item) => item.id === actionTrigger?.dataset.hostAction,
        );
        // A host action is dispatched from its toolbar button.
        if (entry && !(actionTrigger as HTMLButtonElement).disabled)
          entry.onSelect({ session, state, trigger: actionTrigger as HTMLButtonElement });
      },
    ],
    ['cancel-dialog', ({ state }) => ctx.dialogs.cancel(state)],
  ]);
  // biome-ignore format: bundles keep the reparent entry on one line; wrapping it would change their bytes.
  const handlers = new Map<string, CommandHandler>([
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
        ctx.outline.preferTab('outline');
        ctx.chrome.render(state, { force: true });
        ctx.outline.showTab('outline', { focus: true });
      },
    ],
    [
      'shapes-tab',
      ({ state }) => {
        ctx.outline.preferTab('shapes');
        ctx.chrome.render(state, { force: true });
        ctx.outline.showTab('shapes', { focus: true });
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
    ['fit', () => ctx.canvas.fit(0)],
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
        ctx.chrome.dismissEmpty();
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
        const result = submit(
          command,
          command.elements
            .filter((item) => item.collection === 'nodes')
            .map((item) => item.value.id),
        );
        if (result.ok) ctx.chrome.dismissEmpty();
        ctx.canvas.fit();
      },
    ],
    [
      'create',
      ({ state, bundle, value }) => {
        const { stage } = dom;
        // The shape palette dispatches its own data-kind values.
        const kind = value as DiagramObjectKind,
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
          ctx.chrome.dismissEmpty();
          if (state.view.camera.fit) ctx.canvas.fit();
          ctx.chrome.closeDrawers({ restoreFocus: false });
          stage.focus();
        }
      },
    ],
    ['quick-add', ({ bundle, ids }) => {
      if (ids.length !== 1 || !bundle.document.nodes.some((node) => node.id === ids[0])) return;
      const bounds = bundle.presentation.elements.find((item) => item.elementId === ids[0])?.bounds;
      if (!bounds) return;
      const capability = getDiagramAuthoringCapability(bundle.document.grammar.id);
        const kind = capability?.nodeKinds.includes('process') ? 'process' : capability?.nodeKinds[0];
        if (!kind) { report('Connected steps are unavailable for this grammar.'); return; }
        const shape = createObject(kind, { x: bounds.x + bounds.width + 80, y: bounds.y });
      const nextId = shape.elements[0].value.id;
      const edge = connector(ids[0], nextId);
      const result = submit({ type: 'create', elements: [...shape.elements, ...edge.elements],
        presentation: [...shape.presentation, ...edge.presentation] }, [nextId]);
      if (result.ok) {
        ctx.chrome.closeDrawers({ restoreFocus: false });
        if (current().view.camera.fit) ctx.canvas.fit();
        dom.stage.focus();
      }
    }],
    ['select-id', selectObject],
    ['select-member', selectObject],
    ['connect-drag', ({ bundle, value }) => {
      const { from, to, side } = value as { from: string; to: string; side: 'left' | 'right' | 'top' | 'bottom' };
      if (from === to) { report('Choose another shape to connect.'); return; }
      if (bundle.document.relations.some((edge) => edge.from === from && edge.to === to)) {
        report('These shapes are already connected. Choose another target.'); return;
      }
      const command = connector(from, to);
      if (command.presentation[0].route) command.presentation[0].route.from.side = side;
      submit(command, [command.elements[0].value.id]);
    }],
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
        if (typeof value !== 'string') return;
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
    [
      'copy-reference',
      ({ value }) => {
        if (typeof value !== 'string')
          throw new TypeError(`copy-reference expects the reference text, not ${typeof value}.`);
        const system = doc.defaultView?.navigator.clipboard;
        if (!system) {
          report(
            'Clipboard access is unavailable here. Select the reference and copy it manually.',
          );
          return;
        }
        system.writeText(value).then(
          () => notice('Reference copied.'),
          (error) => {
            const reason = error instanceof Error ? error.message : String(error);
            report(`The reference could not be copied: ${reason}`);
          },
        );
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
    ['reparent', ({ ids, value }) => void submit({ type: 'reparent', ids, parentId: value as ParentId })],
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
    ...[...ROUTE_ACTIONS].map((action): [string, CommandHandler] => [action, editRoute]),
  ]);
  function selectObject({ ids, value, options }: CommandInput) {
    // Outline rows and member buttons dispatch an object id.
    const selected = options.additive
      ? ids.includes(value as string)
        ? ids.filter((id) => id !== value)
        : [...ids, value as string]
      : [value as string];
    const result = select(selected);
    if (result.ok) {
      const outlineItem = options.fromOutline
        ? [...dom.outlinePane.querySelectorAll<HTMLElement>('[data-action="select-id"]')].find(
            (item) => item.dataset.id === value,
          )
        : null;
      (outlineItem ?? dom.stage).focus();
    }
  }
  function duplicate(
    bundle: DiagramAuthoringBundle,
    ids: string[],
    copied: DiagramSelectionClipboard | null,
  ) {
    const result = duplicateSelection(bundle, ids, copied);
    if (!result?.ok) {
      report(errText(result));
      return;
    }
    // A pasted selection always compiles to a transaction.
    const submitted = submitTransaction(result.transaction as DiagramEditTransaction);
    if (submitted.ok) select(result.selectedIds);
  }
  function moveLane(bundle: DiagramAuthoringBundle, ids: string[], delta: number) {
    const order = [...bundle.document.laneOrder],
      index = order.indexOf(ids[0]);
    if (index < 0 || index + delta < 0 || index + delta >= order.length) return;
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    submit({ type: 'reorder-lanes', ids: order });
  }
  function act(action: string, value?: unknown, options: ActionOptions = {}) {
    if (['menu-undo', 'menu-redo', 'menu-save', 'menu-zoom-in', 'menu-zoom-out'].includes(action)) {
      ctx.chrome.setOverflow(false);
      action = action.slice(5);
    }
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
  function click(event: MouseEvent) {
    // The bar is inert under an open drawer, so a click on it reaches the shell itself.
    if (event.target === dom.shell) {
      ctx.chrome.closeDrawers();
      return;
    }
    // Click events target elements.
    const target = (event.target as Element).closest<HTMLElement>('[data-action]');
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
      // The target matched [data-action].
      else act(action as string);
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
