import type { OperatingModelStateV2, OperatingSnapshotV2 } from '@openplanr/protocol';
import type {
  OperatingModelStateCollectionsV2,
  OperatingModelStateScopeV2,
} from './operating-state-v2.d.mts';

export interface OperatingSnapshotManifestV2 {
  scope: OperatingModelStateScopeV2;
  domainContract: { apiDomainId: string; id: string; version: string };
  sourceArtifactIds: readonly string[];
  evidenceRefIds?: readonly string[];
  sourceRevisions?: readonly Array<{
    sourceArtifactId: string;
    revision: string;
    evidenceRefIds?: readonly string[];
  }>;
  collections: OperatingModelStateCollectionsV2;
}

export interface OperatingSnapshotStateDraftV2 {
  snapshotId: string;
  stateId: string;
  timestamp: string;
}

export function deriveOperatingSnapshotRuntimeHashV2(snapshot: OperatingSnapshotV2): string;
export function assertOperatingSnapshotV2(
  snapshot: OperatingSnapshotV2,
  options?: { state?: OperatingModelStateV2; previousSnapshotId?: string | null },
): OperatingSnapshotV2;
export function buildOperatingSnapshotStateTransactionV2(
  request: OperatingSnapshotManifestV2,
  draft: OperatingSnapshotStateDraftV2,
  options?: { previousSnapshots?: readonly OperatingSnapshotV2[] },
): Readonly<{ snapshot: OperatingSnapshotV2; state: OperatingModelStateV2 }>;
