export type DiagramAuthoringDigest = `sha256:${string}`;
export type DiagramAuthoringProfile = 'flowchart' | 'process' | 'swimlane' | 'architecture';
export type DiagramAuthoringNodeKind =
  | 'process'
  | 'start'
  | 'end'
  | 'decision'
  | 'data-store'
  | 'component';
export type DiagramAuthoringRelationKind =
  | 'association'
  | 'dependency'
  | 'flow'
  | 'message'
  | 'transition';
export type DiagramAuthoringContractKind =
  | 'diagram-document'
  | 'diagram-presentation'
  | 'diagram-authoring-bundle'
  | 'diagram-edit-transaction'
  | 'diagram-source-map'
  | 'diagram-fidelity-report'
  | 'diagram-manifest'
  | 'diagram-change-proposal'
  | 'diagram-publication-state'
  | 'diagram-authoring-capabilities';
export type DiagramEditOperationClass =
  | 'insert-elements'
  | 'update-semantics'
  | 'remove-elements'
  | 'set-membership-order'
  | 'set-geometry'
  | 'set-appearance-locks';
export type DiagramAuthoringSchema = Readonly<Record<string, unknown>>;
export interface DiagramAuthoringValidationError {
  path: string;
  rule: string;
  detail: string;
}
export interface DiagramAuthoringEnvelope<K extends string> {
  kind: K;
  schemaVersion: '1.0.0';
  protocolVersion: '1.13.0';
}
export interface DiagramAuthoringNode {
  id: string;
  label: string;
  kind: DiagramAuthoringNodeKind;
  description: string | null;
}
export interface DiagramAuthoringRelation {
  id: string;
  from: string;
  to: string;
  kind: DiagramAuthoringRelationKind;
  direction: 'forward' | 'both' | 'none';
  label: string | null;
  weight: number | null;
}
export interface DiagramAuthoringContainer {
  id: string;
  label: string;
  members: string[];
}
export interface DiagramAuthoringAnnotation {
  id: string;
  text: string;
  targetId: string | null;
}
export interface DiagramAuthoringAccessibility {
  title: string;
  description: string;
  readingOrder: string[];
}
export interface DiagramAuthoringDocument extends DiagramAuthoringEnvelope<'planr-diagram'> {
  diagramId: string;
  title: string;
  summary: string;
  audience: 'engineer' | 'executive' | 'mixed';
  grammar: { id: DiagramAuthoringProfile; version: '1.0.0' };
  nodes: DiagramAuthoringNode[];
  relations: DiagramAuthoringRelation[];
  groups: DiagramAuthoringContainer[];
  lanes: DiagramAuthoringContainer[];
  events: never[];
  series: never[];
  axes: never[];
  sets: never[];
  annotations: DiagramAuthoringAnnotation[];
  emphasis: Array<{ targetId: string; level: 'primary' | 'secondary' | 'muted' }>;
  laneOrder: string[];
  accessibility: DiagramAuthoringAccessibility;
  documentDigest: DiagramAuthoringDigest;
}
export interface DiagramBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface DiagramBoundaryAttachment {
  side: 'top' | 'right' | 'bottom' | 'left';
  offset: number;
}
export interface DiagramRoute {
  mode: 'automatic' | 'manual';
  strategy: 'straight' | 'orthogonal';
  from: DiagramBoundaryAttachment;
  to: DiagramBoundaryAttachment;
  points: Array<{ x: number; y: number }>;
}
export interface DiagramAppearance {
  shape:
    | 'rectangle'
    | 'rounded-rectangle'
    | 'ellipse'
    | 'diamond'
    | 'cylinder'
    | 'text'
    | 'container'
    | 'connector';
  fill: 'surface' | 'accent' | 'success' | 'warning' | 'danger' | 'transparent';
  stroke: 'default' | 'accent' | 'muted' | 'danger' | 'none';
  strokeWidth: number;
  strokeStyle: 'solid' | 'dashed' | 'dotted';
  fontSize: number;
  textAlign: 'left' | 'center' | 'right';
}
export interface DiagramGeometryLocks {
  position: boolean;
  size: boolean;
  route: boolean;
}
export interface DiagramGeometry {
  bounds: DiagramBounds | null;
  route: DiagramRoute | null;
  label: { x: number; y: number; width: number } | null;
  zIndex: number;
}
export interface DiagramPlacement extends DiagramGeometry {
  elementId: string;
  appearance: DiagramAppearance;
  locks: DiagramGeometryLocks;
}
export interface DiagramPresentation extends DiagramAuthoringEnvelope<'diagram-presentation'> {
  diagramId: string;
  semanticDigest: DiagramAuthoringDigest;
  coordinateSystem: 'global-canvas';
  layout: {
    direction: 'top-down' | 'left-right' | 'right-left' | 'bottom-up';
    detailTier: 'simplified' | 'balanced' | 'faithful';
  };
  theme: { themeId: 'paper' | 'slate' | 'midnight'; mode: 'light' | 'dark' | 'auto' };
  elements: DiagramPlacement[];
  presentationDigest: DiagramAuthoringDigest;
}
export interface DiagramAuthoringSnapshot {
  bundleDigest: DiagramAuthoringDigest;
  semanticDigest: DiagramAuthoringDigest;
  presentationDigest: DiagramAuthoringDigest;
}
export interface DiagramSourceMap extends DiagramAuthoringEnvelope<'diagram-source-map'> {
  diagramId: string;
  semanticDigest: DiagramAuthoringDigest;
  sourceDigest: DiagramAuthoringDigest;
  sourceByteLength: number;
  encoding: 'utf-8';
  parser: { id: string; version: string };
  certificationVersion: 'flowchart-copy-v1';
  entries: Array<{
    sourceId: string | null;
    elementIds: string[];
    range: { startByte: number; endByte: number } | null;
    construct: string;
    confidence: 'exact' | 'ambiguous';
    losses: string[];
  }>;
}
export interface DiagramAuthoringBundle
  extends DiagramAuthoringEnvelope<'diagram-authoring-bundle'> {
  diagramId: string;
  document: DiagramAuthoringDocument;
  presentation: DiagramPresentation;
  originalSource: { format: 'mermaid'; text: string; sourceDigest: DiagramAuthoringDigest } | null;
  sourceMap: DiagramSourceMap | null;
  bundleDigest: DiagramAuthoringDigest;
}
export type DiagramSemanticEntry =
  | { collection: 'nodes'; value: DiagramAuthoringNode }
  | { collection: 'relations'; value: DiagramAuthoringRelation }
  | { collection: 'groups' | 'lanes'; value: DiagramAuthoringContainer }
  | { collection: 'annotations'; value: DiagramAuthoringAnnotation };
