/// <reference lib="dom" />
import type { DiagramAuthoringBundle } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramEditorSession, DiagramEditorState } from '../diagram/editor/index.mjs';

/** Mount the same browser-safe editor in local and company owner shells. */
export declare function mountDiagramEditor(options: {
  root: HTMLElement;
  session: DiagramEditorSession;
  host?: {
    /** Re-read a verified owner revision after a rejected stale save. */
    readCurrent?: () => Promise<DiagramAuthoringBundle>;
    /** Optional real reviewer adapter. Local-only pages show a truthful unavailable state. */
    mountReview?: (options: {
      root: HTMLElement; session: DiagramEditorSession; select: (ids: string[]) => unknown;
    }) => (() => void) | null;
  };
}): {
  dispose(): void;
  refresh(bundle: DiagramAuthoringBundle): ReturnType<DiagramEditorSession['refresh']>;
  getState(): DiagramEditorState;
};
