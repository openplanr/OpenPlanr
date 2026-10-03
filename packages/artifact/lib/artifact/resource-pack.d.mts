import type {
  CompanyResourceManifest,
  EncryptedResourceManifest,
  ResourceSpan,
} from '@openplanr/protocol/large-object-contracts';
export interface ResourceDescriptor extends ResourceSpan {
  id: string;
  type: 'html-segments' | 'shared-block' | 'asset';
  sha256: string;
}
export interface ResourceCatalog {
  schemaVersion: '1.0.0';
  kind: 'openplanr-resource-catalog';
  reviewOf?: string;
  bundle: Record<string, unknown>;
  uniqueHtmlBytes: number;
  totalDecodedBytes: number;
  resources: ResourceDescriptor[];
  sources: Array<{ id: string; resourceId: string; htmlBytes: number; sha256: string }>;
  viewSources: Record<string, string>;
}
export interface ResourcePack {
  catalog: ResourceCatalog;
  catalogSpan: ResourceSpan;
  encodedResources: Uint8Array[];
  plaintextBytes: number;
}
export interface OpenResourcePack {
  catalog: ResourceCatalog;
  bundle: Record<string, unknown>;
  reviewOf?: string;
  loadSource(id: string, options?: { maxSourceBytes?: number }): Promise<string>;
  loadView(
    id: string,
    options?: { maxSourceBytes?: number },
  ): Promise<{ id: string; html: string; [key: string]: unknown }>;
  loadBundle(options?: { sourcePool?: boolean }): Promise<Record<string, unknown>>;
  assertMatchesBundle(value: unknown): Promise<unknown>;
  dispose(): void;
}
export declare function encodeResourceBytes(bytes: Uint8Array): string;
export declare function decodeResourceBytes(value: string, maxBytes?: number): Uint8Array;
export declare function resourceSha256(bytes: Uint8Array): Promise<string>;
export declare function encodeResource(bytes: Uint8Array): {
  bytes: Uint8Array;
  codec: 'identity' | 'deflate-raw';
};
export declare function decodeResource(
  bytes: Uint8Array,
  descriptor: ResourceSpan,
  maxBytes?: number,
): Uint8Array;
export type HtmlSegment = string | { resourceId: string };
export declare function encodeHtmlSegments(segments: HtmlSegment[], maxBytes?: number): Uint8Array;
export declare function decodeHtmlSegments(bytes: Uint8Array, maxBytes?: number): HtmlSegment[];
export declare function packResourceBundle(
  bundle: unknown,
  options?: { reviewOf?: string },
): Promise<ResourcePack>;
export declare function resourceChunkAAD(
  manifest: Pick<EncryptedResourceManifest, 'workspaceId' | 'revisionId' | 'epoch'>,
  index: number,
): Uint8Array;
export declare function encryptResourcePack(
  pack: ResourcePack,
  options: {
    workspaceId: string;
    revisionId: string;
    epoch: number;
    rawKey: Uint8Array;
    createdAt?: string;
    sign(value: Omit<EncryptedResourceManifest, 'signature'>): Promise<EncryptedResourceManifest>;
  },
): Promise<{ manifest: EncryptedResourceManifest; chunks: Uint8Array[] }>;
export declare function openResourcePack(
  manifest: EncryptedResourceManifest,
  options: {
    rawKey: Uint8Array;
    verify(value: EncryptedResourceManifest): Promise<boolean>;
    fetchChunk(
      index: number,
      descriptor?: EncryptedResourceManifest['chunks'][number],
    ): Promise<Uint8Array>;
    maxCachedBytes?: number;
  },
): Promise<OpenResourcePack>;
export declare function packCompanyResourceBundle(
  bundle: unknown,
  scope: { organizationId: string; projectId: string; artifactId: string; revisionId: string },
): Promise<{ manifest: CompanyResourceManifest; chunks: Uint8Array[]; catalog: ResourceCatalog }>;
export declare function openCompanyResourcePack(
  manifest: CompanyResourceManifest,
  options: {
    fetchChunk(
      index: number,
      descriptor?: CompanyResourceManifest['chunks'][number],
    ): Promise<Uint8Array>;
    maxCachedBytes?: number;
  },
): Promise<OpenResourcePack>;

export declare function assertResourceBundleMatchesCatalog(
  value: unknown,
  catalog: ResourceCatalog,
): Promise<unknown>;
