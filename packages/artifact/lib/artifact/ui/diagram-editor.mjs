// @ts-check
import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import { createEditorCanvas } from './diagram-editor-canvas.mjs';
import { createEditorChrome, createEditorLayout } from './diagram-editor-chrome.mjs';
import { createEditorCommands } from './diagram-editor-commands.mjs';
import { createEditorDialogs } from './diagram-editor-dialogs.mjs';
import { icon } from './diagram-editor-dom.mjs';
import { colorSchemeOf, readHostOptions } from './diagram-editor-host.mjs';
import { createEditorInspector } from './diagram-editor-inspector.mjs';
import { createEditorKeyboard } from './diagram-editor-keyboard.mjs';
import { createEditorOutline } from './diagram-editor-outline.mjs';
import { renderEditorControls, renderEditorSkeleton } from './diagram-editor-template.mjs';

/** @typedef {import('./diagram-editor-context.d.mts').DiagramEditorContext} DiagramEditorContext */

const ID_PREFIX = 'diagram';
let mountCount = 0;
/** @param {Document} document */
const windowOf = (document) => {
  const view = document.defaultView;
  if (!view) throw new TypeError('Mount needs a root inside a live document.');
  return view;
};

/**
 * Browser-safe, framework-neutral UI. The supplied session remains owned by its host.
 * @type {typeof import('./diagram-editor.d.mts').mountDiagramEditor}
 */
