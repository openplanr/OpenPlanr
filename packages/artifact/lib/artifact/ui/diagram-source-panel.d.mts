/// <reference lib="dom" />
import type { DiagramAuthoringBundle } from "@openplanr/protocol/diagram-authoring-contracts";
import type { DiagramEditorSession } from "../diagram/editor/index.mjs";

export interface DiagramSourcePanelController {
	focus(): void;
	selectTab(tab: "import" | "export", options?: { focus?: boolean }): void;
	getSource(): string;
	dispose(): void;
}

export interface DiagramSourcePanelOptions {
	/**
	 * Host element for the panel. Standalone hosts receive the scoped
	 * `planr-diagram-source-panel` class and must load `diagram-editor.css`.
	 */
	root: HTMLElement;
	session: Pick<DiagramEditorSession, "getState" | "adoptInitialCopy">;
	/** Exact source bytes decoded as UTF-8. CRLF is retained until the author edits. */
	source?: string;
	initialTab?: "import" | "export";
	onSourceChange?: (source: string) => void;
	onBeforeAdopt?: () => boolean;
	onNavigateElements?: (elementIds: string[]) => void;
	onAdopt?: (bundle: DiagramAuthoringBundle) => void;
	onClose?: () => void;
	onReport?: (message: string) => void;
}

/** Mount the host-neutral Mermaid copy panel used by local and company owner shells. */
export declare function mountDiagramSourcePanel(
	options: DiagramSourcePanelOptions,
): DiagramSourcePanelController;
