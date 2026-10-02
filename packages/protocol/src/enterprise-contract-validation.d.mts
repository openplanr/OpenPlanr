import type {
  EnterpriseAgentHandoff,
  EnterpriseChangeProposal,
  EnterpriseEvidenceReference,
  EnterpriseReviewThread,
  EnterpriseSchema,
  EnterpriseSyncState,
} from './enterprise-contracts.mjs';

type VersionedData<T> = Omit<T, 'schemaVersion'> & { schemaVersion: '1.0.0' | '1.1.0' };
type ThreadData = VersionedData<EnterpriseReviewThread>;
type EvidenceData = VersionedData<EnterpriseEvidenceReference>;
type HandoffData = Omit<VersionedData<EnterpriseAgentHandoff>, 'threads' | 'evidence'> & {
  threads: ThreadData[];
  evidence: EvidenceData[];
};

export declare function assertPlainData(value: unknown, depth?: number, seen?: Set<unknown>): void;
export declare function assertEnterpriseContractWithSchema<T>(
  value: T,
  schema: EnterpriseSchema,
): T;
export declare function assertEnterpriseReviewThreadWithSchema<T extends ThreadData>(
  value: T,
  schema: EnterpriseSchema,
): T;
export declare function assertEnterpriseProposalWithSchema<
  T extends VersionedData<EnterpriseChangeProposal>,
>(value: T, schema: EnterpriseSchema): T;
export declare function assertEnterpriseEvidenceWithSchema<T extends EvidenceData>(
  value: T,
  schema: EnterpriseSchema,
): T;
export declare function assertEnterpriseSyncWithSchema<
  T extends VersionedData<EnterpriseSyncState>,
>(value: T, schema: EnterpriseSchema): T;
export declare function assertEnterpriseHandoffWithSchema<T extends HandoffData>(
  value: T,
  schema: EnterpriseSchema,
  assertThread: (thread: ThreadData) => unknown,
  assertEvidence: (evidence: EvidenceData) => unknown,
): T;
export declare function isEnterpriseRepositoryPathData(value: unknown): boolean;
export declare function renderEnterpriseHandoffMarkdownData(value: HandoffData): string;