export interface DiagramMembershipState {
  groups: Array<{ id: string; members: string[] }>;
  lanes: Array<{ id: string; members: string[] }>;
  laneOrder: string[];
}
export type DiagramSemanticUpdate =
  | {
      type: 'update-semantics';
      collection: 'nodes';
      elementId: string;
      before: Omit<DiagramAuthoringNode, 'id'>;
      after: Omit<DiagramAuthoringNode, 'id'>;
    }
  | {
      type: 'update-semantics';
      collection: 'relations';
      elementId: string;
      before: Omit<DiagramAuthoringRelation, 'id'>;
      after: Omit<DiagramAuthoringRelation, 'id'>;
    }
  | {
      type: 'update-semantics';
      collection: 'groups' | 'lanes';
      elementId: string;
      before: { label: string };
      after: { label: string };
    }
  | {
      type: 'update-semantics';
      collection: 'annotations';
      elementId: string;
      before: Omit<DiagramAuthoringAnnotation, 'id'>;
      after: Omit<DiagramAuthoringAnnotation, 'id'>;
    }
  | {
      type: 'update-semantics';
      collection: 'emphasis';
      elementId: string;
      before: 'primary' | 'secondary' | 'muted' | null;
      after: 'primary' | 'secondary' | 'muted' | null;
      index?: number;
    }
  | {
      type: 'update-semantics';
      collection: 'document';
      before: Pick<DiagramAuthoringDocument, 'title' | 'summary' | 'audience' | 'accessibility'>;
      after: Pick<DiagramAuthoringDocument, 'title' | 'summary' | 'audience' | 'accessibility'>;
    }
  | {
      type: 'update-semantics';
      collection: 'source-map';
      before: DiagramSourceMap | null;
      after: DiagramSourceMap | null;
    };
