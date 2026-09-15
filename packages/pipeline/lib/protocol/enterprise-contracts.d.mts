export type EnterpriseId = string;
export type EnterpriseTimestamp = string;
export type EnterpriseDigest = string;
export type EnterpriseSchema = Readonly<Record<string, unknown>>;
export type EnterpriseAction = 'organization.manage' | 'ownership.transfer' | 'billing.manage' | 'audit.read' | 'project.create' | 'project.manage' | 'artifact.read' | 'artifact.author' | 'artifact.export' | 'review.write' | 'review.resolve';
export type EnterpriseProjectRole = 'maintainer' | 'author' | 'reviewer' | 'viewer';
export type EnterpriseJson = null | boolean | number | string | EnterpriseJson[] | { [key: string]: EnterpriseJson };
export interface EnterpriseScope { organizationId: EnterpriseId; projectId: EnterpriseId }
export interface EnterpriseAccessContext {
  actor: { id: EnterpriseId; verified: boolean };
  organization: { id: EnterpriseId; status: 'active' | 'suspended' };
  membership?: { organizationId: EnterpriseId; actorId: EnterpriseId; role: 'owner' | 'admin' | 'member'; status: 'active' | 'revoked' };
  projectMembership?: EnterpriseScope & { actorId: EnterpriseId; role: EnterpriseProjectRole; status: 'active' | 'revoked' };
  guestGrant?: EnterpriseScope & { artifactId: EnterpriseId; actorId: EnterpriseId; role: 'reviewer' | 'viewer'; status: 'active' | 'revoked'; expiresAt: EnterpriseTimestamp };
  resource: { organizationId: EnterpriseId; projectId?: EnterpriseId; artifactId?: EnterpriseId };
  action: EnterpriseAction;
  now: EnterpriseTimestamp;
}
export interface EnterpriseAccessDecision { readonly allowed: boolean; readonly code: string }
export interface EnterpriseArtifactRevision extends EnterpriseScope {
  kind: 'openplanr-enterprise-artifact-revision'; schemaVersion: '1.0.0';
  id: EnterpriseId; artifactId: EnterpriseId; parentRevisionId: EnterpriseId | null;
  contentDigest: EnterpriseDigest; contentType: 'application/json' | 'text/markdown' | 'image/svg+xml' | 'text/html';
  byteLength: number; createdAt: EnterpriseTimestamp; actorId: EnterpriseId;
}
export interface EnterpriseReviewAnchor {
  revisionId: EnterpriseId; elementId?: EnterpriseId; screenId?: EnterpriseId; frameId?: EnterpriseId; x?: number; y?: number;
}
export interface EnterpriseReviewReply { id: EnterpriseId; authorId: EnterpriseId; body: string; createdAt: EnterpriseTimestamp }
export type EnterpriseReviewCategory = 'question' | 'suggestion' | 'change-request' | 'blocker';
export interface EnterpriseReviewThread extends EnterpriseScope {
  kind: 'openplanr-enterprise-review-thread'; schemaVersion: '1.0.0';
  id: EnterpriseId; artifactId: EnterpriseId; anchor: EnterpriseReviewAnchor;
  category: EnterpriseReviewCategory; status: 'open' | 'addressed' | 'resolved';
  authorId: EnterpriseId; body: string; createdAt: EnterpriseTimestamp; updatedAt: EnterpriseTimestamp;
  replies: EnterpriseReviewReply[]; assigneeId?: EnterpriseId | null; addressedRevisionId?: EnterpriseId; resolvedAt?: EnterpriseTimestamp;
}
export type EnterpriseElementCollection = 'nodes' | 'relations' | 'groups' | 'events' | 'items';
export type EnterpriseChangeOperation =
  | { op: 'replace-document'; content: { [key: string]: EnterpriseJson } }
  | { op: 'set-field'; targetId: EnterpriseId; field: 'label' | 'description' | 'status' | 'title'; value: string }
  | { op: 'add-element'; collection: EnterpriseElementCollection; element: { id: EnterpriseId; [key: string]: EnterpriseJson } }
  | { op: 'remove-element'; collection: EnterpriseElementCollection; targetId: EnterpriseId }
  | { op: 'set-layout'; targetId: EnterpriseId; x: number; y: number };
export interface EnterpriseChangeProposal extends EnterpriseScope {
  kind: 'openplanr-enterprise-change-proposal'; schemaVersion: '1.0.0';
  id: EnterpriseId; artifactId: EnterpriseId; baseRevisionId: EnterpriseId; authorId: EnterpriseId; createdAt: EnterpriseTimestamp;
  status: 'draft' | 'proposed' | 'accepted' | 'rejected' | 'applied' | 'conflicted'; summary: string;
  operations: EnterpriseChangeOperation[];
  validation: { status: 'pending' | 'passed' | 'failed'; issues: { code: string; message: string; targetId?: EnterpriseId }[] };
  application?: { revisionId: EnterpriseId; appliedAt: EnterpriseTimestamp; actorId: EnterpriseId; gitCommit?: string };
}
export type EnterpriseEvidenceSource =
  | { kind: 'repository'; repositoryId: EnterpriseId; path: string; commit: string; line?: number }
  | { kind: 'artifact'; artifactId: EnterpriseId; revisionId: EnterpriseId; elementId?: EnterpriseId }
  | { kind: 'url'; url: string };
