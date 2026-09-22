export interface DiagramGrammarRegistryEntry extends Record<string, unknown> {
  readonly grammarId: string;
  readonly grammarVersion: '1.0.0';
  readonly title: string;
  readonly layoutFamily: string;
  readonly aliases: readonly string[];
  readonly requiredPrimitives: readonly string[];
  readonly allowedPrimitives: readonly string[];
}

export declare const DIAGRAM_CONTRACT_FILES: Readonly<Record<string, string>>;
export declare const DIAGRAM_GRAMMAR_REGISTRY: Readonly<{
  grammars: readonly DiagramGrammarRegistryEntry[];
  [key: string]: unknown;
}>;
export declare const DIAGRAM_SEMANTIC_PATTERN_REGISTRY: Readonly<Record<string, unknown>>;
export declare function getDiagramGrammar(grammarId: string): DiagramGrammarRegistryEntry | null;
export declare function diagramContractUrl(kind: string, options?: { protocolVersion?: '1.6.0' | '1.13.0' }): URL;
export declare function diagramDocumentPath(slug: string): string;