export function mountDiagramEditor({ root, session, host = {} }) {
  if (!root || !session || typeof session.getState !== 'function')
    throw new TypeError('Mount needs one root and one editor session.');
  const config = readHostOptions(host);
  let hostScheme = config.colorScheme;
  const doc = root.ownerDocument,
    win = windowOf(doc);
  const colorScheme = win.matchMedia?.('(prefers-color-scheme: dark)');
  // The first editor keeps the historical ids; later mounts take a suffix so two can share a document.
  mountCount += 1;
  const idPrefix = mountCount === 1 ? ID_PREFIX : `${ID_PREFIX}-${mountCount}`;
  const scopedId = (name) => `${idPrefix}-${name}`;
  const mode = 'edit';
  let disposed = false,
    resizeFrame = 0,
    lastAnnouncement = '',
    announcementFrame = 0;

  const skeleton = renderEditorSkeleton(doc, scopedId);
  const { shell, stage } = skeleton;
  root.replaceChildren(shell);
  const layout = createEditorLayout(shell, win);
  skeleton.subtitle.textContent = config.labels.subtitle;
  if (host.brand === false) skeleton.mark.remove();
  else skeleton.mark.append(icon(doc, 'mark', { size: 18 }));
  const applyColorScheme = () => {
    if (hostScheme) shell.dataset.colorScheme = hostScheme;
    else delete shell.dataset.colorScheme;
  };
  applyColorScheme();
  const dom = {
    ...skeleton,
    ...renderEditorControls(doc, skeleton, {
      scopedId,
      actions: config.actions,
      panels: config.panels,
    }),
  };

  const notice = (message) => {
    win.cancelAnimationFrame(announcementFrame);
    if (message === lastAnnouncement) {
      dom.announcer.textContent = '';
      announcementFrame = win.requestAnimationFrame(() => {
        if (!disposed) dom.announcer.textContent = message;
      });
    } else dom.announcer.textContent = message;
    lastAnnouncement = message;
  };
  const report = (message) => {
    dom.alert.hidden = !message;
    dom.alert.textContent = message || '';
    if (message) notice(message);
  };
  const editable = (state) =>
    mode === 'edit' &&
    !layout.compact() &&
    state.capabilities.read &&
    state.capabilities.write &&
    state.saveState !== 'access-changed' &&
    !!getDiagramAuthoringCapability(state.bundle?.document.grammar.id);
  const readOnly = (state) => state.capabilities.read && !state.capabilities.write;
  const displayed = (state) => state.gesture?.bundle ?? state.bundle;
  const prefersDark = () => (hostScheme ? hostScheme === 'dark' : !!colorScheme?.matches);

  // Every region is assigned before a getter is read: regions call each other only from
  // handlers, and the keyboard, which reads them when created, is created last.
  /** @type {DiagramEditorContext['chrome']} */ let chrome;
  /** @type {DiagramEditorContext['outline']} */ let outline;
  /** @type {DiagramEditorContext['inspector']} */ let inspector;
  /** @type {DiagramEditorContext['canvas']} */ let canvas;
  /** @type {DiagramEditorContext['dialogs']} */ let dialogs;
  /** @type {DiagramEditorContext['commands']} */ let commands;
  /** @type {DiagramEditorContext} */
  const ctx = {
    doc,
    win,
    session,
    host,
    config,
    dom,
    layout,
    mode,
    scopedId,
    isDisposed: () => disposed,
    current: () => session.getState(),
    displayed,
    editable,
    readOnly,
    prefersDark,
    notice,
    report,
    get chrome() {
      return chrome;
    },
    get outline() {
      return outline;
    },
    get inspector() {
      return inspector;
    },
    get canvas() {
      return canvas;
    },
    get dialogs() {
      return dialogs;
    },
    get commands() {
      return commands;
    },
  };
  chrome = createEditorChrome(ctx);
  outline = createEditorOutline(ctx);
  inspector = createEditorInspector(ctx);
  canvas = createEditorCanvas(ctx);
  dialogs = createEditorDialogs(ctx);
  commands = createEditorCommands(ctx);
  const keyboard = createEditorKeyboard(ctx);

  const scheduleResize = () => {
    if (disposed || resizeFrame) return;
    resizeFrame = win.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!disposed) chrome.resize();
    });
  };
  const resize =
    typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(scheduleResize) : null;
  const onSession = (event) => {
    if (disposed) return;
    canvas.draw(event);
  };
  const unsubscribe = session.subscribe(onSession);
  const onColorScheme = () => {
    if (!hostScheme) canvas.draw({ type: 'refresh', affectedIds: [] });
  };
  shell.addEventListener('click', commands.click);
  stage.addEventListener('pointerdown', canvas.pointerDown);
  stage.addEventListener('pointermove', canvas.pointerMove);
  stage.addEventListener('pointerup', canvas.pointerUp);
  stage.addEventListener('pointercancel', canvas.pointerCancel);
  stage.addEventListener('lostpointercapture', canvas.lostPointerCapture);
  stage.addEventListener('wheel', canvas.wheel, { passive: false });
  doc.addEventListener('keydown', keyboard.keydown);
  doc.addEventListener('focusin', keyboard.focusin);
  doc.addEventListener('keyup', keyboard.keyup);
  win.addEventListener('blur', canvas.blur);
  colorScheme?.addEventListener?.('change', onColorScheme);
  doc.addEventListener('pointerdown', chrome.pointerDownOutside);
  if (resize) {
    resize.observe(shell);
    resize.observe(stage);
  } else win.addEventListener('resize', scheduleResize);
  canvas.draw();
  scheduleResize();
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      resize?.disconnect();
      win.cancelAnimationFrame(resizeFrame);
      win.cancelAnimationFrame(announcementFrame);
      inspector.dispose();
      dialogs.dispose();
      shell.removeEventListener('click', commands.click);
      stage.removeEventListener('pointerdown', canvas.pointerDown);
      stage.removeEventListener('pointermove', canvas.pointerMove);
      stage.removeEventListener('pointerup', canvas.pointerUp);
      stage.removeEventListener('pointercancel', canvas.pointerCancel);
      stage.removeEventListener('lostpointercapture', canvas.lostPointerCapture);
      stage.removeEventListener('wheel', canvas.wheel);
      if (!resize) win.removeEventListener('resize', scheduleResize);
      doc.removeEventListener('keydown', keyboard.keydown);
      doc.removeEventListener('focusin', keyboard.focusin);
      doc.removeEventListener('keyup', keyboard.keyup);
      doc.removeEventListener('pointerdown', chrome.pointerDownOutside);
      win.removeEventListener('blur', canvas.blur);
      colorScheme?.removeEventListener?.('change', onColorScheme);
      shell.remove();
      canvas.dispose();
    },
    refresh(bundle) {
      return session.refresh(bundle);
    },
    openSourcePanel: dialogs.openSourcePanel,
    setColorScheme(next) {
      hostScheme = colorSchemeOf(next);
      applyColorScheme();
      canvas.draw({ type: 'refresh', affectedIds: [] });
    },
    openPanel(id) {
      if (disposed || !inspector.panes().has(id)) return false;
      chrome.setRail('right', true);
      chrome.render(ctx.current(), { force: true });
      inspector.showTab(id, { focus: true });
      return inspector.tab() === id;
    },
    refreshHost() {
      if (disposed) return;
      chrome.render(ctx.current(), { force: true });
    },
    getState() {
      return session.getState();
    },
  };
}
