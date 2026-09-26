/// <reference lib="dom" />
import type { DiagramAuthoringBundle } from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramEditorSession, DiagramEditorState } from '../diagram/editor/index.mjs';

export type DiagramEditorIconName =
  | 'panel'
  | 'undo'
  | 'redo'
  | 'save'
  | 'more'
  | 'share'
  | 'history'
  | 'review'
  | 'properties'
  | 'copy'
  | 'duplicate'
  | 'lock'
  | 'unlock'
  | 'trash'
  | 'plus'
  | 'search';

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

/** A right-panel tab owned by the host, mounted the first time it opens. `properties` and `review` are reserved ids. */
export interface DiagramEditorHostPanel {
  id: string;
  label: string;
  hidden?: (state: DiagramEditorState) => boolean;
  mount(options: {
    root: HTMLElement;
    session: DiagramEditorSession;
    select: (ids: string[]) => unknown;
    close: () => void;
  }): (() => void) | null | void;
}

/** Mount the same browser-safe editor in local and company owner shells. */
export declare function mountDiagramEditor(options: {
  root: HTMLElement;
  session: DiagramEditorSession;
  host?: {
    /** Re-read a verified owner revision after a rejected stale save. */
    readCurrent?: () => Promise<DiagramAuthoringBundle>;
    /** Optional real reviewer adapter. Local-only pages show a truthful unavailable state. */
    mountReview?: (options: {
      root: HTMLElement;
      session: DiagramEditorSession;
      select: (ids: string[]) => unknown;
    }) => (() => void) | null;
    /** Show the Review tab. Defaults to true. */
    review?: boolean;
    /** Replace the local wording where the host changes what is true. */
    labels?: {
      subtitle?: string;
      emptyHint?: string;
      reviewUnavailable?: string;
      readOnly?: string;
    };
    /** Name the save state in host terms, for example "Saved · revision 8"; null keeps the default. Not used for read-only views. */
    saveLabel?: (state: DiagramEditorState) => string | null;
    /** Show the OpenPlanr mark before the title. Defaults to true. */
    brand?: boolean;
    /** Follow the host's theme instead of the operating system. */
    colorScheme?: 'light' | 'dark' | null;
    actions?: DiagramEditorHostAction[];
    panels?: DiagramEditorHostPanel[];
  };
}): {
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
};
