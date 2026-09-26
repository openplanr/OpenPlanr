// @ts-check
import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import { button, element } from './diagram-editor-dom.mjs';
import { hostSaveLabel } from './diagram-editor-host.mjs';

const DRAWER_MAX_WIDTH = 1100;
const COMPACT_MAX_WIDTH = 700;
const NARROW_MAX_WIDTH = 420;

/**
 * Breakpoints follow the shell's own width, so a host sidebar or a narrow embed gets the
 * matching chrome; the window is only a stand-in until the shell has a measurable width.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorLayout}
 */
export function createEditorLayout(shell, win) {
  let shellWidth = null;
  const layoutWidth = () => shellWidth ?? win.innerWidth;
  const drawer = () => layoutWidth() <= DRAWER_MAX_WIDTH;
  const compact = () => layoutWidth() <= COMPACT_MAX_WIDTH;
  const measure = () => {
    const width = shell.getBoundingClientRect().width;
    if (width > 0) shellWidth = width;
    const tiers = [];
    if (drawer()) tiers.push('drawer');
    if (compact()) tiers.push('compact');
    if (layoutWidth() <= NARROW_MAX_WIDTH) tiers.push('narrow');
    const layout = tiers.join(' ') || 'desktop';
    const changed = shell.dataset.layout !== layout;
    shell.dataset.layout = layout;
    return changed;
  };
  measure();
  return { drawer, compact, measure };
}

/**
 * Toolbar state, rails and drawers, the overflow menu, footer, empty state and resizing.
 * @type {typeof import('./diagram-editor-context.d.mts').createEditorChrome}
 */
