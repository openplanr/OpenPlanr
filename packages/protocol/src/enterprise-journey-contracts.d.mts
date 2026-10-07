import type { EnterpriseReviewAnchorV11 } from './enterprise-resource-contracts.mjs';
import type { CompanyResourceManifest } from './large-object-contracts.mjs';
export declare const ENTERPRISE_JOURNEY_PROTOCOL_VERSION: '1.19.0';
export type EnterpriseJourneyFeature =
  | 'resource-draft'
  | 'resource-publication'
  | 'fixed-guest'
  | 'project-lifecycle'
  | 'review-mentions'
  | 'scoped-pages';
export interface EnterpriseJourneyEnvelope {
  schemaVersion: '1.0.0';
  protocolVersion: '1.19.0';
}
export interface EnterpriseJourneyScope {
  organizationId: string;
  projectId: string;
}
export interface EnterpriseJourneyArtifact extends EnterpriseJourneyScope {
  artifactId: string;
}
export interface EnterprisePublicationPin {
  revisionId: string;
  contentDigest: string;
  publicationId: string;
}
export interface EnterpriseGuestInvitation
  extends EnterpriseJourneyEnvelope,
    EnterpriseJourneyArtifact {
  kind: 'openplanr-enterprise-guest-invitation';
  invitationId: string;
  deliveryOperationId: string;
  inviterId: string;
  recipientId: string;
  role: 'reviewer' | 'viewer';
  binding: 'fixed';
  pin: EnterprisePublicationPin;
  deliveryStatus: 'queued' | 'failed' | 'delivered' | 'expired';
  grantStatus: 'pending' | 'active' | 'denied' | 'revoked';
  createdAt: string;
  expiresAt: string;
}
export interface EnterpriseGuestAuthorization
  extends EnterpriseJourneyEnvelope,
    EnterpriseJourneyArtifact {
  kind: 'openplanr-enterprise-guest-authorization';
  authorizationId: string;
  operationId: string;
  invitationId: string;
  actorId: string;
  role: 'reviewer' | 'viewer';
  binding: 'fixed';
  pin: EnterprisePublicationPin;
  status: 'pending' | 'active' | 'denied' | 'revoked';
  lifecycleEpoch: number;
  expiresAt: string;
  receipt?: {
    receiptId: string;
    operationId: string;
    authorizedAt: string;
    publicationHeadAdvanced: false;
  };
}
export type EnterpriseCatalogQuery =
  | {
      organizationId: string;
      actorId: string;
      scope: 'projects';
      filter: { status: 'all' | 'active' | 'archived'; search: string };
    }
  | {
      organizationId: string;
      projectId: string;
      actorId: string;
      scope: 'artifacts';
      filter: EnterpriseArtifactFilter;
    }
  | {
      organizationId: string;
      actorId: string;
      scope: 'organization-reviews';
      filter: EnterpriseArtifactFilter;
    };
export type EnterpriseReviewQuery =
  | {
      organizationId: string;
      projectId: string;
      actorId: string;
      scope: 'project-reviews';
      filter: EnterpriseArtifactFilter;
    }
  | Extract<EnterpriseCatalogQuery, { scope: 'organization-reviews' }>;
