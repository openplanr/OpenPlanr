import type {
  EnterpriseAgentHandoff,
  EnterpriseChangeProposal,
  EnterpriseEvidenceReference,
  EnterpriseReviewAnchor,
  EnterpriseReviewThread,
  EnterpriseSchema,
  EnterpriseScope,
  EnterpriseSyncState,
} from './enterprise-contracts.mjs';

type ResourceSuccessor<T> = Omit<T, 'schemaVersion'> & {
  schemaVersion: '1.1.0';
  protocolVersion: '1.17.0';
};
/** Revision references admit exact staged opaque IDs and retained historical IDs. */
export type EnterpriseReviewAnchorV11 = EnterpriseReviewAnchor;
export type EnterpriseReviewThreadV11 = ResourceSuccessor<EnterpriseReviewThread>;
export type EnterpriseChangeProposalV11 = ResourceSuccessor<EnterpriseChangeProposal>;
export type EnterpriseEvidenceReferenceV11 = ResourceSuccessor<EnterpriseEvidenceReference>;
export type EnterpriseSyncStateV11 = ResourceSuccessor<EnterpriseSyncState>;
export type VersionedEnterpriseReviewThread = EnterpriseReviewThread | EnterpriseReviewThreadV11;
export type VersionedEnterpriseChangeProposal =
  | EnterpriseChangeProposal
  | EnterpriseChangeProposalV11;
export type VersionedEnterpriseEvidenceReference =
  | EnterpriseEvidenceReference
  | EnterpriseEvidenceReferenceV11;
export type VersionedEnterpriseSyncState = EnterpriseSyncState | EnterpriseSyncStateV11;
export type EnterpriseAgentHandoffV11 = Omit<
  ResourceSuccessor<EnterpriseAgentHandoff>,
  'threads' | 'evidence'
> & {
  threads: VersionedEnterpriseReviewThread[];
  evidence: VersionedEnterpriseEvidenceReference[];
};
export type VersionedEnterpriseAgentHandoff = EnterpriseAgentHandoff | EnterpriseAgentHandoffV11;
export declare const ENTERPRISE_REVIEW_ANCHOR_V11_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_REVIEW_THREAD_V11_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_CHANGE_PROPOSAL_V11_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_EVIDENCE_REFERENCE_V11_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_SYNC_STATE_V11_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_AGENT_HANDOFF_V11_SCHEMA: EnterpriseSchema;
export declare const ENTERPRISE_RESOURCE_SCHEMAS: Readonly<Record<string, EnterpriseSchema>>;
export declare function assertEnterpriseReviewAnchorV11(value: unknown): EnterpriseReviewAnchorV11;
export declare function assertVersionedEnterpriseReviewThread(
  value: unknown,
): VersionedEnterpriseReviewThread;
export declare function assertVersionedEnterpriseProposal(
  value: unknown,
): VersionedEnterpriseChangeProposal;
export declare function assertVersionedEnterpriseEvidence(
  value: unknown,
): VersionedEnterpriseEvidenceReference;
export declare function assertVersionedEnterpriseSync(value: unknown): VersionedEnterpriseSyncState;
export declare function assertVersionedEnterpriseHandoff(
  value: unknown,
): VersionedEnterpriseAgentHandoff;
export declare function assertEnterpriseResourceContract<T>(value: T, kind: string): T;
export declare function createEnterpriseHandoffV11(
  input: EnterpriseScope & {
    artifactId: string;
    revisionId: string;
    generatedAt: string;
    threads?: VersionedEnterpriseReviewThread[];
    evidence?: VersionedEnterpriseEvidenceReference[];
    unresolvedUncertainties?: string[];
  },
): EnterpriseAgentHandoffV11;
export declare function renderVersionedEnterpriseHandoffMarkdown(
  value: VersionedEnterpriseAgentHandoff,
): string;