export type DiagramEditOperation =
  | {
      type: 'insert-elements';
      elements: DiagramSemanticEntry[];
      presentation: DiagramPlacement[];
      positions?: Array<{ elementId: string; semanticIndex: number; presentationIndex: number }>;
    }
  | { type: 'remove-elements'; elements: DiagramSemanticEntry[]; presentation: DiagramPlacement[] }
  | DiagramSemanticUpdate
  | { type: 'set-membership-order'; before: DiagramMembershipState; after: DiagramMembershipState }
  | {
      type: 'set-geometry';
      changes: Array<{ elementId: string; before: DiagramGeometry; after: DiagramGeometry }>;
    }
  | {
      type: 'set-appearance-locks';
      changes: Array<{
        elementId: string;
        before: { appearance: DiagramAppearance; locks: DiagramGeometryLocks };
        after: { appearance: DiagramAppearance; locks: DiagramGeometryLocks };
      }>;
    };
export interface DiagramEditTransaction
  extends DiagramAuthoringEnvelope<'diagram-edit-transaction'> {
  transactionId: string;
  diagramId: string;
  base: DiagramAuthoringSnapshot;
  operations: DiagramEditOperation[];
  undoOf: string | null;
}
export interface DiagramChangeProposal extends DiagramAuthoringEnvelope<'diagram-change-proposal'> {
  proposalId: string;
  diagramId: string;
  base: DiagramAuthoringSnapshot;
  transaction: DiagramEditTransaction;
  summary: string;
  author: { kind: 'human' | 'agent'; id: string };
  status: 'proposed' | 'accepted' | 'rejected' | 'stale';
}
export interface DiagramPublicationState
  extends DiagramAuthoringEnvelope<'diagram-publication-state'> {
  diagramId: string;
  draft: DiagramAuthoringSnapshot | null;
  published: DiagramAuthoringSnapshot | null;
  audience: 'private' | 'company' | 'public';
  capabilitySemantics: 'descriptive-only-requires-host-authorization';
}
export type DiagramFidelity = 'lossless' | 'partial' | 'unsupported';
export interface DiagramFidelityReport extends DiagramAuthoringEnvelope<'diagram-fidelity-report'> {
  diagramId: string;
  basis: DiagramAuthoringSnapshot;
  sourceDigest: DiagramAuthoringDigest | null;
  sourceFormat: 'mermaid' | 'planr-diagram-bundle';
  targetFormat: 'mermaid' | 'planr-diagram-bundle' | 'svg' | 'html' | 'png';
  semantic: DiagramFidelity;
  presentation: DiagramFidelity;
  sourceText: DiagramFidelity;
  losses: Array<{
    dimension: 'semantic' | 'presentation' | 'sourceText';
    code: string;
    elementIds: string[];
    message: string;
  }>;
}
export interface DiagramAuthoringManifest extends DiagramAuthoringEnvelope<'diagram-manifest'> {
  diagramId: string;
  basis: DiagramAuthoringSnapshot;
  bundle: { path: string; transportDigest: DiagramAuthoringDigest };
  renderer: { id: string; version: string };
  theme?: { id: string; version: string };
  outputs: Array<{
    path: string;
    mediaType: 'image/svg+xml' | 'text/html' | 'image/png';
    transportDigest: DiagramAuthoringDigest;
    fidelity: DiagramFidelityReport;
  }>;
}
export interface DiagramMermaidConstructCapability {
  readonly construct: string;
  readonly import: DiagramFidelity;
  readonly export: DiagramFidelity;
  readonly semanticRoundTrip: DiagramFidelity;
  readonly mapping: string;
}
export interface DiagramAuthoringCapability {
  readonly grammarId: DiagramAuthoringProfile;
  readonly authoring: true;
  readonly primitives: readonly (
    | 'node'
    | 'relation'
    | 'group'
    | 'lane'
    | 'annotation'
    | 'emphasis'
  )[];
  readonly nodeKinds: readonly DiagramAuthoringNodeKind[];
  readonly relationKinds: readonly DiagramAuthoringRelationKind[];
  readonly operations: readonly DiagramEditOperationClass[];
  readonly mermaid: {
    readonly mode: 'copy';
    readonly certificationVersion: 'flowchart-copy-v1';
    readonly constructs: readonly DiagramMermaidConstructCapability[];
    readonly linkedSource: false;
  };
}
export interface DiagramAuthoringCapabilities
  extends DiagramAuthoringEnvelope<'diagram-authoring-capabilities'> {
  readonly version: '1.0.0';
  readonly liveCollaboration: false;
  readonly profiles: readonly DiagramAuthoringCapability[];
  readonly unsupportedGrammars: readonly string[];
}
export interface DiagramAuthoringValidationOptions {
  document?: DiagramAuthoringDocument;
  bundle?: DiagramAuthoringBundle;
  baseBundle?: DiagramAuthoringBundle;
  sourceText?: string;
}
export interface DiagramLegacyInspection {
  valid: boolean;
  errors: DiagramAuthoringValidationError[];
  diagramId: string | null;
  grammarId: string | null;
  authoringAvailable: boolean;
  requiresDerivedPresentation: boolean;
  unsupportedNodeKinds: string[];
  adoption: 'explicit-save-required';
  sourceModified: false;
}
export declare const DIAGRAM_AUTHORING_PROTOCOL_VERSION: '1.13.0';
export declare const DIAGRAM_AUTHORING_CONTRACT_VERSION: '1.0.0';
export declare const DIAGRAM_EDIT_OPERATION_CLASSES: readonly DiagramEditOperationClass[];
export declare const DIAGRAM_AUTHORING_LIMITS: Readonly<{
  depth: 48;
  values: 500000;
  textCodeUnits: 8388608;
  sourceBytes: 1048576;
  elements: 10000;
  operations: 256;
  coordinate: 1000000;
}>;
export declare const DIAGRAM_AUTHORING_SCHEMAS: Readonly<
  Record<DiagramAuthoringContractKind, DiagramAuthoringSchema>
