/// <reference lib="dom" />
import type {
  DiagramAuthoringBundle,
  DiagramEditTransaction,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramCommand, DiagramCommandResult } from '../diagram/authoring/index.mjs';
import type {
  DiagramEditorSession,
  DiagramEditorState,
  DiagramEditorView,
} from '../diagram/editor/index.mjs';
import type {
  DiagramEditorHostAction,
  DiagramEditorHostPanel,
  mountDiagramEditor,
} from './diagram-editor.d.mts';

/** Internal contracts between the regions of one mounted editor; not a public API. */

export type DiagramEditorHostOptions = NonNullable<
  Parameters<typeof mountDiagramEditor>[0]['host']
>;
export type DiagramEditorLabels = Required<NonNullable<DiagramEditorHostOptions['labels']>>;
export type DiagramEditorColorScheme = 'light' | 'dark' | null;
export type DiagramEditorTool = 'select' | 'pan';
export type DiagramEditorRail = 'left' | 'right';
export type DiagramEditorLeftTab = 'outline' | 'shapes';
export interface DiagramEditorPoint {
  x: number;
  y: number;
}
/** An edit refused because the inspector holds unapplied property changes. */
export interface DiagramEditorDraftRefusal {
  ok: false;
  status: 'property-draft';
}

/** Host options after validation. */
export interface DiagramEditorHostConfig {
  labels: DiagramEditorLabels;
  actions: DiagramEditorHostAction[];
  panels: DiagramEditorHostPanel[];
  reviewEnabled: boolean;
  colorScheme: DiagramEditorColorScheme;
}
/** Throws a TypeError naming the first invalid option. */
export declare function readHostOptions(host: DiagramEditorHostOptions): DiagramEditorHostConfig;
export declare function colorSchemeOf(value: unknown): DiagramEditorColorScheme;
/** The host's save-state wording, or null to keep the editor's own. */
export declare function hostSaveLabel(
  host: DiagramEditorHostOptions,
  state: DiagramEditorState,
): string | null;

/** Static nodes of the editor chrome; none is replaced while the editor is mounted. */
export interface DiagramEditorSkeleton {
  shell: HTMLElement;
  bar: HTMLElement;
  barStart: HTMLElement;
  barCenter: HTMLElement;
  barEnd: HTMLElement;
  mark: HTMLElement;
  title: HTMLElement;
  subtitle: HTMLElement;
  saveState: HTMLElement;
  moreWrap: HTMLElement;
  work: HTMLElement;
  drawerBackdrop: HTMLButtonElement;
  left: HTMLElement;
  leftTabs: HTMLElement;
  closeOutline: HTMLButtonElement;
  outlinePane: HTMLElement;
  shapesPane: HTMLElement;
  stageRegion: HTMLElement;
  stage: HTMLElement;
  svg: SVGSVGElement;
  world: SVGGElement;
  overlays: SVGGElement;
  empty: HTMLElement;
  canvasTools: HTMLElement;
  footer: HTMLElement;
  right: HTMLElement;
  rightTabs: HTMLElement;
  closeProperties: HTMLButtonElement;
  rightContent: HTMLElement;
  propertiesPane: HTMLElement;
  reviewPane: HTMLElement;
  alert: HTMLElement;
  announcer: HTMLElement;
  dialogLayer: HTMLElement;
}
/** Controls added to the skeleton once the host options are known. */
export interface DiagramEditorControls {
  hostPanes: Map<string, HTMLElement>;
  moreButton: HTMLButtonElement;
  moreMenu: HTMLElement;
  zoomValue: HTMLOutputElement;
}
export type DiagramEditorDom = DiagramEditorSkeleton & DiagramEditorControls;
export declare function renderEditorSkeleton(
  doc: Document,
  scopedId: (name: string) => string,
): DiagramEditorSkeleton;
export declare function renderEditorControls(
  doc: Document,
  dom: DiagramEditorSkeleton,
  options: {
    scopedId: (name: string) => string;
    actions: DiagramEditorHostAction[];
    panels: DiagramEditorHostPanel[];
  },
): DiagramEditorControls;

/** Breakpoint tiers measured from the shell's own width. */
export interface DiagramEditorLayout {
  drawer(): boolean;
  compact(): boolean;
  /** Re-measure the shell; true when the layout tier changed. */
  measure(): boolean;
}
export declare function createEditorLayout(shell: HTMLElement, win: Window): DiagramEditorLayout;

