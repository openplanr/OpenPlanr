import { getDiagramAuthoringCapability } from '@openplanr/protocol/diagram-authoring-contracts';
import type { VersionedDiagramAuthoringBundle as DiagramAuthoringBundle } from '@openplanr/protocol/studio-presentation-contracts';
import type {
  DiagramEditorEvent,
  DiagramEditorSession,
  DiagramEditorState,
} from '../diagram/editor/index.mjs';
import { readEditorState } from '../diagram/editor/session-view.mjs';
import { createEditorCanvas } from './diagram-editor-canvas.mjs';
import { createEditorChrome, createEditorLayout } from './diagram-editor-chrome.mjs';
import { createEditorCommands } from './diagram-editor-commands.mjs';
import { createEditorDialogs } from './diagram-editor-dialogs.mjs';
import { icon } from './diagram-editor-dom.mjs';
import {
  colorSchemeOf,
  type DiagramEditorHostOptions,
  readHostOptions,
} from './diagram-editor-host.mjs';
import { createEditorInspector } from './diagram-editor-inspector.mjs';
import { createEditorKeyboard } from './diagram-editor-keyboard.mjs';
import { createEditorOutline } from './diagram-editor-outline.mjs';
import type { DiagramEditorContext } from './diagram-editor-regions.mjs';
import { renderEditorControls, renderEditorSkeleton } from './diagram-editor-template.mjs';
import { mountDiagramEditorChrome } from './studio-shell-mount.mjs';

/** Every icon the editor can render; hosts may use any of them on actions and panels. */
export type DiagramEditorIconName =
  | 'panel'
  | 'undo'
  | 'redo'
  | 'save'
  | 'more'
  | 'select'
  | 'pan'
  | 'snap'
  | 'snap-off'
  | 'fit'
  | 'search'
  | 'properties'
  | 'review'
  | 'copy'
  | 'duplicate'
  | 'lock'
  | 'unlock'
  | 'trash'
  | 'arrange'
  | 'group'
  | 'ungroup'
  | 'connect'
  | 'parent'
  | 'route'
  | 'content'
  | 'geometry'
  | 'appearance'
  | 'structure'
  | 'constraints'
  | 'advanced'
  | 'plus'
  | 'minus'
  | 'arrow-up'
  | 'arrow-down'
  | 'mark'
  | 'chevron'
  | 'share'
  | 'history'
  | 'kind-container'
  | 'kind-lane'
  | 'kind-lane-vertical'
  | 'kind-terminal'
  | 'kind-process'
  | 'kind-decision'
  | 'kind-store'
  | 'kind-component'
  | 'kind-connector'
  | 'kind-annotation';

/** A command added by the host after Save. Lowercase ids; hooks re-run whenever the editor state changes. */
export interface DiagramEditorHostAction {
  id: string;
  label: string;
  icon?: DiagramEditorIconName;
  primary?: boolean;
  disabled?: (state: DiagramEditorState) => boolean;
  hidden?: (state: DiagramEditorState) => boolean;
  onSelect(context: {
    session: DiagramEditorSession;
    state: DiagramEditorState;
    trigger: HTMLButtonElement;
  }): void;
}

/** A right-panel tab owned by the host, mounted the first time it opens. `properties`, `review`, `outline`, `shapes`, `more`, `canvas` and `inspector` are reserved ids. */
export interface DiagramEditorHostPanel {
  id: string;
  label: string;
  /** Checked against the icon set at mount and rendered alongside its tab label. */
  icon?: DiagramEditorIconName;
  hidden?: (state: DiagramEditorState) => boolean;
  mount(options: {
    /** Clicks inside this element never reach the editor's action dispatcher, so host controls may carry `data-action`. */
    root: HTMLElement;
    session: DiagramEditorSession;
    select: (ids: string[]) => unknown;
    close: () => void;
  }): (() => void) | null | void;
}
interface MountOptions {
  root: HTMLElement;
  session: DiagramEditorSession;
  host?: DiagramEditorHostOptions;
}
/** The handle a host keeps for one mounted editor. */
interface MountedEditor {
  dispose(): void;
  refresh(bundle: DiagramAuthoringBundle): ReturnType<DiagramEditorSession['refresh']>;
  openSourcePanel(options?: { tab?: 'import' | 'export' }): boolean;
  getState(): DiagramEditorState;
  /** Pass null to follow the operating system again. */
  setColorScheme(scheme: 'light' | 'dark' | null): void;
  /** Open a right-panel tab by id; returns false when it is unavailable. */
  openPanel(id: string): boolean;
  /** Re-evaluate host action and panel hooks after host data changes. */
  refreshHost(): void;
}

const ID_PREFIX = 'diagram';
let mountCount = 0;
const windowOf = (document: Document) => {
  const view = document.defaultView;
  if (!view) throw new TypeError('Mount needs a root inside a live document.');
  return view;
};

/**
 * Mount the same browser-safe editor in local and company owner shells.
 * The editor sizes its chrome from its own root, not the window, and prefixes every element id
 * per mount so several editors can share one document; hosts must not depend on those ids.
 * The supplied session remains owned by its host.
 */
export function mountDiagramEditor({ root, session, host = {} }: MountOptions): MountedEditor {
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
  const scopedId = (name: string) => `${idPrefix}-${name}`;
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

  const notice = (message: string) => {
    win.cancelAnimationFrame(announcementFrame);
    if (message === lastAnnouncement) {
      dom.announcer.textContent = '';
      announcementFrame = win.requestAnimationFrame(() => {
        if (!disposed) dom.announcer.textContent = message;
      });
    } else dom.announcer.textContent = message;
    lastAnnouncement = message;
  };
  const report = (message: string) => {
    dom.alert.hidden = !message;
    dom.alert.textContent = message || '';
    if (message) notice(message);
  };
  // The capability lookup returns null for a missing grammar id, as when access changed.
  const editable = (state: DiagramEditorState) =>
    state.capabilities.read &&
    state.capabilities.write &&
    state.saveState !== 'access-changed' &&
    !!getDiagramAuthoringCapability(state.bundle?.document.grammar.id as string);
  const readOnly = (state: DiagramEditorState) =>
    state.capabilities.read && !state.capabilities.write;
  const displayed = (state: DiagramEditorState) => state.gesture?.bundle ?? state.bundle;
  const prefersDark = () => (hostScheme ? hostScheme === 'dark' : !!colorScheme?.matches);

  // Every region is assigned before a getter is read: regions call each other only from
  // handlers, and the keyboard, which reads them when created, is created last.
  let chrome: DiagramEditorContext['chrome'];
  let outline: DiagramEditorContext['outline'];
  let inspector: DiagramEditorContext['inspector'];
  let canvas: DiagramEditorContext['canvas'];
  let dialogs: DiagramEditorContext['dialogs'];
  let commands: DiagramEditorContext['commands'];
  const ctx: DiagramEditorContext = {
    doc,
    win,
    session,
    host,
    config,
    dom,
    layout,
    scopedId,
    isDisposed: () => disposed,
    current: () => readEditorState(session),
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
  const reactChrome = mountDiagramEditorChrome(ctx);

  const scheduleResize = () => {
    if (disposed || resizeFrame) return;
    resizeFrame = win.requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!disposed) chrome.resize();
    });
  };
  const resize =
    typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(scheduleResize) : null;
  const onSession = (event: DiagramEditorEvent) => {
    if (disposed) return;
    canvas.draw(event);
    reactChrome.update();
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
      reactChrome.destroy();
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
      reactChrome.update();
    },
    getState() {
      return session.getState();
    },
  };
}
