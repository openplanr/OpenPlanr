import type {
  DiagramAuthoringBundle,
  DiagramEditOperation,
  DiagramEditTransaction,
} from './diagram-authoring-contracts.mjs';
import type { DiagramReviewBundle } from './diagram-review-contracts.mjs';
export interface DiagramPresentation {
  kind: 'openplanr-diagram-presentation';
  schemaVersion: '2.0.0';
  palette: 'openplanr-brand-v2';
  theme: 'light' | 'dark';
  fontFamily: 'Inter';
}
export type DiagramReviewBundleV11 = Omit<DiagramReviewBundle, 'schemaVersion' | 'authored'> & {
  schemaVersion: '1.1.0';
  presentation: DiagramPresentation;
  authored?: VersionedDiagramAuthoringBundle;
};
export declare const DIAGRAM_PRESENTATION_SCHEMA: Record<string, unknown>;
export declare const DIAGRAM_REVIEW_BUNDLE_V11_SCHEMA: Record<string, unknown>;
/** Rejects non-inert or over-budget data before reading presentation fields; retains input identity. */
export declare function assertDiagramPresentation<T>(value: T): T;
export declare function normalizeDiagramPresentation(options?: {
  theme?: 'light' | 'dark';
}): DiagramPresentation;
export declare function assertDiagramReviewBundleV11<T>(value: T): T;
export declare function assertVersionedDiagramReviewBundle<T>(value: T): T;

export declare function versionedDiagramReviewBundleDigest(value: unknown): string;

export declare const DIAGRAM_AUTHORING_BUNDLE_V11_SCHEMA: Record<string, unknown>;
export declare const DIAGRAM_EDIT_TRANSACTION_V11_SCHEMA: Record<string, unknown>;
export declare function legacyDiagramAuthoringProjection(
  value: VersionedDiagramAuthoringBundle,
): DiagramAuthoringBundle;
export declare function assertVersionedDiagramAuthoringBundle<T>(value: T): T;
/** Inspects both the value and supplied context before version inference or schema validation. */
export declare function assertVersionedDiagramEditTransaction<T>(
  value: T,
  options?: { baseBundle?: unknown; bundle?: unknown },
): T;

export declare function versionedDiagramAuthoringBundleDigest(value: unknown): string;
export declare function validateVersionedDiagramAuthoringBundle(
  value: unknown,
): Array<{ path: string; rule: string; detail: string }>;
export declare function validateVersionedDiagramEditTransaction(
  value: unknown,
  options?: { baseBundle?: unknown; bundle?: unknown },
): Array<{ path: string; rule: string; detail: string }>;

export type DiagramAuthoringBundleV11 = Omit<
  DiagramAuthoringBundle,
  'schemaVersion' | 'protocolVersion'
> & { schemaVersion: '1.1.0'; protocolVersion: '1.17.0'; studioPresentation: DiagramPresentation };
export type VersionedDiagramAuthoringBundle = DiagramAuthoringBundle | DiagramAuthoringBundleV11;
export interface SetStudioPresentationOperation {
  type: 'set-studio-presentation';
  before: DiagramPresentation | null;
  after: DiagramPresentation | null;
}
export type DiagramEditTransactionV11 = Omit<
  DiagramEditTransaction,
  'schemaVersion' | 'protocolVersion' | 'operations'
> & {
  schemaVersion: '1.1.0';
  protocolVersion: '1.17.0';
  operations: Array<DiagramEditOperation | SetStudioPresentationOperation>;
};
export type VersionedDiagramEditTransaction = DiagramEditTransaction | DiagramEditTransactionV11;

export declare function validateVersionedDiagramAuthoringArtifact(
  kind: string,
  value: unknown,
  options?: {
    document?: unknown;
    bundle?: VersionedDiagramAuthoringBundle;
    baseBundle?: VersionedDiagramAuthoringBundle;
    sourceText?: string;
  },
): Array<{ path: string; rule: string; detail: string }>;

/** Engine-internal immutable copy; ordinary public authoring outputs remain mutable. */
export declare function createVersionedDiagramAuthoringSnapshot(
  value: unknown,
  previous?: VersionedDiagramAuthoringBundle | null,
): VersionedDiagramAuthoringBundle;

export declare function sealVersionedDiagramAuthoringSnapshot(
  value: VersionedDiagramAuthoringBundle,
  previous?: VersionedDiagramAuthoringBundle | null,
): VersionedDiagramAuthoringBundle;
