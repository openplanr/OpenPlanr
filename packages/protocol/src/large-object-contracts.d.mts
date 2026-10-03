export { canonicalizeJson } from './canonical-json.mjs';
export interface ChunkDescriptor {
  index: number;
  byteLength: number;
  iv: string;
  sha256: string;
}
export interface ResourceSpan {
  offset: number;
  encodedBytes: number;
  decodedBytes: number;
  codec: 'identity' | 'deflate-raw';
}
export interface EncryptedResourceManifest {
  schemaVersion: '2.0.0';
  kind: 'openplanr-encrypted-resource-manifest';
  workspaceId: string;
  revisionId: string;
  epoch: number;
  createdAt: string;
  plaintextBytes: number;
  ciphertextBytes: number;
  catalog: ResourceSpan;
  chunks: ChunkDescriptor[];
  signature: string;
}
export interface UploadReceipt {
  schemaVersion: '2.0.0';
  workspaceId: string;
  operationId: string;
  revisionId: string;
  manifestSha256: string;
  status: 'committed';
  version: number;
  committedAt: string;
}
export interface UploadStatus {
  schemaVersion: '2.0.0';
  workspaceId: string;
  operationId: string;
  revisionId: string;
  manifestSha256: string;
  status: 'prepared' | 'committed';
  receivedChunks: Omit<ChunkDescriptor, 'iv'>[];
  receipt?: UploadReceipt;
}
export { LARGE_OBJECT_LIMITS } from './large-object-limits.mjs';
export declare const LARGE_OBJECT_VERSION: '2.0.0';
export declare const LARGE_OBJECT_CHUNK_CONTEXT: string;
export declare const RESOURCE_HTML_SEGMENT_ENCODING: 'openplanr.html-segments.utf8-v1';
export declare const ENCRYPTED_RESOURCE_MANIFEST_SCHEMA: Record<string, unknown>;
export declare const ENCRYPTED_UPLOAD_PREPARE_SCHEMA: Record<string, unknown>;
export declare const ENCRYPTED_UPLOAD_COMMIT_SCHEMA: Record<string, unknown>;
export declare const ENCRYPTED_UPLOAD_RECEIPT_SCHEMA: Record<string, unknown>;
export declare const ENCRYPTED_UPLOAD_STATUS_SCHEMA: Record<string, unknown>;
export declare const ENCRYPTED_WORKSPACE_V2_SCHEMA: Record<string, unknown>;
export declare const ENCRYPTED_WORKSPACE_EVENT_V2_SCHEMA: Record<string, unknown>;
export declare const RESOURCE_CATALOG_SCHEMA: Record<string, unknown>;
export declare const LARGE_OBJECT_SCHEMAS: Readonly<Record<string, Record<string, unknown>>>;
/** Inspect bounded, inert JSON data without invoking accessors or copying it. */
export declare function assertLargeObjectData<T>(value: T): T;
export declare function assertLargeObjectContract<T>(value: T, kind: string): T;

export interface CompanyResourceManifest {
  schemaVersion: '2.0.0';
  kind: 'openplanr-company-resource-manifest';
  organizationId: string;
  projectId: string;
  artifactId: string;
  revisionId: string;
  contentDigest: string;
  contentType: 'application/json';
  byteLength: number;
  decodedBytes: number;
  catalog: ResourceSpan;
  chunks: Omit<ChunkDescriptor, 'iv'>[];
}
export declare const COMPANY_RESOURCE_MANIFEST_SCHEMA: Record<string, unknown>;
export declare const COMPANY_RESOURCE_UPLOAD_PREPARE_SCHEMA: Record<string, unknown>;
export declare const COMPANY_RESOURCE_UPLOAD_RECEIPT_SCHEMA: Record<string, unknown>;
export declare const WORKSPACE_MANAGEMENT_V2_SCHEMA: Record<string, unknown>;
export declare const WORKSPACE_ROTATION_V2_SCHEMA: Record<string, unknown>;

export declare const COMPANY_RESOURCE_UPLOAD_STATUS_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_ARTIFACT_REVISION_V11_SCHEMA: Record<string, unknown>;

export interface EncryptedUploadPrepare {
  schemaVersion: '2.0.0';
  workspaceId: string;
  operationId: string;
  expectedVersion: number;
  epoch: number;
  ownerPublicKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  ownerAuthHash: string;
  reviewerAuthHash: string;
  keyring: { iv: string; ciphertext: string };
  manifest: EncryptedResourceManifest;
  signature: string;
}
export interface CompanyResourceUploadPrepare {
  schemaVersion: '2.0.0';
  operationId: string;
  baseRevisionId: string | null;
  manifest: CompanyResourceManifest;
}

export declare function assertArtifactEnvelopeMetadata<T>(value: T): T;
