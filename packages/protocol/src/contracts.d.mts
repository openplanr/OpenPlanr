export interface ResolvedProtocolSchema { kind: string; protocolVersion: string; path: string; schema: Record<string, unknown> }
export declare const PROTOCOL_SCHEMA_REGISTRY: Readonly<Record<string, Readonly<Record<string, string>>>>;
export declare function listProtocolSchemas(): Array<{ kind: string; protocolVersion: string; path: string }>;
export declare function resolveProtocolSchema(kind: string, options: { protocolVersion: string }): ResolvedProtocolSchema;
export declare function validateProtocolArtifact(kind: string, value: unknown, options?: { protocolVersion?: string }): Array<{ path: string; rule: string; detail: string }>;
export declare function assertProtocolArtifact<T>(kind: string, value: T, options?: { protocolVersion?: string }): T;
export declare function assertOperateExperienceArtifactV2<T>(kind: string, value: T): T;
export declare const PROTOCOL_V18_CONTRACTS: Readonly<Record<string, string>>;
