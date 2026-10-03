export interface OwnerCustodyOptions {
  custodyRoot?: string;
  env?: Record<string, string | undefined>;
}
export interface OwnerCustodyLocation {
  root: string;
  path: string;
  legacyPath?: string | null;
}
export interface OwnerCustodyRecord {
  kind: string;
  schemaVersion: '1.0.0';
  custody: unknown;
}
export interface OwnerCustodyContext<RecordType> extends OwnerCustodyLocation {
  record: RecordType | null;
  save(value?: RecordType): void;
}
export function ownerCustodyLocation(input: {
  sourceRoot: string;
  sourceId: string;
  namespace: string;
  label?: string;
  options?: OwnerCustodyOptions;
  allowMissing?: boolean;
}): OwnerCustodyLocation;
export function withOwnerCustody<RecordType, Result>(
  location: OwnerCustodyLocation,
  options: { label?: string; format: string },
  action: (context: OwnerCustodyContext<RecordType>) => Promise<Result> | Result,
): Promise<Result>;
export function resolveRecoveryOutputPath(output: string): string;
export function ensurePrivateDirectory(
  root: string,
  options?: { label?: string; recoveryOutput?: boolean },
): void;
export function readCustody<RecordType extends OwnerCustodyRecord = OwnerCustodyRecord>(
  path: string,
  options?: { label?: string; format?: string; recoveryInput?: boolean },
): RecordType | null;
export function writeCustody(path: string, record: unknown, options?: { label?: string }): void;
