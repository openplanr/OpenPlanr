export interface WorkspacePublicKey {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}
export interface WorkspaceSigner {
  privateKey: string;
  publicKey: WorkspacePublicKey;
}
export interface WorkspaceAccess {
  id: string;
  baseUrl: string;
  token: string;
  ownerAuth?: string;
  ownerPublicKey?: WorkspacePublicKey;
  keys?: Record<string, string>;
  epoch?: number;
  keyring?: { iv: string; ciphertext: string };
  version?: number;
  currentRevision?: string;
  commentsPaused?: boolean;
}
export interface WorkspaceCustody extends WorkspaceAccess {
  schemaVersion: string;
  ownerAuth: string;
  ownerPublicKey: WorkspacePublicKey;
  ownerPrivateKey: string;
  keys: Record<string, string>;
  epoch: number;
  keyring: { iv: string; ciphertext: string };
  version: number;
  pendingCreate?: Record<string, unknown>;
  pendingMutation?: {
    action: string;
    body: Record<string, unknown>;
    next: Record<string, unknown>;
  };
  status?: string;
}
export interface WorkspaceRequestOptions {
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  owner?: boolean;
}
export interface WorkspaceEvent {
  id: string;
  revisionId: string;
  reviewOf: string;
  epoch: number;
  iv: string;
  ciphertext: string;
  publicKey: WorkspacePublicKey;
  signature: string;
  sequence?: number;
}
export interface WorkspaceMetadata {
  schemaVersion: string;
  id: string;
  version: number;
  epoch: number;
  currentRevision: string;
  ownerPublicKey: WorkspacePublicKey;
  keyring: { iv: string; ciphertext: string };
  commentsPaused: boolean;
}
export interface EncryptedWorkspaceClient<
  Bundle = Record<string, unknown>,
  Feedback = Record<string, unknown>,
> {
  encodeWorkspaceBytes(bytes: Uint8Array): string;
  decodeWorkspaceBytes(value: string): Uint8Array;
  newWorkspaceToken(): string;
  newWorkspaceId(): string;
  normalizeWorkspaceBase(baseUrl?: string): string;
  workspaceReviewUrl(access: Pick<WorkspaceAccess, 'id' | 'baseUrl'>): string;
  deriveWorkspaceAuthentication(token: string, id: string): Promise<string>;
  canonicalWorkspacePublicKey(value: unknown): WorkspacePublicKey;
  createWorkspaceSigner(): Promise<WorkspaceSigner>;
  signWorkspaceValue<T extends Record<string, unknown>>(
    value: T,
    privateKey: string,
  ): Promise<T & { signature: string }>;
  verifyWorkspaceSignature(
    value: Record<string, unknown>,
    publicKey: WorkspacePublicKey,
  ): Promise<boolean>;
  workspaceEnvelopeDigest(value: Bundle): string;
  prepareWorkspace(bundle: Bundle, options?: { baseUrl?: string }): Promise<WorkspaceCustody>;
  commitWorkspace(
    custody: WorkspaceCustody,
    options?: WorkspaceRequestOptions,
  ): Promise<WorkspaceMetadata>;
  getWorkspace(
    access: WorkspaceAccess,
    options?: WorkspaceRequestOptions,
  ): Promise<WorkspaceMetadata>;
  listWorkspaceRevisions(
    access: WorkspaceAccess,
    options?: WorkspaceRequestOptions & { after?: string },
  ): Promise<{ revisions: Record<string, unknown>[]; hasMore: boolean; cursor: string }>;
  decryptWorkspaceRevision(
    access: WorkspaceAccess,
    revisionId?: string,
    options?: WorkspaceRequestOptions,
  ): Promise<Bundle & { workspaceRevision: string; reviewOf: string }>;
  prepareWorkspaceMutation(
    custody: WorkspaceCustody,
    action: 'publish' | 'rotate' | 'pause' | 'resume' | 'revoke' | 'delete',
    payload?: Bundle,
  ): Promise<NonNullable<WorkspaceCustody['pendingMutation']>>;
  commitWorkspaceMutation(
    custody: WorkspaceCustody,
    options?: WorkspaceRequestOptions,
  ): Promise<WorkspaceMetadata | { schemaVersion: string; id: string; deleted: true }>;
  publishWorkspace(
    custody: WorkspaceCustody,
    bundle: Bundle,
    options?: WorkspaceRequestOptions,
  ): Promise<unknown>;
  rotateWorkspace(custody: WorkspaceCustody, options?: WorkspaceRequestOptions): Promise<unknown>;
  manageWorkspace(
    custody: WorkspaceCustody,
    action: string,
    options?: WorkspaceRequestOptions,
  ): Promise<unknown>;
  prepareWorkspaceEvent(
    access: WorkspaceAccess,
    payload: Feedback,
    options?: { revisionId?: string; reviewOf?: string; signer?: WorkspaceSigner },
  ): Promise<WorkspaceEvent>;
  appendWorkspaceEvent(
    access: WorkspaceAccess,
    payload: Feedback | null,
    options?: WorkspaceRequestOptions & {
      preparedEvent?: WorkspaceEvent;
      revisionId?: string;
      reviewOf?: string;
      signer?: WorkspaceSigner;
    },
  ): Promise<{ event: WorkspaceEvent; sequence: number }>;
  readWorkspaceEvents(
    access: WorkspaceAccess,
    options?: WorkspaceRequestOptions & { after?: number },
  ): Promise<{
    events: (WorkspaceEvent & { sequence: number; payload: Feedback })[];
    issues: { id: string | null; sequence: number; reason: string }[];
    cursor: number;
    hasMore: boolean;
  }>;
}
export interface EncryptedWorkspaceConfig<Bundle, Feedback> {
  domain: string;
  apiPath: string;
  reviewPath: string;
  label: string;
  compatibilityMessage?: string;
  compatibilityCode?: string;
  defaultBaseUrl?: string;
  version?: string;
  maxBytes?: number;
  maxEventBytes?: number;
  schemas: { create: unknown; event: unknown; revision: unknown; workspace: unknown };
  assertContract(value: unknown, schema: unknown): unknown;
  assertBundle(value: unknown): Bundle;
  assertFeedback(value: unknown): Feedback;
  bundleDigest(value: Bundle): string;
  digestInput?(bundle: Bundle): Bundle;
  packBundle?(bundle: Bundle): Promise<unknown>;
  unpackBundle?(value: unknown): Promise<Bundle>;
}
export function createEncryptedWorkspaceClient<Bundle, Feedback>(
  config: EncryptedWorkspaceConfig<Bundle, Feedback>,
): EncryptedWorkspaceClient<Bundle, Feedback>;
