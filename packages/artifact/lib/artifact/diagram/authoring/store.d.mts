import type { DiagramAuthoringBundle, DiagramEditTransaction, DiagramPreviewResult, DiagramConditionalInverse } from './index.mjs';

export interface DiagramStoreBasis {
  bundleDigest: string;
  semanticDigest: string;
  presentationDigest: string;
}
export interface DiagramStoreReceipt {
  kind: 'diagram-authoring-receipt';
  version: 1;
  diagramId: string;
  sequence: number;
  transactionId: string;
  fingerprint: string;
  base: DiagramStoreBasis | null;
  baseBytesDigest: string | null;
  result: DiagramStoreBasis;
  resultBytesDigest: string;
  inverse: DiagramConditionalInverse | null;
}
export interface DiagramStoreUnknown {
  ok: false;
  status: 'unknown';
  transactionId: string;
  fingerprint: string;
  reason: string;
  code?: string;
  path?: string;
}
export interface DiagramStoreSaved {
  ok: true;
  status: 'saved';
  bundle: DiagramAuthoringBundle;
  receipt: DiagramStoreReceipt;
  replayed: boolean;
}
export interface DiagramStoreReady {
  ok: true;
  status: 'ready';
  path: string;
  bundle: DiagramAuthoringBundle;
  byteDigest: string;
  basis: DiagramStoreBasis;
  receipt: DiagramStoreReceipt;
}
export interface DiagramStoreAbsent { ok: true; status: 'absent'; path: string }
export type DiagramStoreReadResult = DiagramStoreReady | DiagramStoreAbsent | DiagramStoreUnknown;
export type DiagramStoreSaveResult = DiagramStoreSaved | DiagramStoreUnknown;
export type DiagramStoreFaultPhase = 'before-ownership' | 'before-journal' | 'after-journal' | 'after-temporary-flush' | 'after-replacement' | 'after-receipt' | 'after-head' | 'before-acknowledgement';
export interface DiagramAuthoringStoreOptions {
  /** Existing workspace directory. Canonical sources live below diagrams/{slug}. */
  root: string;
  slug: string;
  /** Storage quota independent of presentation quality; defaults to 64 MiB. */
  maxBundleBytes?: number;
  /** Interruption testing only. This callback cannot approve or change a write. */
  faultInjector?: (phase: DiagramStoreFaultPhase) => void | Promise<void>;
}
export interface DiagramAuthoringStore {
  readonly path: string;
  read(): Promise<DiagramStoreReadResult>;
  initialize(bundle: DiagramAuthoringBundle, identity: { transactionId: string }): Promise<DiagramStoreSaveResult>;
  preview(transaction: DiagramEditTransaction): Promise<DiagramPreviewResult | DiagramStoreUnknown>;
  commit(transaction: DiagramEditTransaction): Promise<DiagramStoreSaveResult>;
  recover(identity?: { transactionId?: string; fingerprint?: string }): Promise<DiagramStoreSaved | DiagramStoreReadResult | { ok: true; status: 'not-found'; transactionId: string }>;
  /** Exact complete-file identity from a receipt, not the semantic bundle digest. */
  readSnapshot(byteDigest: string): Promise<DiagramAuthoringBundle>;
  history(page?: { limit?: number; beforeSequence?: number }): Promise<DiagramStoreReceipt[]>;
}
export declare class DiagramAuthoringStoreError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
}
/** Filesystem-only adapter. Do not import it into browser or Worker bundles. */
export declare function createDiagramAuthoringStore(options: DiagramAuthoringStoreOptions): DiagramAuthoringStore;

export * from './migration.mjs';
