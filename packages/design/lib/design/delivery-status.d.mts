import type { DesignImplementationHandoff, DesignPlanningLineage } from '@openplanr/protocol/design-handoff-contracts';

export type DesignDeliveryPhase = 'approved' | 'planned' | 'implementing' | 'verified';
export declare function projectDesignDeliveryStatus(input?: {
  handoff: DesignImplementationHandoff;
  currentHandoff?: { id: string; version: number; contentDigest: string; status?: string } | null;
  lineage?: DesignPlanningLineage | null;
  tasks?: Array<{ id: string; status: string }>;
  shipClosure?: { runId?: string; state?: string } | null;
}): Readonly<{ kind: 'openplanr-design-delivery-status'; schemaVersion: '1.0.0'; designPackage: { id: string; version: number; contentDigest: string }; phase: DesignDeliveryPhase; stale: boolean; blocked: boolean; detail: string; taskIds: string[]; blockedTaskIds: string[]; shipRunId: string | null }>;