export interface DiagramEditorChrome {
  /** Re-render the chrome; panels rebuild only when their stamp changed, or always with `force`. */
  render(state: DiagramEditorState, options?: { force?: boolean }): void;
  setRail(
    side: DiagramEditorRail,
    open: boolean,
    options?: { focusPanel?: boolean; restoreFocus?: boolean },
  ): void;
  closeDrawers(options?: { restoreFocus?: boolean }): void;
  setOverflow(open: boolean, options?: { focus?: boolean; restoreFocus?: boolean }): void;
  setBackgroundInert(inert: boolean): void;
  railOpen(side: DiagramEditorRail): boolean;
  overflowOpen(): boolean;
  resize(): void;
  pointerDownOutside(event: PointerEvent): void;
}
export interface DiagramEditorOutline {
  tab(): DiagramEditorLeftTab;
  showTab(next: DiagramEditorLeftTab, options?: { focus?: boolean }): void;
  /** Choose the tab the next render shows without touching the DOM. */
  preferTab(next: DiagramEditorLeftTab): void;
  render(state: DiagramEditorState): void;
  toggleGroup(id: string): void;
  focusRow(row: HTMLElement | null | undefined): void;
}
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
export interface DiagramEditorCanvas {
  tool(): DiagramEditorTool;
  setTool(tool: DiagramEditorTool): void;
  setTemporaryPan(active: boolean): void;
  dragging(): boolean;
  cancelDrag(): void;
  draw(event?: { type: string; affectedIds?: string[] }): void;
  fit(): void;
  zoom(factor: number, around?: DiagramEditorPoint): void;
  cameraPatch(camera: DiagramEditorView['camera']): void;
  worldPoint(point: DiagramEditorPoint, camera?: DiagramEditorView['camera']): DiagramEditorPoint;
  pointerDown(event: PointerEvent): void;
  pointerMove(event: PointerEvent): void;
  pointerUp(event: PointerEvent): void;
  pointerCancel(event: PointerEvent): void;
  lostPointerCapture(event: PointerEvent): void;
  wheel(event: WheelEvent): void;
  blur(): void;
  dispose(): void;
}
export interface DiagramEditorDialogs {
  active(): HTMLElement | null;
  close(options?: { restoreFocus?: boolean }): void;
  /** Close the open dialog, cancelling any gesture it previewed. */
  cancel(state: DiagramEditorState): void;
  openSourcePanel(options?: { tab?: 'import' | 'export' }): boolean;
  openDelete(): void;
  confirmDelete(ids: string[]): void;
  openConnect(): void;
  confirmConnect(): void;
  openLayout(lane?: 'horizontal' | 'vertical' | null): void;
  previewLayout(state: DiagramEditorState, bundle: DiagramAuthoringBundle, ids: string[]): void;
  applyLayout(): void;
  cancelLayout(): void;
  showJson(title: string, value: unknown): void;
  compareRevisions(): void;
  dispose(): void;
}
export interface DiagramEditorCommands {
  /** Run one `data-action`; unknown actions do nothing. */
  act(
    action: string,
    value?: unknown,
    options?: { additive?: boolean; fromOutline?: boolean },
  ): void;
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
export interface DiagramEditorKeyboard {
  keydown(event: KeyboardEvent): void;
  focusin(event: FocusEvent): void;
  keyup(event: KeyboardEvent): void;
}
export type DiagramEditorShortcut =
  | { type: 'temporary-pan' }
  | { type: 'tool'; tool: DiagramEditorTool }
  | { type: 'command'; action: 'save' | 'undo' | 'redo' | 'copy' | 'paste' | 'delete' }
  | { type: 'nudge'; dx: number; dy: number; delta: number };
/** The editor shortcut a key press maps to, or null when it is not one. */
export declare function editorShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  context: { selection: boolean; clipboard: boolean; editable: boolean },
): DiagramEditorShortcut | null;

/** Shared by every region of one mounted editor. */
export interface DiagramEditorContext {
  readonly doc: Document;
  readonly win: Window & typeof globalThis;
  readonly session: DiagramEditorSession;
  readonly host: DiagramEditorHostOptions;
  readonly config: DiagramEditorHostConfig;
  readonly dom: DiagramEditorDom;
  readonly layout: DiagramEditorLayout;
  readonly mode: 'edit';
  scopedId(name: string): string;
  isDisposed(): boolean;
  current(): DiagramEditorState;
  /** The gesture preview when one is active, else the committed bundle. */
  displayed(state: DiagramEditorState): DiagramAuthoringBundle | null;
  editable(state: DiagramEditorState): boolean;
  readOnly(state: DiagramEditorState): boolean;
  prefersDark(): boolean;
  /** Announce through the polite live region; a repeated message is re-announced. */
  notice(message: string): void;
  /** Show an error in the alert region, or clear it with an empty message. */
  report(message: string): void;
  chrome: DiagramEditorChrome;
  outline: DiagramEditorOutline;
  inspector: DiagramEditorInspector;
  canvas: DiagramEditorCanvas;
  dialogs: DiagramEditorDialogs;
  commands: DiagramEditorCommands;
}
export declare function createEditorChrome(ctx: DiagramEditorContext): DiagramEditorChrome;
export declare function createEditorOutline(ctx: DiagramEditorContext): DiagramEditorOutline;
export declare function createEditorInspector(ctx: DiagramEditorContext): DiagramEditorInspector;
export declare function createEditorCanvas(ctx: DiagramEditorContext): DiagramEditorCanvas;
export declare function createEditorDialogs(ctx: DiagramEditorContext): DiagramEditorDialogs;
export declare function createEditorCommands(ctx: DiagramEditorContext): DiagramEditorCommands;
/** Create last: it reads the other regions from ctx when it is created. */
export declare function createEditorKeyboard(ctx: DiagramEditorContext): DiagramEditorKeyboard;
