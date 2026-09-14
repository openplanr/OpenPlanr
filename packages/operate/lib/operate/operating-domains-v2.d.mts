import type {
  OperatingArtifactV2,
  OperatingModelStateV2,
  OperatingSnapshotV2,
  OperateDomainRegistrationV2,
} from '@openplanr/protocol';
import type { OperateExtensionRegistryV2 } from './extensions-v2.d.mts';

export interface PublicOperatingDomainContractV2 {
  apiDomainId: 'business' | 'software';
  id: 'business-domain' | 'software-domain';
  version: '1.0.0';
  projection: {
    schemaId: 'business-operating-snapshot-projection' | 'software-operating-snapshot-projection';
    schemaVersion: '1.0.0';
  };
}

export const PUBLIC_OPERATING_DOMAIN_CONTRACTS_V2: Readonly<Record<'business' | 'software', PublicOperatingDomainContractV2>>;

export interface PublicOperatingDomainSummaryV2 {
  readonly domainId: 'business' | 'software';
  readonly domainVersion: '1.0.0';
  readonly domainContract: {
    readonly apiDomainId: 'business' | 'software';
    readonly id: 'business-domain' | 'software-domain';
    readonly version: '1.0.0';
  };
  readonly roles: readonly {
    readonly roleId: string;
    readonly roleKind: 'advisor' | 'challenger' | 'chair';
    readonly roleVersion: string;
    readonly label: string;
  }[];
}

export class OperatingDomainProjectionErrorV2 extends Error {
  code: string;
  details: Readonly<Record<string, unknown>>;
}

export function resolvePublicOperatingDomainV2(
  registry: OperateExtensionRegistryV2,
  domainId: 'business' | 'software',
  options: { domainVersion: '1.0.0' },
): OperateDomainRegistrationV2 | null;

export function listPublicOperatingDomainsV2(
  registry?: OperateExtensionRegistryV2,
): readonly Readonly<PublicOperatingDomainSummaryV2>[];

export function projectPublicOperatingDomainV2(input: {
  registry?: OperateExtensionRegistryV2;
  state: OperatingModelStateV2;
  snapshot: OperatingSnapshotV2;
  referencedArtifacts: readonly OperatingArtifactV2[];
}): Readonly<Record<string, unknown>>;
