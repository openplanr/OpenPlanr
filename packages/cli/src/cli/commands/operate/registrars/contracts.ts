import type { OperateAssignmentPacketService } from '../../../../services/operate/assignment-packet-service.js';
import type { OperateClient } from '../../../../services/operate/client.js';
import type { PublicOperatingDomain } from '../../../../services/operate/domain-catalog-service.js';

export type OperateDashboardInput = {
  projectDir: string;
  cycleId: string;
  actorId: string;
  port?: number;
  watch?: boolean;
};

export type OperateNoteValidationProfile = 'advisor' | 'challenger' | 'chair' | 'board-report';
export type OperateNoteContractVersion = '1.0.0' | '2.0.0';
export type OperateNoteContractVersionSelector = 'auto' | OperateNoteContractVersion;
export type OperateNoteContractVersionSource = 'declared' | 'structure' | 'default' | 'requested';

export type OperateNoteValidationDiagnostic = {
  code: string;
  message: string;
};

export type OperateNoteValidationResult = {
  ok: boolean;
  profile: OperateNoteValidationProfile;
  contractVersion: OperateNoteContractVersion;
  contractKind: 'operate-human-review-contract' | 'operate-review-quality-contract';
  versionSource: OperateNoteContractVersionSource;
  byteLength: number;
  itemCount: number;
  diagnostics: readonly OperateNoteValidationDiagnostic[];
};

export type OperateCommandRegistrationDependencies = {
  createClient(projectDir: string): Promise<OperateClient>;
  createAssignmentPacketService(projectDir: string): Promise<OperateAssignmentPacketService>;
  listDomains(): Promise<readonly PublicOperatingDomain[]>;
  startDashboard(input: OperateDashboardInput): Promise<{ url: string }>;
  inspectOperateReviewNote(
    markdown: string,
    options: {
      profile: OperateNoteValidationProfile;
      contractVersion?: OperateNoteContractVersionSelector;
    },
  ): Promise<OperateNoteValidationResult>;
};