export function createEditorChrome(ctx) {
  const { doc, dom, layout } = ctx;
  const { shell, bar, stage, stageRegion, drawerBackdrop, moreButton, moreMenu } = dom;
  const drawerLayout = layout.drawer,
    compactLayout = layout.compact;
  let leftOpen = !drawerLayout(),
    rightOpen = !drawerLayout();
  let drawerOpener = null,
    overflowOpen = false,
    overflowOpener = null,
    modalBackgroundInert = false,
    controlsStamp = '',
    lastCanvas = null,
    lastBreakpoint = null;
  /** @param {string} action */
  const barControl = (action) =>
    /** @type {HTMLButtonElement | null} */ (bar.querySelector(`[data-action="${action}"]`));

  function setOverflow(open, { focus = false, restoreFocus = true } = {}) {
    if (overflowOpen === open) return;
    overflowOpen = open;
    moreMenu.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (open) {
      overflowOpener = doc.activeElement;
      if (focus)
        /** @type {HTMLElement | null} */ (moreMenu.querySelector('[role="menuitem"]'))?.focus();
    } else {
      const target = restoreFocus && overflowOpener?.isConnected ? overflowOpener : null;
      overflowOpener = null;
      target?.focus({ preventScroll: true });
    }
  }
  function toggleInert(node, inert) {
    if (inert) {
      node.setAttribute('inert', '');
      node.setAttribute('aria-hidden', 'true');
    } else {
      node.removeAttribute('inert');
      node.removeAttribute('aria-hidden');
    }
  }
  function synchronizeBackgroundInteractivity() {
    const drawer = drawerLayout();
    const drawerOpen = drawer && (leftOpen || rightOpen);
    toggleInert(dom.work, modalBackgroundInert);
    toggleInert(bar, modalBackgroundInert || drawerOpen);
    toggleInert(stageRegion, modalBackgroundInert || drawerOpen);
  }
  function setBackgroundInert(inert) {
    modalBackgroundInert = inert;
    synchronizeBackgroundInteractivity();
  }
  /** @param {{ focusPanel?: boolean; focusTarget?: HTMLElement | null }} [options] */
  function syncPanelState({ focusPanel = false, focusTarget = null } = {}) {
    const drawer = drawerLayout();
    const { left, right } = dom;
    dom.closeOutline.hidden = !drawer;
    dom.closeProperties.hidden = !drawer;
    shell.dataset.leftOpen = String(leftOpen);
    shell.dataset.rightOpen = String(rightOpen);
    // Open the destination before moving focus. A rail is made inert only after
    // focus has left it, avoiding a transient focused descendant of an inert tree.
    for (const [node, open] of /** @type {Array<[HTMLElement, boolean]>} */ ([
      [left, leftOpen],
      [right, rightOpen],
    ])) {
      if (open) {
        node.setAttribute('aria-hidden', 'false');
        node.removeAttribute('inert');
      }
    }
    const outlineControl = barControl('outline'),
      propertiesControl = barControl('properties');
    outlineControl?.setAttribute('aria-expanded', String(leftOpen));
    outlineControl?.setAttribute('aria-controls', ctx.scopedId('outline-panel'));
    propertiesControl?.setAttribute('aria-expanded', String(rightOpen));
    propertiesControl?.setAttribute('aria-controls', ctx.scopedId('inspector-panel'));
    drawerBackdrop.hidden = !drawer || (!leftOpen && !rightOpen);
    drawerBackdrop.setAttribute('aria-hidden', String(drawerBackdrop.hidden));
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
    else if (focusPanel) {
      const target = leftOpen
        ? dom.leftTabs.querySelector('[role="tab"][aria-selected="true"]')
        : rightOpen
          ? dom.rightTabs.querySelector('[role="tab"][aria-selected="true"]')
          : null;
      /** @type {HTMLElement | null} */ (target)?.focus({ preventScroll: true });
    }
    for (const [node, open] of /** @type {Array<[HTMLElement, boolean]>} */ ([
      [left, leftOpen],
      [right, rightOpen],
    ])) {
      if (!open) {
        node.setAttribute('aria-hidden', 'true');
        node.setAttribute('inert', '');
      }
    }
    synchronizeBackgroundInteractivity();
  }
  function setRail(side, open, { focusPanel = false, restoreFocus = true } = {}) {
    const drawer = drawerLayout();
    const control = barControl(side === 'left' ? 'outline' : 'properties');
    if (open && drawer) {
      if (side === 'left') rightOpen = false;
      else leftOpen = false;
      drawerOpener = control;
    }
    if (side === 'left') leftOpen = open;
    else rightOpen = open;
    const focusTarget =
      !open && restoreFocus ? (drawerOpener?.isConnected ? drawerOpener : control) : null;
    if (!leftOpen && !rightOpen) synchronizeBackgroundInteractivity();
    syncPanelState({ focusPanel: open && (focusPanel || drawer), focusTarget });
    if (!leftOpen && !rightOpen) drawerOpener = null;
  }
  function closeDrawers({ restoreFocus = true } = {}) {
    if (!drawerLayout()) return;
    const focusTarget = restoreFocus && drawerOpener?.isConnected ? drawerOpener : null;
    leftOpen = false;
    rightOpen = false;
    synchronizeBackgroundInteractivity();
    syncPanelState({ focusTarget });
    drawerOpener = null;
  }
  function renderChrome(state) {
    const { editable, readOnly } = ctx;
    const bundle = state.bundle;
    dom.title.textContent = bundle?.document.title ?? 'Diagram unavailable';
    const status = state.saveState;
    dom.saveState.textContent = readOnly(state)
      ? ctx.config.labels.readOnly
      : (hostSaveLabel(ctx.host, state) ??
        {
          saved: 'Saved',
          saving: 'Saving…',
          unsaved: 'Unsaved',
          offline: 'Offline · Unsaved',
          conflict: 'Conflict · Unsaved',
          'access-changed': 'Access changed',
        }[status] ??
        'Unsaved');
    dom.saveState.dataset.state = readOnly(state) ? 'read-only' : status;
    shell.dataset.editable = String(editable(state));
    shell.dataset.readOnly = String(readOnly(state));
    shell.dataset.mode = ctx.mode;
    syncPanelState();
    const tool = ctx.canvas.tool();
    for (const control of /** @type {NodeListOf<HTMLElement>} */ (
      dom.canvasTools.querySelectorAll('[data-action="select-tool"],[data-action="pan-tool"]')
    )) {
      const active = control.dataset.action === tool + '-tool';
      control.setAttribute('aria-pressed', String(active));
      control.dataset.active = String(active);
    }
    const snapControl = /** @type {HTMLElement | null} */ (
      dom.canvasTools.querySelector('[data-action="snap"]')
    );
    snapControl?.setAttribute('aria-pressed', String(state.view.snap));
    if (snapControl) snapControl.dataset.active = String(state.view.snap);
    dom.zoomValue.textContent = Math.round(state.view.camera.scale * 100) + '%';
    for (const [action, disabled] of Object.entries({
      undo: !state.canUndo || !editable(state),
      redo: !state.canRedo || !editable(state),
      save:
        !editable(state) ||
        status === 'saving' ||
        (!ctx.inspector.dirty() &&
          status === 'saved' &&
          state.pendingCount === 0 &&
          !state.needsInitialization),
      layout: !editable(state),
      properties: !state.capabilities.read,
      outline: !state.capabilities.read,
    })) {
      const control = barControl(action);
      if (control) control.disabled = disabled;
    }
    for (const entry of ctx.config.actions) {
      const control = /** @type {HTMLButtonElement | null} */ (
        bar.querySelector('[data-host-action="' + entry.id + '"]')
      );
      if (!control) throw new TypeError(`Host action ${entry.id} has no toolbar control.`);
      control.hidden = !!entry.hidden?.(state);
      control.disabled = !!entry.disabled?.(state);
    }
    const stamp = [
      bundle?.bundleDigest,
      state.view.selection.join('|'),
      state.view.collapsedGroups.join('|'),
      state.pendingCount,
      state.saveState,
      state.recovery.mode,
      ctx.outline.tab(),
      ctx.inspector.tab(),
      ctx.mode,
      leftOpen,
      rightOpen,
      compactLayout(),
      ctx.config.panels.map((panel) => (panel.hidden?.(state) ? 0 : 1)).join(''),
    ].join(':');
    if (stamp === controlsStamp) return;
    controlsStamp = stamp;
    ctx.outline.render(state);
    ctx.inspector.render(state);
    renderFooter(state);
    ctx.inspector.updateCommandState(state);
    const { empty } = dom;
    const hasContent = bundle && bundle.presentation.elements.length > 0;
    empty.hidden = hasContent || !editable(state);
    if (!empty.hidden) {
      empty.replaceChildren(
        element(doc, 'h2', {}, 'Create your diagram'),
        element(doc, 'p', {}, ctx.config.labels.emptyHint),
      );
      empty.append(
        button(doc, 'Start blank', 'blank', { className: 'de-primary' }),
        button(doc, 'Use process template', 'template'),
      );
      const guide = element(doc, 'ol');
      for (const step of [
        'Add shapes and connectors',
        'Edit labels and layout',
        'Save the diagram',
      ])
        guide.append(element(doc, 'li', {}, step));
      empty.append(guide);
    }
  }
  function renderFooter(state) {
    const { footer } = dom;
    footer.replaceChildren();
    if (!state.bundle) {
      footer.append(element(doc, 'span', {}, 'Access changed. Reopen this diagram to continue.'));
      return;
    }
    if (state.saveState === 'conflict')
      footer.append(
        element(doc, 'span', {}, 'A newer saved revision exists. Your draft remains in this tab.'),
        button(doc, 'Compare revisions', 'conflict', { className: 'de-primary' }),
      );
    else if (state.saveState === 'offline')
      footer.append(
        element(doc, 'span', {}, 'Save was not confirmed. Edits remain pending.'),
        button(doc, 'Retry save', 'save'),
      );
    else if (state.recovery.warning && !ctx.readOnly(state))
      footer.append(element(doc, 'span', {}, state.recovery.warning));
    else if (state.pendingCount > 0 && state.acknowledged)
      footer.append(
        element(
          doc,
          'span',
          {},
          'Recovered or pending edits are in this session. Review before you save.',
        ),
      );
    else if (!getDiagramAuthoringCapability(state.bundle.document.grammar.id))
      footer.append(
        element(
          doc,
          'span',
          {},
          'This diagram grammar is available for inspection only. Editing is not certified.',
        ),
      );
    else
      footer.append(
        element(
          doc,
          'span',
          {},
          state.view.selection.length +
            ' selected · ' +
            state.bundle.presentation.elements.length +
            ' objects',
        ),
      );
  }
  function resize() {
    const layoutChanged = layout.measure();
    const breakpoint = drawerLayout() ? 'drawer' : 'desktop';
    const breakpointChanged = !!lastBreakpoint && lastBreakpoint !== breakpoint;
    let focusAfterRender = null;
    if (breakpointChanged && breakpoint === 'drawer') {
      const active = doc.activeElement;
      const focusTarget = dom.left.contains(active)
        ? barControl('outline')
        : dom.right.contains(active)
          ? barControl('properties')
          : null;
      // Move focus to the matching trigger while the rail is still operable;
      // the render below closes and inerts both responsive drawers afterward.
      focusTarget?.focus({ preventScroll: true });
      leftOpen = false;
      rightOpen = false;
      drawerOpener = null;
    }
    if (breakpointChanged && breakpoint === 'desktop' && doc.activeElement === drawerBackdrop)
      focusAfterRender = stage;
    const rect = stage.getBoundingClientRect();
    if (
      lastCanvas &&
      !layoutChanged &&
      lastCanvas.width === rect.width &&
      lastCanvas.height === rect.height
    )
      return;
    if (!lastBreakpoint && breakpoint === 'drawer') {
      leftOpen = false;
      rightOpen = false;
    }
    if (breakpointChanged && breakpoint === 'desktop') {
      leftOpen = true;
      rightOpen = true;
      drawerOpener = null;
    }
    lastBreakpoint = breakpoint;
    if (lastCanvas) {
      const camera = ctx.current().view.camera;
      if (camera.fit) ctx.canvas.fit();
      else
        ctx.canvas.cameraPatch({
          ...camera,
          x: camera.x + (rect.width - lastCanvas.width) / 2,
          y: camera.y + (rect.height - lastCanvas.height) / 2,
        });
    } else ctx.canvas.fit();
    lastCanvas = { width: rect.width, height: rect.height };
    render(ctx.current(), { force: true });
    focusAfterRender?.focus({ preventScroll: true });
  }
  function render(state, { force = false } = {}) {
    if (force) controlsStamp = '';
    renderChrome(state);
  }
  function pointerDownOutside(event) {
    if (overflowOpen && !event.target.closest?.('.de-more-wrap'))
      setOverflow(false, { restoreFocus: false });
  }
  return {
    render,
    setRail,
    closeDrawers,
    setOverflow,
    setBackgroundInert,
    railOpen: (side) => (side === 'left' ? leftOpen : rightOpen),
    overflowOpen: () => overflowOpen,
    resize,
    pointerDownOutside,
  };
}