>;
export declare const DIAGRAM_AUTHORING_CONTRACT_FILES: Readonly<
  Record<DiagramAuthoringContractKind, string>
>;
export declare const DIAGRAM_AUTHORING_CAPABILITIES: Readonly<DiagramAuthoringCapabilities>;
export declare function getDiagramAuthoringCapability(
  grammarId: string,
): DiagramAuthoringCapability | null;
export declare function diagramDocumentDigest(
  value:
    | Omit<DiagramAuthoringDocument, 'documentDigest'>
    | DiagramAuthoringDocument
    | Record<string, unknown>,
): DiagramAuthoringDigest;
export declare function diagramPresentationDigest(
  value: Omit<DiagramPresentation, 'presentationDigest'> | DiagramPresentation,
): DiagramAuthoringDigest;
export declare function diagramAuthoringBundleDigest(
  value: Omit<DiagramAuthoringBundle, 'bundleDigest'> | DiagramAuthoringBundle,
): DiagramAuthoringDigest;
export declare function validateDiagramAuthoringArtifact(
  kind: string,
  value: unknown,
  options?: DiagramAuthoringValidationOptions,
): DiagramAuthoringValidationError[];
export declare function assertDiagramAuthoringArtifact<T>(
  kind: DiagramAuthoringContractKind,
  value: T,
  options?: DiagramAuthoringValidationOptions,
): T;
export declare function validateDiagramDocument(
  value: unknown,
  options?: DiagramAuthoringValidationOptions,
): DiagramAuthoringValidationError[];
export declare function assertDiagramDocument<T extends DiagramAuthoringDocument>(
  value: T,
  options?: DiagramAuthoringValidationOptions,
): T;
export declare function validateDiagramPresentation(
  value: unknown,
  options?: DiagramAuthoringValidationOptions,
): DiagramAuthoringValidationError[];
export declare function assertDiagramPresentation<T extends DiagramPresentation>(
  value: T,
  options?: DiagramAuthoringValidationOptions,
): T;
export declare function validateDiagramAuthoringBundle(
  value: unknown,
  options?: DiagramAuthoringValidationOptions,
): DiagramAuthoringValidationError[];
export declare function assertDiagramAuthoringBundle<T extends DiagramAuthoringBundle>(
  value: T,
  options?: DiagramAuthoringValidationOptions,
): T;
export declare function validateDiagramEditTransaction(
  value: unknown,
  options?: DiagramAuthoringValidationOptions,
): DiagramAuthoringValidationError[];
export declare function assertDiagramEditTransaction<T extends DiagramEditTransaction>(
  value: T,
  options?: DiagramAuthoringValidationOptions,
): T;
export declare function summarizeDiagramAuthoringContent(bundle: DiagramAuthoringBundle): {
  elementCount: number;
  hasVisibleContent: boolean;
};
export declare function inspectLegacyDiagramDocument(value: unknown): DiagramLegacyInspection;