export interface EnterpriseEvidenceReference extends EnterpriseScope {
  kind: 'openplanr-enterprise-evidence-reference'; schemaVersion: '1.0.0'; id: EnterpriseId;
  source: EnterpriseEvidenceSource; capturedAt: EnterpriseTimestamp; freshness: 'current' | 'stale' | 'unknown'; label: string; contentDigest?: EnterpriseDigest;
}
export interface EnterpriseSyncState extends EnterpriseScope {
  kind: 'openplanr-enterprise-sync-state'; schemaVersion: '1.0.0'; repositoryId: EnterpriseId;
  direction: 'push' | 'pull'; status: 'preview' | 'pending' | 'synchronized' | 'failed' | 'conflicted';
  scope: EnterpriseId[]; cursor: string | null; operationId: EnterpriseId; updatedAt: EnterpriseTimestamp;
  items: { artifactId: EnterpriseId; baseRevisionId: EnterpriseId | null; revisionId: EnterpriseId | null; contentDigest: EnterpriseDigest; action: 'create' | 'update' | 'unchanged' | 'conflict' }[];
  issues: { code: string; artifactId?: EnterpriseId; message: string }[];
}
export interface EnterpriseAgentHandoff extends EnterpriseScope {
  kind: 'openplanr-enterprise-agent-handoff'; schemaVersion: '1.0.0'; artifactId: EnterpriseId; revisionId: EnterpriseId;
  generatedAt: EnterpriseTimestamp; authority: 'feedback-only'; contentTrust: 'untrusted';
  threads: EnterpriseReviewThread[]; evidence: EnterpriseEvidenceReference[]; unresolvedUncertainties: string[]; contentDigest: EnterpriseDigest;
}
export declare const ENTERPRISE_CONTRACT_VERSION: '1.0.0';
export declare const ENTERPRISE_PROTOCOL_VERSION: '1.12.0';
export declare const ENTERPRISE_CONTENT_DIGEST_HEADER: 'X-OpenPlanr-Content-Digest';
export declare const ENTERPRISE_ID_PATTERN: string;
export declare const ENTERPRISE_REVIEW_CATEGORIES: readonly EnterpriseReviewCategory[];
export declare const ENTERPRISE_ACTIONS: readonly EnterpriseAction[];
export declare const ENTERPRISE_ACCESS_CONTEXT_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_ARTIFACT_REVISION_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_REVIEW_ANCHOR_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_REVIEW_THREAD_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_CHANGE_OPERATION_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_CHANGE_PROPOSAL_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_EVIDENCE_REFERENCE_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_SYNC_STATE_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_AGENT_HANDOFF_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_SCHEMAS: Readonly<Record<string, EnterpriseSchema>>;
export declare function assertEnterpriseContract<T>(value: T, schemaOrName: EnterpriseSchema | string): T;
export declare function assertEnterpriseRevision<T extends EnterpriseArtifactRevision>(value: T): T;
export declare function assertEnterpriseRevisionAppend<T extends EnterpriseArtifactRevision>(revision: T, previous: EnterpriseArtifactRevision | null, content: string | Uint8Array): T;
export declare function assertEnterpriseReviewThread<T extends EnterpriseReviewThread>(value: T): T;
export declare function assertEnterpriseProposal<T extends EnterpriseChangeProposal>(value: T): T;
export declare function assertEnterpriseEvidence<T extends EnterpriseEvidenceReference>(value: T): T;
export declare function assertEnterpriseSync<T extends EnterpriseSyncState>(value: T): T;
export declare function assertEnterpriseHandoff<T extends EnterpriseAgentHandoff>(value: T): T;
export declare function isEnterpriseRepositoryPath(value: unknown): boolean;
export declare function authorizeEnterpriseAccess(context: EnterpriseAccessContext): EnterpriseAccessDecision;
/** Stable UI projection only; every resource request still requires server authorization. */
export declare function enterpriseProjectCapabilities(role: EnterpriseProjectRole | string): readonly EnterpriseAction[];
export declare function createEnterpriseHandoff(input: EnterpriseScope & { artifactId: EnterpriseId; revisionId: EnterpriseId; generatedAt: EnterpriseTimestamp; threads?: EnterpriseReviewThread[]; evidence?: EnterpriseEvidenceReference[]; unresolvedUncertainties?: string[] }): EnterpriseAgentHandoff;
export declare function renderEnterpriseHandoffMarkdown(value: EnterpriseAgentHandoff): string;
export interface EnterpriseLayout { [targetId: string]: { x: number; y: number } }
export interface EnterpriseDocumentChange { op: 'add' | 'remove' | 'replace'; plane: 'semantic' | 'layout'; collection?: string; targetId?: string; field?: string; before?: EnterpriseJson; after?: EnterpriseJson }
export interface EnterpriseDocumentDiff { semanticChanged: boolean; layoutChanged: boolean; changes: EnterpriseDocumentChange[] }
export declare function diffEnterpriseDocuments(before: { [key: string]: EnterpriseJson }, after: { [key: string]: EnterpriseJson }, options?: { beforeLayout?: EnterpriseLayout; afterLayout?: EnterpriseLayout }): EnterpriseDocumentDiff;
export declare function applyEnterpriseOperations(document: { [key: string]: EnterpriseJson }, proposal: EnterpriseChangeProposal, options?: { layout?: EnterpriseLayout }): EnterpriseDocumentDiff & { document: { [key: string]: EnterpriseJson }; layout: EnterpriseLayout };