export type EnterprisePageQuery = EnterpriseCatalogQuery | EnterpriseReviewQuery;
export interface EnterpriseArtifactFilter {
  kind: 'all' | 'diagram' | 'design' | 'artifact';
  contentFormat?:
    | 'all'
    | 'diagram-authoring'
    | 'design-review'
    | 'planning-document'
    | 'generic-artifact';
  status: 'all' | 'active' | 'archived';
  search: string;
}
export interface EnterprisePageCursor {
  token: string;
  queryDigest: string;
}
export interface EnterpriseProjectPage extends EnterpriseJourneyEnvelope {
  kind: 'openplanr-enterprise-project-page';
  query: Extract<EnterprisePageQuery, { scope: 'projects' }>;
  items: (EnterpriseJourneyScope & {
    slug: string;
    name: string;
    status: 'active' | 'archiving' | 'archived' | 'restoring';
    capabilities: import('./enterprise-contracts.mjs').EnterpriseAction[];
  })[];
  nextCursor: EnterprisePageCursor | null;
}
export interface EnterpriseArtifactPage extends EnterpriseJourneyEnvelope {
  kind: 'openplanr-enterprise-artifact-page';
  query: Extract<EnterprisePageQuery, { scope: 'artifacts' }>;
  items: (EnterpriseJourneyArtifact & {
    kind: 'diagram' | 'design' | 'artifact';
    contentFormat: 'diagram-authoring' | 'design-review' | 'planning-document' | 'generic-artifact';
    title: string;
    /** Null until the artifact has a saved revision. */
    revisionId: string | null;
    status: 'active' | 'archived';
    capabilities: import('./enterprise-contracts.mjs').EnterpriseAction[];
  })[];
  nextCursor: EnterprisePageCursor | null;
}
export interface EnterpriseReviewProjection extends EnterpriseJourneyEnvelope {
  kind: 'openplanr-enterprise-review-projection';
  query: EnterpriseReviewQuery;
  items: (EnterpriseJourneyArtifact & {
    threadId: string;
    revisionId: string;
    publicationId: string;
    category: 'question' | 'suggestion' | 'change-request' | 'blocker';
    status: 'open' | 'addressed' | 'resolved';
    updatedAt: string;
  })[];
  nextCursor: EnterprisePageCursor | null;
  index: { status: 'current' | 'lagging'; watermark: string };
}
export interface EnterpriseReviewMention
  extends EnterpriseJourneyEnvelope,
    EnterpriseJourneyArtifact {
  kind: 'openplanr-enterprise-review-mention';
  operationId: string;
  actorId: string;
  threadId: string;
  anchor: EnterpriseReviewAnchorV11;
  recipients: string[];
  authority: 'notification-only';
}
export interface EnterpriseProjectLifecycle
  extends EnterpriseJourneyEnvelope,
    EnterpriseJourneyScope {
  kind: 'openplanr-enterprise-project-lifecycle';
  status: 'active' | 'archiving' | 'archived' | 'restoring';
  version: number;
  epoch: number;
  updatedAt: string;
  operation?: {
    operationId: string;
    action: 'archive' | 'restore';
    expectedVersion: number;
    previousEpoch: number;
    inventoryDigest: string;
    artifactCount: number;
    acknowledgedCount: number;
    acknowledgedInventoryDigest: string | null;
  };
  receipt?: {
    receiptId: string;
    operationId: string;
    action: 'archive' | 'restore';
    version: number;
    epoch: number;
    completedAt: string;
  };
}
export interface EnterpriseProjectTransition
  extends EnterpriseJourneyEnvelope,
    EnterpriseJourneyScope {
  kind: 'openplanr-enterprise-project-transition';
  operationId: string;
  actorId: string;
  action: 'archive' | 'restore';
  expectedVersion: number;
  expectedEpoch: number;
}
export interface EnterpriseJourneyCapabilities extends EnterpriseJourneyEnvelope {
  kind: 'openplanr-enterprise-journey-capabilities';
  readers: EnterpriseJourneyFeature[];
  writers: EnterpriseJourneyFeature[];
  rollbackFloor: { protocolVersion: '1.19.0'; serviceVersion: string; candidateDigest: string };
}
export interface CompanyResourcePreparationV21 {
  schemaVersion: '2.1.0';
  protocolVersion: '1.19.0';
  operationId: string;
  baseRevisionId: string | null;
  manifest: CompanyResourceManifest;
  intent: 'draft' | 'publish';
  expectedVersion: number;
  lifecycleEpoch: number;
}
export type CompanyResourceReceiptV21 = EnterpriseJourneyArtifact & {
  schemaVersion: '2.1.0';
  protocolVersion: '1.19.0';
  operationId: string;
  revisionId: string;
  manifestSha256: string;
  contentDigest: string;
  status: 'committed';
  committedAt: string;
  baseRevisionId: string | null;
  version: number;
  lifecycleEpoch: number;
} & (
    | {
        intent: 'draft';
        effect: { kind: 'draft'; authorHeadRevisionId: string; publicationHeadUnchanged: true };
      }
    | {
        intent: 'publish';
        effect: {
          kind: 'publication';
          authorHeadRevisionId: string;
          publicationId: string;
          publicationRevisionId: string;
        };
      }
  );
