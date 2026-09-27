import type { DiagramEditTransaction } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramEditorState } from '../diagram/editor/index.mjs';
import { button, element } from './diagram-editor-dom.mjs';
import { renderDiagramProperties } from './diagram-editor-properties.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';

export interface DiagramEditorInspector {
  tab(): string;
  showTab(next: string, options?: { focus?: boolean }): void;
  panes(): Map<string, HTMLElement>;
  render(state: DiagramEditorState): void;
  /** Whether the properties form holds unapplied changes. */
  dirty(): boolean;
  /** False, with the draft surfaced to the user, when unapplied changes block another edit. */
  guardDraft(): boolean;
  applyDraft(): Promise<boolean>;
  updateCommandState(state?: DiagramEditorState, dirty?: boolean): void;
  dispose(): void;
}
/** A properties controller as the inspector reads it; it tolerates a missing member. */
interface PropertiesDraft {
  readonly dirty?: boolean | (() => boolean);
  apply?(): { ok?: boolean } | false | Promise<{ ok?: boolean } | false>;
  focus?(): void;
}

const PROPERTY_DRAFT_MESSAGE = 'Apply or revert property changes before selecting another object.';

/** The right rail: Properties, Review and host panel tabs, and the unapplied property draft. */
export function createEditorInspector(ctx: DiagramEditorContext): DiagramEditorInspector {
  const { doc, win, session, dom, config } = ctx;
  const { rightTabs, propertiesPane, reviewPane, hostPanes } = dom;
  const hostPanelCleanups = new Map<string, (() => void) | null>();
  let rightTab = 'properties',
    propertyController: PropertiesDraft | null = null,
    propertiesDirty = false,
    propertiesStamp = '',
    propertiesSelection = '',
    propertyRefreshQueued = false,
    reviewMounted = false,
    reviewCleanup: (() => void) | null = null;

  const controllerIsDirty = () => {
    if (!propertyController) return propertiesDirty;
    const value =
      typeof propertyController.dirty === 'function'
        ? propertyController.dirty()
        : propertyController.dirty;
    return value === undefined ? propertiesDirty : !!value;
  };
  const updateCommandState = (
    state: DiagramEditorState = ctx.current(),
    dirty: boolean = controllerIsDirty(),
  ) => {
    propertiesDirty = !!dirty;
    dom.shell.dataset.propertyDirty = String(propertiesDirty);
    const status = state.saveState;
    const saveControl = dom.bar.querySelector<HTMLButtonElement>('[data-action="save"]');
    if (saveControl)
      saveControl.disabled =
        !ctx.editable(state) ||
        status === 'saving' ||
        (!propertiesDirty &&
          status === 'saved' &&
          state.pendingCount === 0 &&
          !state.needsInitialization);
  };
  function synchronizePropertiesAfterApply() {
    if (propertyRefreshQueued) return;
    propertyRefreshQueued = true;
    win.queueMicrotask(() => {
      propertyRefreshQueued = false;
      if (ctx.isDisposed() || controllerIsDirty()) return;
      renderRight(ctx.current());
    });
  }
  const handlePropertyDirty = (dirty: boolean) => {
    const wasDirty = propertiesDirty;
    updateCommandState(ctx.current(), dirty);
    if (wasDirty && !dirty) {
      if (dom.alert.textContent === PROPERTY_DRAFT_MESSAGE) ctx.report('');
      synchronizePropertiesAfterApply();
    }
  };
  const guardPropertyDraft = () => {
    if (!controllerIsDirty()) return true;
    setRightTab('properties');
    ctx.chrome.setRail('right', true, { restoreFocus: false });
    ctx.report(PROPERTY_DRAFT_MESSAGE);
    propertyController?.focus?.();
    return false;
  };
  function rightPanes() {
    const panes: Array<[string, HTMLElement]> = [['properties', propertiesPane]];
    if (config.reviewEnabled) panes.push(['review', reviewPane]);
    return new Map([...panes, ...hostPanes]);
  }
  function setRightTab(next: string, { focus = false }: { focus?: boolean } = {}) {
    const panes = rightPanes(),
      shown = [...rightTabs.querySelectorAll<HTMLElement>('[role="tab"]')].map(
        (node) => node.dataset.tab,
      );
    if (!panes.has(next) || (shown.length && !shown.includes(next))) next = 'properties';
    rightTab = next;
    for (const [id, pane] of panes) pane.hidden = id !== next;
    if (!config.reviewEnabled) reviewPane.hidden = true;
    for (const tabNode of rightTabs.querySelectorAll<HTMLElement>('[role="tab"]')) {
      const selected = tabNode.dataset.tab === next;
      tabNode.setAttribute('aria-selected', String(selected));
      tabNode.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabNode.focus({ preventScroll: true });
    }
    if (next === 'review' && !reviewMounted) mountReview();
    if (hostPanes.has(next) && !hostPanelCleanups.has(next)) mountHostPanel(next);
  }
  function mountHostPanel(id: string) {
    const panel = config.panels.find((item) => item.id === id),
      root = hostPanes.get(id);
    if (!panel || !root) throw new TypeError(`Host panel ${id} has no pane in this editor.`);
    const cleanup = panel.mount({
      root,
      session,
      select: (ids) => ctx.commands.select(ids),
      close: () => ctx.chrome.setRail('right', false),
    });
    hostPanelCleanups.set(id, typeof cleanup === 'function' ? cleanup : null);
  }
  function mountReview() {
    if (reviewMounted) return;
    reviewMounted = true;
    reviewPane.replaceChildren(
      element(doc, 'h2', { className: 'de-panel-section-title' }, 'Review'),
    );
    if (typeof ctx.host.mountReview === 'function') {
      const slot = element(doc, 'div', { className: 'de-review-slot' });
      reviewPane.append(slot);
      reviewCleanup =
        ctx.host.mountReview({ root: slot, session, select: ctx.commands.select }) ?? null;
    } else
      reviewPane.append(
        element(doc, 'p', { className: 'de-muted' }, config.labels.reviewUnavailable),
      );
  }
  function renderRight(state: DiagramEditorState) {
    rightTabs.replaceChildren();
    const tabs = [
      ['Properties', 'properties', 'properties-tab'],
      ...config.panels
        .filter((panel) => !panel.hidden?.(state))
        .map((panel) => [panel.label, panel.id, 'host-panel-tab']),
      ...(config.reviewEnabled ? [['Review', 'review', 'review-tab']] : []),
    ];
    for (const [name, id, action] of tabs) {
      const selected = rightTab === id;
      rightTabs.append(
        button(doc, name, action, {
          id: ctx.scopedId(id + '-tab'),
          role: 'tab',
          'aria-controls': ctx.scopedId(id + '-pane'),
          'aria-selected': String(selected),
          tabindex: selected ? '0' : '-1',
          'data-tab': id,
        }),
      );
    }
    setRightTab(rightTab);
    const selectionKey = state.view.selection.join('|'),
      nextStamp = [state.bundle?.bundleDigest ?? 'none', selectionKey, ctx.editable(state)].join(
        '::',
      );
    if (controllerIsDirty() && propertiesSelection === selectionKey) return;
    if (propertiesStamp === nextStamp) return;
    propertiesStamp = nextStamp;
    propertiesSelection = selectionKey;
    propertiesDirty = false;
    if (!state.bundle) {
      propertiesPane.replaceChildren(element(doc, 'p', {}, 'Access changed. Reopen this diagram.'));
      propertyController = null;
      updateCommandState(state);
      return;
    }
    const focused = propertiesPane.contains(doc.activeElement)
      ? doc.activeElement?.getAttribute('aria-label')
      : null;
    const submitPropertiesTransaction = (value: DiagramEditTransaction) => {
      const result = ctx.commands.submitTransaction(value, { allowDirty: true });
      if (result?.ok) {
        propertiesStamp = '';
        synchronizePropertiesAfterApply();
      }
      return result;
    };
    propertyController =
      renderDiagramProperties({
        root: propertiesPane,
        state,
        editable: ctx.editable(state),
        act: ctx.commands.act,
        submitTransaction: submitPropertiesTransaction,
        onDirtyChange: handlePropertyDirty,
      }) ?? null;
    propertiesDirty = controllerIsDirty();
    updateCommandState(state);
    if (focused && !propertiesPane.contains(doc.activeElement))
      propertiesPane.querySelector<HTMLElement>('[aria-label="' + focused + '"]')?.focus();
  }
  async function applyPropertiesDraft() {
    if (!controllerIsDirty()) return true;
    const controller = propertyController;
    const form = propertiesPane.querySelector('form');
    if (form && !form.checkValidity()) {
      form.reportValidity();
      form.querySelector<HTMLElement>(':invalid')?.focus();
      return false;
    }
    if (!controller?.apply) {
      ctx.report('Apply or revert property changes before saving.');
      controller?.focus?.();
      return false;
    }
    const result = await controller.apply();
    if (result === false || result?.ok === false) {
      controller.focus?.();
      return false;
    }
    propertiesDirty = false;
    updateCommandState(ctx.current(), false);
    synchronizePropertiesAfterApply();
    return true;
  }
  return {
    tab: () => rightTab,
    showTab: setRightTab,
    panes: rightPanes,
    render: renderRight,
    dirty: controllerIsDirty,
    guardDraft: guardPropertyDraft,
    applyDraft: applyPropertiesDraft,
    updateCommandState,
    dispose() {
      reviewCleanup?.();
      for (const cleanup of hostPanelCleanups.values()) cleanup?.();
    },
  };
}
