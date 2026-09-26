import type { DesignImplementationHandoff } from '@openplanr/protocol/design-handoff-contracts';
import type {
  ImplementationHandoffInput,
  ImplementationSourceResolver,
} from './implementation-handoff.mjs';

export type ImplementationHandoffActor = {
  id: string;
  role: 'owner' | 'maintainer';
  capabilities: string[];
  sessionExpiresAt?: string;
};
export type ImplementationHandoffIdentity = { id: string; version: number; contentDigest?: string };
export type ImplementationHandoffApprovalOptions = {
  actor: ImplementationHandoffActor;
  clock?: () => Date | string;
  currentBasis?: DesignImplementationHandoff['basis'];
  resolveSource?: ImplementationSourceResolver;
};
export type ImplementationHandoffPointer = {
  kind: 'openplanr-design-implementation-handoff-current';
  schemaVersion: '1.0.0';
  id: string;
  version: number;
  contentDigest: string;
  status: 'approved' | 'superseded' | 'revoked';
  authority: 'prepare-plan';
  eventId: string;
  updatedAt: string;
};

export declare const IMPLEMENTATION_HANDOFF_APPROVE_CAPABILITY: 'design:implementation-handoff:approve';
export declare const IMPLEMENTATION_HANDOFF_REVOKE_CAPABILITY: 'design:implementation-handoff:revoke';
export declare function implementationHandoffApprovalPaths(
  root: string,
): Readonly<Record<string, string>>;
export declare function recoverImplementationHandoffApproval(root: string): boolean;
export declare function readImplementationHandoffVersion(
  root: string,
  identity: ImplementationHandoffIdentity,
): DesignImplementationHandoff;
export declare function listImplementationHandoffHistory(
  root: string,
): DesignImplementationHandoff[];
export declare function readImplementationHandoffLifecycle(root: string): Readonly<{
  current: ImplementationHandoffPointer | null;
  history: DesignImplementationHandoff[];
  events: unknown[];
}>;
export declare function previewImplementationHandoffApproval(root: string): Readonly<{
  available: boolean;
  summary: null | {
    title: string;
    packageVersion: number;
    selectedVariant: string;
    requirementCount: number;
    unresolvedNonblockingItems: number;
    effect: 'Prepare Plan';
    description: string;
  };
  approvalRequest: null | { expectedVersion: number; expectedContentDigest: string };
}>;
export declare function approveImplementationHandoff(
  root: string,
  request: { requestId: string; expectedVersion: number; expectedContentDigest: string },
  options: ImplementationHandoffApprovalOptions,
): {
  package: DesignImplementationHandoff;
  current: ImplementationHandoffPointer;
  event: unknown;
  repeated: boolean;
};
export declare function supersedeImplementationHandoff(
  root: string,
  replacement: DesignImplementationHandoff,
  request: { requestId: string },
  options: ImplementationHandoffApprovalOptions,
): { current: ImplementationHandoffPointer; event: unknown; repeated: boolean } | null;
export declare function regenerateImplementationHandoffDraft(
  root: string,
  input: ImplementationHandoffInput,
  request: { requestId: string },
  options: ImplementationHandoffApprovalOptions,
): { draft: DesignImplementationHandoff; supersession: unknown };
export declare function revokeImplementationHandoff(
  root: string,
  request: {
    requestId: string;
    expectedVersion: number;
    expectedContentDigest: string;
    reason: string;
  },
  options: ImplementationHandoffApprovalOptions,
): { current: ImplementationHandoffPointer; event: unknown; repeated: boolean };
export declare function compareImplementationHandoffVersions(
  root: string,
  left: ImplementationHandoffIdentity | 'draft',
  right: ImplementationHandoffIdentity | 'draft',
): Readonly<Record<string, unknown>>;
