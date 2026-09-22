import type {
  DiagramAuthoringBundle, DiagramEditTransaction, DiagramAuthoringValidationError,
} from '@openplanr/protocol/diagram-authoring-contracts';
import type { DiagramCommand, DiagramCommandResult, DiagramPreviewResult, DiagramBundleDiff } from '../authoring/index.mjs';
import type { DiagramStoreBasis, DiagramStoreReceipt } from '../authoring/store.mjs';
import type { DiagramGeometryIndex } from './geometry-index.mjs';
export * from './geometry-index.mjs';

export interface DiagramEditorFailure { ok: false; diagnostics: DiagramAuthoringValidationError[] }
export interface DiagramEditorTransportFailure { ok: false; status?: string; httpStatus?: number; diagnostics?: DiagramAuthoringValidationError[] }
export interface DiagramEditorTransport {
  read(): Promise<({ ok: true; status: 'ready'; bundle: DiagramAuthoringBundle } | { ok: true; status: 'absent' } | DiagramEditorTransportFailure)>;
  initialize(bundle: DiagramAuthoringBundle, identity: { transactionId: string }): Promise<DiagramEditorSaveAcknowledgement | DiagramEditorTransportFailure>;
  commit(transaction: DiagramEditTransaction): Promise<DiagramEditorSaveAcknowledgement | DiagramEditorTransportFailure>;
}
export interface DiagramEditorSaveAcknowledgement {
  ok: true; status: 'saved'; bundle: DiagramAuthoringBundle;
  receipt: Pick<DiagramStoreReceipt, 'transactionId' | 'result'>;
  replayed?: boolean;
}
export interface DiagramEditorView {
  camera: { x: number; y: number; scale: number; fit: 'all' | 'width' | null };
  selection: string[]; collapsedGroups: string[]; trace: string[]; snap: boolean;
}
export type DiagramEditorSaveState = 'saved' | 'unsaved' | 'saving' | 'offline' | 'conflict' | 'access-changed';
export interface DiagramEditorRecoveryStatus { mode: 'available' | 'memory-only'; warning: string | null }
export interface DiagramEditorRecovery {
  load(): unknown | null;
  save(draft: unknown): { ok: boolean } & DiagramEditorRecoveryStatus;
  clear(): { ok: boolean } & DiagramEditorRecoveryStatus;
  status(): DiagramEditorRecoveryStatus;
}
export interface DiagramEditorState {
  bundle: DiagramAuthoringBundle | null;
  acknowledged: DiagramStoreBasis | null;
  pendingCount: number; needsInitialization: boolean;
  saveState: DiagramEditorSaveState;
  capabilities: { read: boolean; write: boolean };
  view: DiagramEditorView;
  gesture: { transactionId: string; basis: string; diagnostics: DiagramAuthoringValidationError[]; bundle: DiagramAuthoringBundle | null } | null;
  canUndo: boolean; canRedo: boolean;
  comparison: { bundle: DiagramAuthoringBundle; diff: DiagramBundleDiff | DiagramEditorFailure } | null;
  diagnostics: DiagramAuthoringValidationError[];
  recovery: DiagramEditorRecoveryStatus;
  disposed: boolean;
}
export interface DiagramEditorEvent { type: string; affectedIds: string[]; revision: string; saveState: DiagramEditorSaveState }
export interface DiagramEditorSession {
  getState(): DiagramEditorState;
  submit(command: DiagramCommand, options?: { transactionId?: string }): DiagramCommandResult;
  submitTransaction(transaction: DiagramEditTransaction): DiagramCommandResult;
  beginGesture(options?: { transactionId?: string }): { ok: true } | DiagramEditorFailure;
  /** Delta commands are always relative to the gesture's original content. */
  previewGesture(command: DiagramCommand): DiagramCommandResult;
  previewLayout(options: { targetIds: string[]; columns?: number; gap?: number }): DiagramPreviewResult;
  completeGesture(): DiagramCommandResult;
  cancelGesture(reason?: string): { ok: true; cancelled: boolean; reason?: string };
  undo(options?: { transactionId?: string }): DiagramCommandResult;
  redo(options?: { transactionId?: string }): DiagramCommandResult;
  refresh(bundle: DiagramAuthoringBundle): { ok: true; changed: boolean } | DiagramEditorFailure;
  save(): Promise<({ ok: true; status: DiagramEditorSaveState; bundle?: DiagramAuthoringBundle | null } | DiagramEditorFailure)>;
  setView(patch: Partial<DiagramEditorView>): { ok: true } | DiagramEditorFailure;
  query(input: { x: number; y: number; tolerance?: number }): ReturnType<DiagramGeometryIndex['query']>;
  geometry(id: string): ReturnType<DiagramGeometryIndex['get']>;
  geometryStats(): ReturnType<DiagramGeometryIndex['stats']>;
  subscribe(listener: (event: DiagramEditorEvent) => void): () => void;
  setCapabilities(capabilities: { read: boolean; write: boolean }): void;
  /** Explicitly discard the pending draft after the caller offers comparison/export. */
  useAuthoritative(): { ok: true } | DiagramEditorFailure;
  dispose(): void;
}
export interface DiagramEditorOptions {
  bundle: DiagramAuthoringBundle;
  /** Set only after reading this bundle from the authoritative owner. Defaults to false. */
  acknowledged?: boolean;
  transport?: DiagramEditorTransport | null;
  recovery?: DiagramEditorRecovery | null;
  nextTransactionId?: () => string;
  capabilities?: { read: boolean; write: boolean };
}
export declare function createDiagramEditorSession(options: DiagramEditorOptions): DiagramEditorSession;
export declare function openDiagramEditorSession(options: Omit<DiagramEditorOptions, 'bundle' | 'acknowledged' | 'transport'> & { transport: DiagramEditorTransport; create?: DiagramAuthoringBundle }): Promise<DiagramEditorSession>;
export declare function createDiagramEditorDraft(options: { diagramId: string; title: string; grammar?: 'flowchart' | 'process' | 'swimlane' | 'architecture'; template?: DiagramAuthoringBundle | null }): { ok: true; bundle: DiagramAuthoringBundle } | DiagramEditorFailure;
export interface DiagramSelectionClipboard { kind: 'openplanr-diagram-selection'; version: 1; sourceBundle: DiagramAuthoringBundle; ids: string[] }
export declare function copyDiagramSelection(bundle: DiagramAuthoringBundle, ids: string[]): { ok: true; value: DiagramSelectionClipboard } | DiagramEditorFailure;
export declare function pasteDiagramSelection(bundle: DiagramAuthoringBundle, input: unknown, options: { idMap: Record<string, string>; transactionId: string; dx?: number; dy?: number }): DiagramCommandResult;
export declare function createDiagramEditorRecovery(options: {
  /** Supply sessionStorage or a storage adapter; do not store owner URLs/tokens. */
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): unknown; removeItem(key: string): unknown } | null;
  /** Use the scope returned by the authenticated local owner, never unverified document input. */
  scope: { sessionId: string; diagramId: string }; maxBytes?: number;
}): DiagramEditorRecovery;
export interface DiagramOwnerHttpResponse {
  ok: boolean; status: number; headers: { get(name: string): string | null };
  body: { getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>; releaseLock(): void;
  } } | null;
}
export interface DiagramLocalOwnerReadMetadata {
  diagramId: string;
  /** Opaque namespace from the authenticated owner, safe for a recovery storage key. */
  recoveryScope: string;
  capabilities: { read: boolean; write: boolean };
}
export interface DiagramLocalOwnerTransport extends DiagramEditorTransport {
  read(): Promise<
    ({ ok: true; status: 'ready'; bundle: DiagramAuthoringBundle } & DiagramLocalOwnerReadMetadata)
    | ({ ok: true; status: 'absent' } & DiagramLocalOwnerReadMetadata)
    | DiagramEditorTransportFailure
  >;
  recover(identity?: { transactionId?: string; fingerprint?: string }): Promise<unknown>;
}
export declare function createDiagramLocalOwnerTransport(options: {
  apiBase: string;
  fetch?: (url: string, options: { method: string; credentials: 'omit'; redirect: 'error'; cache: 'no-store'; headers: Record<string, string>; body?: string }) => Promise<DiagramOwnerHttpResponse>;
  origin?: string; maxResponseBytes?: number;
}): DiagramLocalOwnerTransport;
export declare function bindDiagramEditorCancellation(session: Pick<DiagramEditorSession, 'cancelGesture'>, target: {
  addEventListener(type: string, listener: (event: { type: string; key?: string }) => void, capture: boolean): void;
  removeEventListener(type: string, listener: (event: { type: string; key?: string }) => void, capture: boolean): void;
}): () => void;
