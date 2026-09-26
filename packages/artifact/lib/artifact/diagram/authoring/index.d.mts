import type {
  DiagramAuthoringBundle,
  DiagramAuthoringContainer,
  DiagramAuthoringValidationError,
  DiagramBounds,
  DiagramEditOperation,
  DiagramEditTransaction,
  DiagramFidelityReport,
  DiagramPlacement,
  DiagramSemanticEntry,
} from '@openplanr/protocol/diagram-authoring-contracts';

export type {
  DiagramAuthoringBundle,
  DiagramAuthoringValidationError,
  DiagramEditTransaction,
} from '@openplanr/protocol/diagram-authoring-contracts';

export type DiagramJsonValue =
  | null
  | boolean
  | number
  | string
  | DiagramJsonValue[]
  | { [key: string]: DiagramJsonValue };
export interface DiagramKernelFailure {
  ok: false;
  diagnostics: DiagramAuthoringValidationError[];
  deletionImpact?: DiagramDeletionImpact;
  disclosures?: DiagramCommandDisclosures;
}
export interface DiagramEditImpact {
  affectedIds: string[];
  readIds: string[];
  writeIds: string[];
}
export interface DiagramFieldChange {
  collection:
    | 'nodes'
    | 'relations'
    | 'groups'
    | 'lanes'
    | 'annotations'
    | 'emphasis'
    | 'document'
    | 'elements'
    | 'presentation'
    | 'source-map';
  elementId: string | null;
  path: string[];
  before: DiagramJsonValue;
  after: DiagramJsonValue;
}
export interface DiagramBundleDiff {
  semantic: DiagramFieldChange[];
  presentation: DiagramFieldChange[];
}
export interface DiagramConditionalInverse {
  diagramId: string;
  transactionId: string;
  changes: DiagramBundleDiff & { sourceMap: DiagramFieldChange[] };
  dependencies: Array<{ elementId: string; value: DiagramJsonValue }>;
  positions: Array<{ elementId: string; semanticIndex: number; presentationIndex: number }>;
  emphasisOrder: string[];
}
export interface DiagramEditPreview {
  ok: true;
  bundle: DiagramAuthoringBundle;
  transaction: DiagramEditTransaction;
  diff: DiagramBundleDiff;
  impact: DiagramEditImpact;
  inverse: DiagramConditionalInverse;
  disclosures?: DiagramCommandDisclosures;
}
export type DiagramPreviewResult = DiagramEditPreview | DiagramKernelFailure;
export interface DiagramTransactionIdentity {
  transactionId: string;
}

export interface DiagramDeletionImpact {
  elementIds: string[];
  relationIds: string[];
  annotationIds: string[];
  membershipIds: string[];
  readingOrderIds: string[];
  emphasisIds: string[];
}
export type DiagramCommandDisclosures =
  | { excludedRelationIds: string[]; detachedAnnotationIds: string[] }
  | { deletionImpact: DiagramDeletionImpact };
export type DiagramCommand =
  | { type: 'create'; elements: DiagramSemanticEntry[]; presentation: DiagramPlacement[] }
  | { type: 'rename'; id: string; label: string }
  | { type: 'describe'; id: string; description: string | null }
  | { type: 'reconnect'; id: string; from: string; to: string }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'resize'; id: string; bounds: DiagramBounds }
  | {
      type: 'geometry';
      changes: Extract<DiagramEditOperation, { type: 'set-geometry' }>['changes'];
    }
  | {
      type: 'appearance';
      changes: Extract<DiagramEditOperation, { type: 'set-appearance-locks' }>['changes'];
    }
  | { type: 'reparent'; ids: string[]; parentId: string | null; index?: number }
  | {
      type: 'group';
      group: Pick<DiagramAuthoringContainer, 'id' | 'label'>;
      ids: string[];
      placement: DiagramPlacement;
      parentId?: string | null;
    }
  | { type: 'ungroup' | 'reorder-lanes'; ids: string[] }
  | { type: 'duplicate'; ids: string[]; idMap: Record<string, string>; dx?: number; dy?: number }
  | {
      type: 'paste';
      sourceBundle: DiagramAuthoringBundle;
      ids: string[];
      idMap: Record<string, string>;
      dx?: number;
      dy?: number;
    }
  | { type: 'delete'; ids: string[]; confirmedImpact?: DiagramDeletionImpact }
  | { type: 'cancel' };
