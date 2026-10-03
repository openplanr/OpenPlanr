import type { VersionedDiagramAuthoringBundle as DiagramAuthoringBundle } from '@openplanr/protocol/studio-presentation-contracts';

import type { DiagramEditorSession, DiagramEditorState } from '../diagram/editor/index.mjs';
import type { DiagramEditorCanvas } from './diagram-editor-canvas.mjs';
import type { DiagramEditorChrome, DiagramEditorLayout } from './diagram-editor-chrome.mjs';
import type { DiagramEditorCommands } from './diagram-editor-commands.mjs';
import type { DiagramEditorDialogs } from './diagram-editor-dialogs.mjs';
import type { DiagramEditorHostConfig, DiagramEditorHostOptions } from './diagram-editor-host.mjs';
import type { DiagramEditorInspector } from './diagram-editor-inspector.mjs';
import type { DiagramEditorOutline } from './diagram-editor-outline.mjs';
import type { DiagramEditorDom } from './diagram-editor-template.mjs';

/** Shared by every region of one mounted editor; not a public API. */
export interface DiagramEditorContext {
  readonly doc: Document;
  readonly win: Window & typeof globalThis;
  readonly session: DiagramEditorSession;
  readonly host: DiagramEditorHostOptions;
  readonly config: DiagramEditorHostConfig;
  readonly dom: DiagramEditorDom;
  readonly layout: DiagramEditorLayout;
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
