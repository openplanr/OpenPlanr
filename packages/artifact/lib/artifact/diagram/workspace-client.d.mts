import type {
  DiagramReviewBundle,
  DiagramReviewFeedback,
} from '@openplanr/protocol/diagram-review-contracts';
import type { EncryptedWorkspaceClient } from '../encrypted-workspace-client.mjs';
export const DIAGRAM_SHARE_BASE_URL: 'https://share.openplanr.dev';
type Client = EncryptedWorkspaceClient<DiagramReviewBundle, DiagramReviewFeedback>;
export const encodeWorkspaceBytes: Client['encodeWorkspaceBytes'];
export const decodeWorkspaceBytes: Client['decodeWorkspaceBytes'];
export const newWorkspaceToken: Client['newWorkspaceToken'];
export const newWorkspaceId: Client['newWorkspaceId'];
export const normalizeWorkspaceBase: Client['normalizeWorkspaceBase'];
export const workspaceReviewUrl: Client['workspaceReviewUrl'];
export const deriveWorkspaceAuthentication: Client['deriveWorkspaceAuthentication'];
export const canonicalWorkspacePublicKey: Client['canonicalWorkspacePublicKey'];
export const createWorkspaceSigner: Client['createWorkspaceSigner'];
export const signWorkspaceValue: Client['signWorkspaceValue'];
export const verifyWorkspaceSignature: Client['verifyWorkspaceSignature'];
export const workspaceEnvelopeDigest: Client['workspaceEnvelopeDigest'];
export const prepareWorkspace: Client['prepareWorkspace'];
export const commitWorkspace: Client['commitWorkspace'];
export const getWorkspace: Client['getWorkspace'];
export const listWorkspaceRevisions: Client['listWorkspaceRevisions'];
export const decryptWorkspaceRevision: Client['decryptWorkspaceRevision'];
export const prepareWorkspaceMutation: Client['prepareWorkspaceMutation'];
export const commitWorkspaceMutation: Client['commitWorkspaceMutation'];
export const publishWorkspace: Client['publishWorkspace'];
export const rotateWorkspace: Client['rotateWorkspace'];
export const manageWorkspace: Client['manageWorkspace'];
export const prepareWorkspaceEvent: Client['prepareWorkspaceEvent'];
export const appendWorkspaceEvent: Client['appendWorkspaceEvent'];
export const readWorkspaceEvents: Client['readWorkspaceEvents'];

export declare function discoverWorkspaceCapabilities(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>>;
export declare const prepareChunkedWorkspace: Client['prepareWorkspace'];
export declare function openWorkspaceRevision(
  access: Parameters<Client['getWorkspace']>[0],
  revisionId?: string,
  options?: { fetchImpl?: typeof fetch },
): Promise<{
  catalog: unknown;
  bundle: unknown;
  loadSource(id: string): Promise<string>;
  loadView(id: string): Promise<unknown>;
  loadBundle(): Promise<DiagramReviewBundle>;
  dispose(): void;
}>;