export type DiagramCommandResult =
  | DiagramPreviewResult
  | { ok: true; cancelled: true; transaction: null }
  | { ok: true; changed: false; transaction: null };

/** Compiles one command into an atomic preview. It never allocates IDs or saves content. */
export declare function compileDiagramCommand(
  bundle: DiagramAuthoringBundle,
  command: DiagramCommand,
  options: DiagramTransactionIdentity,
): DiagramCommandResult;
export declare function compileDiagramCommand(
  bundle: DiagramAuthoringBundle,
  command: { type: 'cancel' },
  options?: DiagramTransactionIdentity,
): { ok: true; cancelled: true; transaction: null } | DiagramKernelFailure;

/** Validates inert content and final diagram invariants without modifying input. */
export declare function validateAuthoringBundle(
  bundle: unknown,
): { ok: true; diagnostics: [] } | DiagramKernelFailure;
/** Applies an exact-base transaction to an isolated preview; it does not persist it. */
export declare function previewDiagramTransaction(
  bundle: DiagramAuthoringBundle,
  transaction: DiagramEditTransaction,
): DiagramPreviewResult;
/** Compares identity-keyed content; derived digests are excluded from user changes. */
export declare function diffDiagramBundles(
  before: DiagramAuthoringBundle,
  after: DiagramAuthoringBundle,
): ({ ok: true; impact: DiagramEditImpact } & DiagramBundleDiff) | DiagramKernelFailure;
/** Checks current affected fields before constructing a newly based compensating edit. */
export declare function createConditionalInverse(
  bundle: DiagramAuthoringBundle,
  inverse: DiagramConditionalInverse,
  options: DiagramTransactionIdentity,
): { ok: true; transaction: DiagramEditTransaction } | DiagramKernelFailure;

export * from './layout.mjs';
export {
  type AuthoredDiagramRenderFailure,
  type AuthoredDiagramSvgResult,
  type AuthoredDiagramTheme,
  renderAuthoredDiagramSvg,
} from './renderer.mjs';
export {
  type AuthoredDiagramScene,
  type AuthoredDiagramSceneElement,
  type DiagramSceneDiagnostic,
  type DiagramSceneFailure,
  type DiagramSceneQuality,
  type DiagramSceneText,
  resolveDiagramScene,
} from './scene.mjs';

export interface MermaidCopyDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  line: number;
  column: number;
  range: { startByte: number; endByte: number } | null;
  message: string;
  repair: string;
  elementIds: string[];
}
export type MermaidCopyPreview =
  | { ok: false; sourceModified: false; diagnostics: MermaidCopyDiagnostic[] }
  | {
      ok: true;
      bundle: DiagramAuthoringBundle;
      fidelity: DiagramFidelityReport;
      diagnostics: MermaidCopyDiagnostic[];
      requiresAcknowledgement: boolean;
      acknowledgement: string | null;
      sourceModified: false;
    };
/** Browser-safe, non-mutating certified flowchart copy preview. */
export declare function previewMermaidCopy(
  source: string,
  options?: { diagramId?: string; title?: string; previousBundle?: DiagramAuthoringBundle | null },
): MermaidCopyPreview;
/** Returns a detached bundle only after the exact preview's losses are acknowledged. */
export declare function adoptMermaidCopy(
  preview: MermaidCopyPreview,
  acknowledgement?: string | null,
):
  | { ok: true; bundle: DiagramAuthoringBundle; sourceModified: false }
  | { ok: false; sourceModified: false; diagnostics: MermaidCopyDiagnostic[] };
/** Produces canonical Mermaid text with dimension-specific fidelity; never writes files. */
export declare function exportMermaidCopy(bundle: DiagramAuthoringBundle):
  | {
      ok: true;
      text: string;
      fidelity: DiagramFidelityReport;
      diagnostics: MermaidCopyDiagnostic[];
      bundleUnchanged: true;
    }
  | { ok: false; diagnostics: MermaidCopyDiagnostic[] };
