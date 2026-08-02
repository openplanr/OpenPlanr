import { OPERATE_SCHEMA_VERSION, type OperatingCheckpoint, type OperatingEvent, type OperatingEventType, type OperatingRecordEnvelope, type OperatingSensitivity, type OperatingState } from './types.js';
/**
 * Protocol v1.3 (FR5/E-005) serializes each immutable content-addressed record
 * as a single canonical line in the append-only `.state/records.jsonl`, declared
 * as `operating-records-log-entry@1.3.0`. It carries the same field set as the
 * v1.2 `operating-record`, retaining the content-address `digest` as a field,
 * so the container change is lossless and reversible.
 */
export interface OperatingRecordsLogEntry {
    kind: 'operating-records-log-entry';
    schemaVersion: typeof OPERATE_SCHEMA_VERSION;
    protocolVersion: '1.3.0' | '1.4.0';
    digest: `sha256:${string}`;
    recordType: OperatingRecordEnvelope['recordType'];
    createdAt: string;
    correlationId: string;
    contentDigest: `sha256:${string}`;
    content: Record<string, unknown>;
}
/** Map a v1.2 `operating-record` envelope to its v1.3 records-log entry. */
export declare function operatingRecordToLogEntry(record: OperatingRecordEnvelope): OperatingRecordsLogEntry;
/** Exact inverse of {@link operatingRecordToLogEntry}. */
export declare function logEntryToOperatingRecord(entry: OperatingRecordsLogEntry): OperatingRecordEnvelope;
/** One canonical `.state/records.jsonl` line (no trailing newline) for a record. */
export declare function operatingRecordsLogLine(record: OperatingRecordEnvelope): string;
export interface EventStoreOptions {
    localRoot?: string;
}
export interface AppendOperatingEventInput {
    type: OperatingEventType;
    cycleId: string;
    entityId: string;
    payload?: Record<string, unknown>;
    /**
     * Additive Protocol v1.3 passthrough. Defaults to the frozen v1.2 event
     * contract; a caller embedding v1.3-only content (a `route.proposed` payload
     * carrying a `create-quick-task` route plan) stamps `1.3.0`, whose event
     * schema accepts either route-plan version. Every existing caller omits it and
     * is byte-identical.
     */
    protocolVersion?: string;
    actor?: OperatingEvent['actor'];
    timestamp?: string;
    eventId?: string;
    correlationId?: string;
    causationId?: string | null;
    evidenceRefs?: string[];
    expectedHead?: OperatingEvent['previousEventHash'];
}
export interface ReplayResult {
    events: OperatingEvent[];
    eventHead: {
        sequence: number;
        hash: `sha256:${string}` | null;
    };
}
export declare class OperatingEventStore {
    readonly projectRoot: string;
    readonly options: EventStoreOptions;
    readonly paths: import("./workspace.js").OperatingPaths;
    constructor(projectRoot: string, options?: EventStoreOptions);
    initialize(): Promise<void>;
    private effectiveEventsPath;
    private effectiveCheckpointPath;
    replay(): Promise<ReplayResult>;
    putRecord(recordType: OperatingRecordEnvelope['recordType'], content: Record<string, unknown>, options: {
        createdAt?: string;
        correlationId: string;
        sensitivity?: OperatingSensitivity;
    }): Promise<OperatingRecordEnvelope>;
    readRecord(digest: `sha256:${string}`): Promise<OperatingRecordEnvelope>;
    append(input: AppendOperatingEventInput): Promise<OperatingEvent>;
    state(checkpoint?: OperatingCheckpoint | null): Promise<OperatingState>;
    writeCheckpoint(state?: OperatingState, options?: {
        signer?: (payload: string) => {
            algorithm: 'ed25519' | 'hmac-sha256';
            keyId: string;
            value: string;
        };
    }): Promise<OperatingCheckpoint>;
    readCheckpoint(options?: {
        verifySignature?: (payload: string, signature: {
            algorithm: 'ed25519' | 'hmac-sha256';
            keyId: string;
            value: string;
        }) => boolean;
        requireSignatureVerification?: boolean;
    }): Promise<OperatingCheckpoint | null>;
    private listRecordDigests;
}
//# sourceMappingURL=event-store.d.ts.map