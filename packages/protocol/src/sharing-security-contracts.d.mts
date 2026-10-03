export declare const ROOM_V3_VERSION: '3.0.0';
export declare const ROOM_V3_API: '/api/v2/rooms';
export declare const ROOM_V3_GENESIS_HASH: string;
export declare const ROOM_V3_CAPABILITIES: Readonly<{
  read: 'room-read';
  reviewer: 'reviewer-write';
  owner: 'owner-verdict';
  management: 'room-management';
}>;
export declare const SHARING_CRYPTO_VERSION: '2.0.0';
export declare const SHARING_CRYPTO_CONTEXT: string;
export declare const ROOM_V3_DESCRIPTOR_SCHEMA: Record<string, unknown>;
export declare const ROOM_V3_CREATE_SCHEMA: Record<string, unknown>;
export declare const ROOM_V3_EVENT_SCHEMA: Record<string, unknown>;
export declare const ROOM_V3_MANAGEMENT_SCHEMA: Record<string, unknown>;
export declare const PASTE_V2_SCHEMA: Record<string, unknown>;
export declare const SHARING_CRYPTO_AAD_SCHEMA: Record<string, unknown>;
export declare const SHARING_SECURITY_SCHEMAS: Readonly<Record<string, Record<string, unknown>>>;
export declare function assertSharingSecurityContract<T>(value: T, kind: string): T;
export declare function roomV3SignatureBytes(
  type: 'create' | 'event' | 'management',
  value: Record<string, unknown>,
): Uint8Array;
export declare function verifyRoomV3Signature(
  type: 'create' | 'event' | 'management',
  value: Record<string, unknown>,
  publicKey: { algorithm: string; encoding: string; keyId: string; value: string },
  options?: { crypto?: Crypto },
): Promise<boolean>;

export type PreviewBridgeMessage = { schemaVersion: '1.0.0'; channel: string; viewId: string } & (
  | { type: 'ready' }
  | { type: 'navigate'; screenId: string }
  | { type: 'select'; elementId: string }
  | {
      type: 'state';
      state: { session: Record<string, unknown>; forms: Record<string, Record<string, unknown>> };
    }
  | { type: 'failed' }
);
export declare const PREVIEW_BRIDGE_MESSAGE_SCHEMA: Record<string, unknown>;
export declare function assertPreviewBridgeMessage<T>(value: T): T;

export declare const ROOM_V3_READ_LIMITS: Readonly<{
  pageBytes: number;
  eventPageBytes: number;
  eventPageCount: number;
  aggregateBytes: number;
  projectionBytes: number;
  retainedEvents: number;
}>;
export declare const ROOM_V3_READ_PAGE_SCHEMA: Record<string, unknown>;

export declare const ROOM_V3_APPEND_SCHEMA: Record<string, unknown>;

export interface RoomV3ManagementRequest {
  schemaVersion: '3.0.0';
  roomId: string;
  operation: 'pause' | 'resume' | 'delete';
  operationId: string;
  expectedGeneration: number;
  signature: string;
}
