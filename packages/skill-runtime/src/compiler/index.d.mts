export type Digest = `sha256:${string}`;
export type SourceMapOwnerKind = 'template' | 'source' | 'host-profile' | 'compiler';

export interface SourceMapOwner {
  readonly ownerKind: SourceMapOwnerKind;
  readonly pointer: string;
  readonly version: string;
  readonly digest: Digest;
}

export interface SourceMapRange {
  readonly startByte: number;
  readonly endByte: number;
  readonly owner: SourceMapOwner;
}

export interface AuthorityCeiling {
  readonly repositoryAccess: 'request-scope' | 'declared-paths' | 'read-only' | 'none';
  readonly externalDataAccess: 'read-only' | 'none';
  readonly allowedCapabilities: ReadonlyArray<string>;
  readonly allowedTools: ReadonlyArray<string>;
  readonly allowedOperations: ReadonlyArray<string>;
  readonly allowedOutputClasses: ReadonlyArray<'A' | 'B' | 'C' | 'D'>;
  readonly forbiddenEffects: ReadonlyArray<string>;
}

export interface HostOverlayPolicy {
  readonly version: '1.0.0';
  readonly mode: 'typed-presentation-v1';
  readonly allowedVariation: readonly ['wording', 'tool-invocation'];
  readonly protectedSemantics: readonly ['workflow', 'outputs', 'capabilities', 'effects'];
}

export interface HostOverlayResolution {
  readonly policy: HostOverlayPolicy;
  readonly substitutions: Readonly<Record<string, string>>;
  readonly sources: Readonly<Record<string, Readonly<{ path: string; version: string; digest: Digest }>>>;
}

export interface SourceEdge {
  from: string;
  to: string;
  field?: string;
}

export interface ModuleReference {
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly digest: Digest;
}

export interface ResolvedModule {
  readonly ref: ModuleReference;
  readonly entry: Readonly<Record<string, unknown>>;
}

export interface RoutedModule extends ResolvedModule {
  readonly routed: true;
  readonly modules: ReadonlyArray<ResolvedModule>;
}

export interface ResolvedModuleGraph {
  readonly skillId: string;
  readonly skillVersion: string;
  readonly inlineOrder: ReadonlyArray<string>;
  readonly inlineModules: ReadonlyArray<ResolvedModule>;
  readonly overlayModules: ReadonlyArray<ResolvedModule>;
  readonly routedReferences: ReadonlyArray<RoutedModule>;
  readonly routedGroups: ReadonlyArray<RoutedModule>;
  readonly allSelectedModules: ReadonlyArray<ResolvedModule>;
  readonly edges: ReadonlyArray<Readonly<SourceEdge>>;
  readonly selectedIds: ReadonlyArray<{ readonly moduleId: string; readonly moduleVersion: string; readonly mode: 'inline' | 'overlay' | 'routed' }>;
}

export interface CompiledAsset {
  readonly host: string;
  readonly path: string;
  readonly bytes: string;
  readonly digest: Digest;
  readonly byteLength: number;
  readonly sourceMap: ReadonlyArray<SourceMapRange>;
}

export interface CompiledReference extends CompiledAsset {
  readonly moduleId: string;
  readonly moduleVersion: string;
  readonly routed: true;
}

export interface ComposedCompileResult {
  readonly skillId: string;
  readonly host: string;
  readonly primary: CompiledAsset;
  readonly references: ReadonlyArray<CompiledReference>;
  readonly preview: {
    readonly skillId: string;
    readonly skillVersion: string;
    readonly host: string;
    readonly hostProfile: string;
    readonly inline: ReadonlyArray<{ readonly moduleId: string; readonly moduleVersion: string; readonly source: string; readonly mode: 'inline' }>;
    readonly overlay: ReadonlyArray<{ readonly moduleId: string; readonly moduleVersion: string; readonly source: string; readonly mode: 'overlay' }>;
    readonly routed: ReadonlyArray<{
      readonly moduleId: string;
      readonly moduleVersion: string;
      readonly path: string;
      readonly mode: 'routed';
      readonly sources: ReadonlyArray<{ readonly moduleId: string; readonly moduleVersion: string; readonly source: string }>;
    }>;
  };
  readonly graph: ResolvedModuleGraph;
}

