import type { DesignImplementationHandoff } from '@openplanr/protocol/design-handoff-contracts';

export type ImplementationRequirementInput = Omit<
  DesignImplementationHandoff['requirements'][number],
  'id'
> & { id?: string };
export type ImplementationHandoffInput = Omit<
  DesignImplementationHandoff,
  | 'kind'
  | 'schemaVersion'
  | 'status'
  | 'authority'
  | 'contentDigest'
  | 'markdown'
  | 'requirements'
  | 'approval'
  | 'supersededBy'
  | 'revocation'
> & {
  requirements: ImplementationRequirementInput[];
};
export type ImplementationSourceResolution =
  | string
  | Uint8Array
  | {
      bytes?: string | Uint8Array;
      value?: string | Uint8Array;
      anchors?: NonNullable<DesignImplementationHandoff['sources'][number]['anchor']>[];
    };
export type ImplementationSourceResolver = (
  path: string,
  source: DesignImplementationHandoff['sources'][number],
) => ImplementationSourceResolution;
export type ImplementationHandoffPaths = Readonly<{
  directory: string;
  draftJson: string;
  draftMarkdown: string;
  journal: string;
  current: string;
  history: string;
}>;

export declare function deriveImplementationRequirementId(
  requirement: ImplementationRequirementInput,
): string;
export declare function composeImplementationHandoff(
  input: ImplementationHandoffInput,
): DesignImplementationHandoff;
export declare function assertImplementationHandoffProjection(
  value: unknown,
): DesignImplementationHandoff;
export declare function verifyImplementationHandoffSources(
  value: DesignImplementationHandoff,
  resolveSource: ImplementationSourceResolver,
): DesignImplementationHandoff;
export declare function createRepositorySourceResolver(root: string): ImplementationSourceResolver;
export declare function implementationHandoffPaths(root: string): ImplementationHandoffPaths;
export declare function recoverImplementationHandoffDraft(root: string): boolean;
export declare function readImplementationHandoffDraft(
  root: string,
  options?: { allowMissing?: boolean },
): DesignImplementationHandoff | null;
export declare function writeImplementationHandoffDraft(
  root: string,
  input: ImplementationHandoffInput | DesignImplementationHandoff,
  options?: { resolveSource?: ImplementationSourceResolver },
): DesignImplementationHandoff;
export declare function exportImplementationHandoffPackage(
  value: DesignImplementationHandoff,
): Readonly<{ json: string; markdown: string }>;
export declare function importImplementationHandoffPackage(
  input: { json: string; markdown: string },
  options?: { resolveSource?: ImplementationSourceResolver },
): DesignImplementationHandoff;
