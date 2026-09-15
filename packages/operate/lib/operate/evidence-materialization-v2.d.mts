import type {
  OperatingArtifactV2,
  OperatingCycleInputBindingV2,
  OperatingEvidenceCandidateV2,
  OperatingEvidenceEdgeV2,
  OperatingEvidenceRefV2,
  OperatingEvidenceResolutionV2,
} from '@openplanr/protocol';
import type { OperateEvidenceRegistryV2 } from './evidence-registry-v2.mjs';
import type { OperateStaticEvidenceResolverContextV2 } from './evidence-v2.mjs';

/** Opaque machine-local byte custody; raw bytes never enter projections or Events. */
export interface OperatingArtifactByteStoreV2 {
  stageRaw(input: { artifact: OperatingArtifactV2; rawBytes: Uint8Array }): true;
  readRaw(input: { artifactId: string; rawHash: string }): Uint8Array;
}

export function createOperatingArtifactByteStoreV2(): OperatingArtifactByteStoreV2;

export function readOperatingArtifactRawBytesV2(
  store: OperatingArtifactByteStoreV2,
  identity: { artifactId: string; rawHash: string },
): Uint8Array;

export interface OperatingEvidenceClaimLinkProposalV2 {
  sourceArtifactId: string;
  localClaimId: string;
  relation: 'supportedBy' | 'contradictedBy';
  confidence: number;
}

export interface OperatingEvidenceMaterializationDraftV2 {
  resolutionId: string;
  eventId: string;
  timestamp: string;
  correlationId: string;
  evidenceRefId?: string;
  evidenceArtifactId?: string;
}

export interface OperatingEvidenceMaterializationInputV2 {
  candidate: OperatingEvidenceCandidateV2;
  sourceArtifact: OperatingArtifactV2;
  inputBinding: OperatingCycleInputBindingV2;
  registry: OperateEvidenceRegistryV2;
  resolverContext?: OperateStaticEvidenceResolverContextV2;
  draft: OperatingEvidenceMaterializationDraftV2;
  claimLinks?: readonly OperatingEvidenceClaimLinkProposalV2[];
}

export interface OperatingEvidenceMaterializationResultV2 {
  readonly outcome: 'resolved' | 'rejected';
  readonly requestHash: string;
  readonly outcomeHash: string;
  readonly resolution: OperatingEvidenceResolutionV2;
  readonly evidenceRef: OperatingEvidenceRefV2 | null;
  readonly evidenceArtifact: OperatingArtifactV2 | null;
  readonly edges: readonly OperatingEvidenceEdgeV2[];
  readonly captureHash: string | null;
}

export function buildOperatingEvidenceMaterializationV2(
  input: OperatingEvidenceMaterializationInputV2,
): OperatingEvidenceMaterializationResultV2;

export function deriveOperatingEvidenceEdgeIdV2(input: {
  sourceArtifactId: string;
  localClaimId: string;
  relation: 'supportedBy' | 'contradictedBy';
  evidenceRefId: string;
}): string;

/** @internal Runtime-only helpers; no bytes are serialised into their outputs. */
export function deriveOperatingEvidenceRequestHashV2(input: {
  candidate: OperatingEvidenceCandidateV2;
  claimLinks?: readonly OperatingEvidenceClaimLinkProposalV2[];
  draft: OperatingEvidenceMaterializationDraftV2;
}): string;

/** @internal */
export function validateOperatingEvidenceSourcePayloadV2(input: {
  sourceArtifact: OperatingArtifactV2;
  artifactStore: OperatingArtifactByteStoreV2;
  candidate: OperatingEvidenceCandidateV2;
  claimLinks?: readonly OperatingEvidenceClaimLinkProposalV2[];
}): Readonly<{
  candidate: OperatingEvidenceCandidateV2;
  claimLinks: readonly OperatingEvidenceClaimLinkProposalV2[];
}>;

/** @internal */
export function stageOperatingEvidenceMaterializationBlobV2(
  materialization: OperatingEvidenceMaterializationResultV2,
  store: OperatingArtifactByteStoreV2,
): true | null;

/** @internal */
export function setOperatingEvidenceMaterializationBlobV2(
  materialization: OperatingEvidenceMaterializationResultV2,
  rawBytes: Uint8Array,
): true;
