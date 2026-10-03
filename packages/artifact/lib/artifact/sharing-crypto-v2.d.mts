export interface SharingContext {
  version: '2.0.0';
  purpose: 'artifact-paste' | 'room-envelope' | 'room-event';
  objectId: string;
  recordId: string;
}
export declare function encryptSharingPayload(
  bytes: Uint8Array,
  options: { key?: string; context: SharingContext; limit?: number },
): Promise<{ version: '2.0.0'; iv: string; ciphertext: string; keyFragment: string }>;
export declare function decryptSharingPayload(
  payload: { version: string; iv: string; ciphertext: string },
  options: { key: string; context: SharingContext; limit?: number },
): Promise<Uint8Array>;
