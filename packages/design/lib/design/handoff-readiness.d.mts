import type {
  DesignHandoffDigest,
  DesignHandoffReadiness,
  DesignHandoffReadinessAbsence,
} from '@openplanr/protocol/design-handoff-contracts';

export interface DesignHandoffReadinessInput {
  document: {
    kind: 'openplanr-design-document';
    schemaVersion: '1.0.0';
    id: string;
    selectedVariant?: string;
    variants?: Array<{ id: string; status: string }>;
  };
  documentPath?: string;
  sourceRevision?: string | null;
  studioState?: { selectedVariant?: string };
  studioStatePath?: string;
  specification?: { path?: string; digest?: string; revision?: string; complete?: boolean };
  verification?: { path?: string; digest?: string; revision?: string; status?: string };
  review?: {
    path?: string;
    digest?: string;
    revision?: string;
    current?: boolean;
    ambiguous?: boolean;
    pins?: Array<{
      id: string;
      reviewId?: string;
      revisionId?: string;
      stale?: boolean;
      screenId?: string;
      elementId?: string;
      anchorCount?: number;
      category?: string;
      disposition?: string;
    }>;
  };
  reviewHandoff?: {
    path?: string;
    digest?: string;
    status?: string;
    current?: boolean;
    contentHash?: string;
    approval?: { contentHash?: string };
    basis?: { designId?: string; sourceRevision?: string; selectedVariant?: string };
  };
}

export declare function compileDesignHandoffReadiness(input?: DesignHandoffReadinessInput | null): DesignHandoffReadiness | DesignHandoffReadinessAbsence;
export declare function designHandoffReadinessAbsence(reason?: 'not-computed' | 'not-applicable' | 'unavailable'): DesignHandoffReadinessAbsence;
export declare function designHandoffReadinessDigest(value: DesignHandoffReadiness | DesignHandoffReadinessAbsence): DesignHandoffDigest;
export declare function canContinueDesignHandoff(value: DesignHandoffReadiness | DesignHandoffReadinessAbsence | null | undefined): boolean;
