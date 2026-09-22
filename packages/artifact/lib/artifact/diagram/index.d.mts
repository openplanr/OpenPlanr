export type DiagramFidelity = 'editable' | 'render-only' | 'partial' | 'lossy' | 'unsupported';
export type DiagramDetailTier = 'simplified' | 'balanced' | 'faithful';
export type DiagramSourceChoice = 'ir' | 'mermaid' | 'excalidraw' | 'accept-ir' | 'accept-mermaid' | 'accept-excalidraw';
export type DiagramDocument = Record<string, unknown>;
export interface DiagramRenderCompletion {
  readonly status: 'created' | 'replaced' | 'unchanged';
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly outputCount: number;
}
export interface DiagramInspection {
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly validation: 'passed' | 'changed';
  readonly sourceChanges: readonly Readonly<Record<string, unknown>>[];
  readonly generatedChanges: readonly Readonly<Record<string, unknown>>[];
}
export interface DiagramPng {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}
export interface DiagramRenderedOutputs {
  readonly html: string;
  readonly png: DiagramPng;
  readonly quality: Readonly<Record<string, unknown>>;
  readonly scene: Readonly<Record<string, unknown>>;
  readonly svg: string;
}
export interface DiagramErrorDetails extends Readonly<Record<string, unknown>> {}
export declare class DiagramError extends Error {
  readonly code: string;
  readonly details: DiagramErrorDetails;
}
export declare const DIAGRAM_ERROR_CODES: Readonly<Record<string, string>>;
export declare const DIAGRAM_GRAMMARS: readonly Readonly<Record<string, unknown>>[];
export declare const DIAGRAM_LAYOUT_FAMILIES: readonly string[];
export declare const DIAGRAM_PRIMITIVES: readonly string[];
export declare const DIAGRAM_SEMANTIC_PATTERNS: readonly Readonly<Record<string, unknown>>[];
export declare function getGrammar(grammarId: string): Readonly<Record<string, unknown>>;
export declare function findGrammarAliases(value: string): readonly string[];
export declare function assertDiagramDocument<T extends Record<string, unknown>>(document: T): T;
export declare function createDiagramDocument(input: Record<string, unknown>): Record<string, unknown>;
export declare const MAX_DIAGRAM_PRIMITIVE_ITEMS: number;
export declare const MAX_MERMAID_BYTES: number;
export declare function importMermaid(source: string, options?: Record<string, unknown>): Readonly<{
  document: Record<string, unknown>;
  fidelity: Record<string, unknown>;
}>;
export declare function routeDiagramIntent(input?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function planDiagramQuality(document: Record<string, unknown>, metrics?: Record<string, unknown>): Record<string, unknown>;
export declare function validateDiagramSvg(svg: string, options?: Record<string, unknown>): Readonly<{
  ok: boolean;
  errors: readonly string[];
  contrastRatio: number | null;
}>;
export declare function assertDiagramSvg(svg: string, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare const DIAGRAM_SHARED_REFERENCE: string;
export declare function selectDiagramReferences(grammarId: string): readonly string[];
export declare const DIAGRAM_RENDERER: Readonly<{ id: string; version: string }>;
export declare const DIAGRAM_RASTERIZER: Readonly<Record<string, string>>;
export declare const DIAGRAM_FONT: Readonly<Record<string, string>>;
export declare const DIAGRAM_THEME: Readonly<Record<string, string | number>>;
export declare const RASTER_SCALE: number;
export declare const MAX_DIAGRAM_PNG_BYTES: number;
export declare const MAX_DIAGRAM_SCENE_EXTENT: number;
export declare const DIAGRAM_OUTPUT_MEDIA_TYPES: Readonly<Record<string, string>>;
export declare const MERMAID_EXPORT_CAPABILITIES: Readonly<Record<string, Readonly<Record<string, string>>>>;
export declare const EXCALIDRAW_EXPORT_CAPABILITIES: Readonly<Record<string, Readonly<Record<string, string>>>>;
export declare function layoutDiagram(document: DiagramDocument): Readonly<Record<string, unknown>>;
export declare function wrapDiagramLabel(label: string, maximum?: number): readonly string[];
export declare function escapeXml(value: unknown): string;
export declare function renderDiagramSvg(document: DiagramDocument, options?: Record<string, unknown>): Readonly<{ svg: string; scene: Readonly<Record<string, unknown>> }>;
export declare function renderDiagramHtml(document: DiagramDocument, svg: string, options?: Record<string, unknown>): string;
export declare function renderDiagramPng(svg: string, options?: Record<string, unknown>): DiagramPng;
export declare function inspectDiagramPng(bytes: Uint8Array): Readonly<{ width: number; height: number; byteLength: number }>;
export declare function renderDiagramOutputs(document: DiagramDocument): DiagramRenderedOutputs;
export declare function createRenderQualityReport(document: DiagramDocument, input: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function createFidelityReport(document: DiagramDocument, input: Record<string, unknown>): Readonly<Record<string, unknown>>;
export declare function mermaidCapability(grammarId: string): Readonly<Record<string, string>>;
export declare function exportDiagramMermaid(document: DiagramDocument): Readonly<{ source: string | null; report: Readonly<Record<string, unknown>> }>;
export declare function excalidrawCapability(grammarId: string): Readonly<Record<string, string>>;
export declare function assertExcalidrawScene<T extends Record<string, unknown>>(scene: T): T;
export declare function exportDiagramExcalidraw(document: DiagramDocument): Readonly<{ scene: Record<string, unknown> | null; report: Readonly<Record<string, unknown>> }>;
export declare function renderExcalidrawSceneSvg(scene: Record<string, unknown>, options?: Record<string, string>): Readonly<{ svg: string; scene: Readonly<Record<string, unknown>> }>;
export declare function renderDiagram(document: DiagramDocument, options?: { outputRoot?: string; slug?: string }): Promise<DiagramRenderCompletion>;
export declare function rerenderDiagram(options: { outputRoot?: string; slug: string; acceptSource?: DiagramSourceChoice | null }): Promise<DiagramRenderCompletion>;
export declare function inspectDiagram(options: { outputRoot?: string; slug: string }): Promise<DiagramInspection>;
export declare function checkDiagram(options: { outputRoot?: string; slug: string }): Promise<DiagramInspection>;
export interface DiagramConsumerAttachment {
  readonly reference: Readonly<Record<string, unknown>>;
  readonly bytes: Uint8Array;
  readonly absolutePath: string;
}
export declare function createDiagramConsumerReference(
  manifestPath: string,
  options: { consumer: 'specification' | 'documentation' | 'pdf'; consumerPath?: string | null; preferredFormat?: 'svg' | 'png' },
): Promise<DiagramConsumerAttachment>;
export declare function createDiagramSpecificationReference(manifestPath: string, options?: Record<string, unknown>): Promise<DiagramConsumerAttachment>;
export declare function createDiagramDocumentationReference(manifestPath: string, options?: Record<string, unknown>): Promise<DiagramConsumerAttachment>;
export declare function createDiagramPdfAttachment(manifestPath: string, options?: Record<string, unknown>): Promise<DiagramConsumerAttachment>;
export declare function createDiagramArtifactEnvelope(manifestPath: string, options?: { nativeViewport?: boolean }): Promise<Readonly<{
  envelope: Readonly<Record<string, unknown>>;
  binding: Readonly<Record<string, unknown>>;
  htmlPath: string;
  outputRoot: string;
  document: Readonly<Record<string, unknown>>;
  drawing: null | Readonly<{
    svg: string;
    scene: Readonly<{ width: number; height: number }>;
    items: readonly Readonly<{ id: string; label: string; kind: string; x: number; y: number }>[];
  }>;
  manifest: Readonly<Record<string, unknown>>;
}>>;
export declare function bindDiagramArtifactReview(
  manifestPath: string,
  envelope: Record<string, unknown>,
  review: Record<string, unknown>,
): Promise<Readonly<Record<string, unknown>>>;

export * from './editor/index.mjs';