export interface MarkdownCompileResult {
  readonly skillId: string;
  readonly host: string;
  readonly composed: {
    readonly bytes: string;
    readonly compositionSources: ReadonlyArray<{ readonly path: string; readonly digest: Digest }>;
    readonly compositionFragments: ReadonlyArray<{
      readonly text: string;
      readonly ownerKind: 'source' | 'compiler';
      readonly pointer: string;
      readonly digest: Digest;
    }>;
  };
  readonly bytes: string;
  readonly digest: Digest;
  readonly byteLength: number;
  readonly sourceMap: ReadonlyArray<SourceMapRange>;
}

export declare function resolveModuleGraph(options: {
  skillSource: Record<string, unknown>;
  modules: ReadonlyArray<Record<string, unknown>>;
  hostProfile?: Record<string, unknown>;
}): ResolvedModuleGraph;

export declare const HOST_OVERLAY_POLICY: HostOverlayPolicy;
export declare function assertHostOverlayIsPresentational(
  hostProfile: Readonly<Record<string, unknown>>,
  overlayModules?: ReadonlyArray<ResolvedModule>,
  readSource?: (overlay: ResolvedModule) => string,
): HostOverlayResolution;

export declare function assertAuthorityNarrows(
  base: AuthorityCeiling,
  overlay: AuthorityCeiling,
  context: { edge: SourceEdge },
): AuthorityCeiling;

export declare function compileComposedV1(options: {
  skillSource: Record<string, unknown>;
  skillSourceCustody: { readonly path: string; readonly digest: Digest };
  modules: ReadonlyArray<Record<string, unknown>>;
  hostProfile: Record<string, unknown>;
  readSource: (relativePath: string) => string;
  cursorTemplate?: string;
}): ComposedCompileResult;

export declare function compileMarkdownV1(options: {
  skillId: string;
  skillVersion?: string;
  canonicalBytes: string;
  host: string;
  cursorTemplate: string;
  supportPaths?: string[];
  readSource: (relativePath: string) => string;
  sourcePath: string;
}): MarkdownCompileResult;

export declare function composeIncludes(
  bytes: string,
  options: { sourcePath: string; readSource: (relativePath: string) => string; stack?: string[] },
): {
  bytes: string;
  compositionSources: ReadonlyArray<{ path: string; digest: Digest }>;
  compositionFragments: ReadonlyArray<{
    text: string;
    ownerKind: 'source' | 'compiler';
    pointer: string;
    digest: Digest;
  }>;
};

export declare function renderSkillForHost(
  bytes: string,
  id: string,
  host: string,
  cursorTemplate: string,
  supportPaths: string[],
  options?: { quoteCursorDescription?: boolean },
): string;
export declare function skillPrimaryPath(host: string, id: string): string;
export declare function skillSupportPath(host: string, id: string, supportPath: string): string;
export declare function isSkillAssetPath(host: string, id: string, path: string): boolean;

export declare function readFrontmatter(bytes: string, options?: { expectedName?: string }): {
  fields: Record<string, string>;
  body: string;
};
export declare function renderFrontmatterBlock(entries: ReadonlyArray<[string, string]>): string;

export declare class SourceMapBuilder {
  append(text: string, owner: SourceMapOwner): this;
  get text(): string;
  get byteLength(): number;
  build(): ReadonlyArray<SourceMapRange>;
}

export declare function byteLength(text: string): number;
export declare function owner(ownerKind: SourceMapOwnerKind, pointer: string, version: string, digest: Digest): SourceMapOwner;
export declare function sha256Bytes(text: string): Digest;
export declare function validateSourceMap(ranges: ReadonlyArray<SourceMapRange>, totalBytes: number): true;

export declare const HOST_SUBSTITUTIONS: Readonly<Record<string, Readonly<Record<string, string>>>>;
export declare function assertPortableAsset(path: string, bytes: string, host: string, authority?: AuthorityCeiling): string;
export declare function assertSafeSourcePath(path: string, label?: string): string;
export declare function canonicalText(value: unknown): string;
export declare function parseMarkdownAsset(bytes: string, options?: { expectedName?: string }): {
  source: string;
  frontmatter: string;
  lines: string[];
  fields: Record<string, string>;
  body: string;
};
export declare function serializeYamlScalar(value: unknown): string;
export declare function renderCodexSkill(bytes: string, id: string): string;
export declare function renderCursorSkill(
  bytes: string,
  id: string,
  template: string,
  options?: { quoteDescription?: boolean },
): string;
export declare function renderHostTokens(bytes: string, host: string): string;
export declare function renderRoleAsset(bytes: string, role: Record<string, unknown>, host: string, templates: { aliasTemplate: string; cursorTemplate: string }): string;
export declare function renderTemplate(template: string, values: Record<string, string>): string;
export declare function sha256(value: unknown): Digest;
