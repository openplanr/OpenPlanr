import type {
  CompanyResourceUploadPrepare,
  EncryptedUploadPrepare,
} from '@openplanr/protocol/large-object-contracts';
export type PreparedUpload = EncryptedUploadPrepare | CompanyResourceUploadPrepare;
export interface PendingUploadCustody {
  id: string;
  pendingCreate?: EncryptedUploadPrepare;
  pendingMutation?: { action: string; body: EncryptedUploadPrepare };
  spoolDirectory?: string;
}
export declare function persistPreparedUploadSpool(
  body: PreparedUpload,
  chunks: Uint8Array[],
  directory: string,
): Promise<string>;
export declare function preparedUploadChunkReader(
  directory: string,
  body: PreparedUpload,
): (index: number) => Promise<Uint8Array>;
export declare const spoolChunkReader: typeof preparedUploadChunkReader;
export declare function persistUploadSpool(
  custody: PendingUploadCustody,
  root: string,
): Promise<string | undefined>;
export declare function copyUploadSpool(
  custody: PendingUploadCustody,
  destination: string,
): Promise<string | null>;
export declare function readPreparedUploadRequest(directory: string): PreparedUpload;
