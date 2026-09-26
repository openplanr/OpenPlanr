// @ts-check
import { button, element } from './diagram-editor-dom.mjs';
import { renderDiagramProperties } from './diagram-editor-properties.mjs';

const PROPERTY_DRAFT_MESSAGE = 'Apply or revert property changes before selecting another object.';

/**
 * The right rail: Properties, Review and host panel tabs, and the unapplied property draft.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorInspector}
 */
export function createEditorInspector(ctx) {
  const { doc, win, session, dom, config } = ctx;
  const { rightTabs, propertiesPane, reviewPane, hostPanes } = dom;
  const hostPanelCleanups = new Map();
  let rightTab = 'properties',
    propertyController = null,
    propertiesDirty = false,
    propertiesStamp = '',
    propertiesSelection = '',
    propertyRefreshQueued = false,
    reviewMounted = false,
    reviewCleanup = null;

  const controllerIsDirty = () => {
    if (!propertyController) return propertiesDirty;
    const value =
      typeof propertyController.dirty === 'function'
        ? propertyController.dirty()
        : propertyController.dirty;
    return value === undefined ? propertiesDirty : !!value;
  };
  const updateCommandState = (state = ctx.current(), dirty = controllerIsDirty()) => {
    propertiesDirty = !!dirty;
    dom.shell.dataset.propertyDirty = String(propertiesDirty);
    const status = state.saveState;
    const saveControl = /** @type {HTMLButtonElement | null} */ (
      dom.bar.querySelector('[data-action="save"]')
    );
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
  const handlePropertyDirty = (dirty) => {
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
    /** @type {Array<[string, HTMLElement]>} */
    const panes = [['properties', propertiesPane]];
    if (config.reviewEnabled) panes.push(['review', reviewPane]);
    return new Map([...panes, ...hostPanes]);
  }
  function setRightTab(next, { focus = false } = {}) {
    const panes = rightPanes(),
      shown = [
        .../** @type {NodeListOf<HTMLElement>} */ (rightTabs.querySelectorAll('[role="tab"]')),
      ].map((node) => node.dataset.tab);
    if (!panes.has(next) || (shown.length && !shown.includes(next))) next = 'properties';
    rightTab = next;
    for (const [id, pane] of panes) pane.hidden = id !== next;
    if (!config.reviewEnabled) reviewPane.hidden = true;
    for (const tabNode of /** @type {NodeListOf<HTMLElement>} */ (
      rightTabs.querySelectorAll('[role="tab"]')
    )) {
      const selected = tabNode.dataset.tab === next;
      tabNode.setAttribute('aria-selected', String(selected));
      tabNode.tabIndex = selected ? 0 : -1;
      if (selected && focus) tabNode.focus({ preventScroll: true });
    }
    if (next === 'review' && !reviewMounted) mountReview();
    if (hostPanes.has(next) && !hostPanelCleanups.has(next)) mountHostPanel(next);
  }
  function mountHostPanel(id) {
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
  function renderRight(state) {
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
    const submitPropertiesTransaction = (value) => {
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
      /** @type {HTMLElement | null} */ (
        propertiesPane.querySelector('[aria-label="' + focused + '"]')
      )?.focus();
  }
  async function applyPropertiesDraft() {
    if (!controllerIsDirty()) return true;
    const controller = propertyController;
    const form = propertiesPane.querySelector('form');
    if (form && !form.checkValidity()) {
      form.reportValidity();
      /** @type {HTMLElement | null} */ (form.querySelector(':invalid'))?.focus();
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