export interface CompanyResourceStatusV21 {
  schemaVersion: '2.1.0';
  protocolVersion: '1.19.0';
  operationId: string;
  revisionId: string;
  manifestSha256: string;
  intent: 'draft' | 'publish';
  lifecycleEpoch: number;
  expiresAt: string;
  status: 'prepared' | 'committed' | 'cancelled' | 'expired';
  receivedChunks: { index: number; sha256: string; byteLength: number }[];
  receipt?: CompanyResourceReceiptV21;
}
export interface EnterpriseJourneyContracts {
  'enterprise-guest-invitation': EnterpriseGuestInvitation;
  'enterprise-guest-authorization': EnterpriseGuestAuthorization;
  'enterprise-project-page': EnterpriseProjectPage;
  'enterprise-artifact-page': EnterpriseArtifactPage;
  'enterprise-review-projection': EnterpriseReviewProjection;
  'enterprise-review-mention': EnterpriseReviewMention;
  'enterprise-project-lifecycle': EnterpriseProjectLifecycle;
  'enterprise-project-transition': EnterpriseProjectTransition;
  'enterprise-journey-capabilities': EnterpriseJourneyCapabilities;
  'company-resource-upload-prepare': CompanyResourcePreparationV21;
  'company-resource-upload-receipt': CompanyResourceReceiptV21;
  'company-resource-upload-status': CompanyResourceStatusV21;
}
export declare const ENTERPRISE_JOURNEY_READER_REQUIREMENTS: Readonly<
  Record<EnterpriseJourneyFeature, readonly EnterpriseJourneyFeature[]>
>;
export declare const ENTERPRISE_JOURNEY_FEATURES: readonly EnterpriseJourneyFeature[];
export declare const ENTERPRISE_JOURNEY_SCHEMAS: Readonly<
  Record<keyof EnterpriseJourneyContracts, Record<string, unknown>>
>;
export declare const ENTERPRISE_GUEST_INVITATION_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_GUEST_AUTHORIZATION_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_ARTIFACT_PAGE_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_PROJECT_PAGE_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_REVIEW_PROJECTION_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_REVIEW_MENTION_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_PROJECT_LIFECYCLE_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_PROJECT_TRANSITION_SCHEMA: Record<string, unknown>;
export declare const ENTERPRISE_JOURNEY_CAPABILITIES_SCHEMA: Record<string, unknown>;
export declare const COMPANY_RESOURCE_UPLOAD_PREPARE_V21_SCHEMA: Record<string, unknown>;
export declare const COMPANY_RESOURCE_UPLOAD_RECEIPT_V21_SCHEMA: Record<string, unknown>;
export declare const COMPANY_RESOURCE_UPLOAD_STATUS_V21_SCHEMA: Record<string, unknown>;
export declare function assertEnterpriseJourneyContract<K extends keyof EnterpriseJourneyContracts>(
  value: unknown,
  kind: K,
): EnterpriseJourneyContracts[K];
export declare function assertEnterpriseJourneyContract(
  value: unknown,
  kind: string,
): EnterpriseJourneyContracts[keyof EnterpriseJourneyContracts];
export declare function enterprisePageQueryDigest(value: unknown): string;
export declare function assertEnterpriseJourneyWrite(
  capabilities: unknown,
  feature: EnterpriseJourneyFeature,
): EnterpriseJourneyFeature;
export declare function assertCompanyResourcePreparationRetry(
  previous: unknown,
  next: unknown,
): CompanyResourcePreparationV21;
export declare function assertEnterpriseMentionRecipients(
  value: unknown,
  authorization: EnterpriseJourneyArtifact & {
    actorId: string;
    revisionId: string;
    recipientIds: string[];
  },
): EnterpriseReviewMention;
export declare function assertEnterpriseFixedGuestAccess(
  value: unknown,
  requested: EnterpriseJourneyArtifact &
    EnterprisePublicationPin & { actorId: string; lifecycleEpoch: number },
  now: string,
): EnterprisePublicationPin;
export declare function enterpriseProjectAdmission(value: unknown, epoch: number): boolean;

export declare function assertEnterpriseProjectTransition(
  value: unknown,
  current: unknown,
): EnterpriseProjectTransition;
export declare function assertCompanyResourceCommitReceipt(
  value: unknown,
  preparation: unknown,
): CompanyResourceReceiptV21;

export declare function assertEnterpriseGuestAuthorizationReceipt(
  value: unknown,
  invitation: unknown,
  now: string,
): EnterpriseGuestAuthorization;
