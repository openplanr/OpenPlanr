export interface WorkspaceCiphertext {
  iv: string;
  ciphertext: string;
}
export interface WorkspacePublicKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: ['verify'];
}
export interface WorkspaceRevision extends WorkspaceCiphertext {
  id: string;
  epoch: number;
  reviewOf: string;
  createdAt: string;
  signature: string;
}
export interface WorkspaceEvent extends WorkspaceCiphertext {
  id: string;
  revisionId: string;
  reviewOf: string;
  epoch: number;
  publicKey: WorkspacePublicKey;
  signature: string;
}
export interface DesignReviewWorkspace {
  schemaVersion: '1.0.0';
  id: string;
  version: number;
  epoch: number;
  currentRevision: string;
  commentsPaused: boolean;
  ownerPublicKey: WorkspacePublicKey;
  keyring: WorkspaceCiphertext;
}
export declare const DESIGN_WORKSPACE_VERSION: '1.0.0';
export declare const DESIGN_WORKSPACE_API: '/api/v1/design-workspaces';
export declare const DESIGN_WORKSPACE_MAX_BYTES: number;
export declare const DESIGN_WORKSPACE_MAX_EVENT_BYTES: number;
export declare const DESIGN_WORKSPACE_ID_PATTERN: string;
export declare const DESIGN_WORKSPACE_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_WORKSPACE_CREATE_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_WORKSPACE_REVISION_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_WORKSPACE_EVENT_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_REVIEW_BUNDLE_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DESIGN_WORKSPACE_SCHEMAS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;
export declare function assertWorkspaceContract<T>(
  value: T,
  contract: Readonly<Record<string, unknown>>,
): T;
