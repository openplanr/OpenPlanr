import { type OperatingAdapterHandoff, type OperatingAdvisorBrief, type OperatingCheckpoint, type OperatingEvent, type OperatingProviderManifest, type OperatingRoleResult, type OperatingState } from './types.js';
interface PipelineProtocolApi {
    assertProtocolArtifact(kind: string, value: unknown): unknown;
    validateProtocolArtifact(kind: string, value: unknown, options?: {
        protocolVersion?: string;
    }): Array<{
        path: string;
        detail: string;
    }>;
    createOperatingEvent(input: Record<string, unknown>, options?: {
        previousEvent?: OperatingEvent | null;
        sequence?: number;
    }): OperatingEvent;
    verifyOperatingEventChain(events: OperatingEvent[], options?: {
        startingSequence?: number;
        startingHash?: string | null;
    }): {
        sequence: number;
        hash: `sha256:${string}` | null;
    };
    reduceOperatingEvents(events: OperatingEvent[], options?: {
        checkpoint?: OperatingCheckpoint | null;
    }): OperatingState;
    createOperatingCheckpoint(state: OperatingState, options?: {
        createdAt?: string;
        recordDigests?: string[];
        signer?: (payload: string) => {
            algorithm: 'ed25519' | 'hmac-sha256';
            keyId: string;
            value: string;
        };
    }): OperatingCheckpoint;
    validateOperatingCheckpoint(checkpoint: OperatingCheckpoint, options?: {
        verifySignature?: (payload: string, signature: {
            algorithm: 'ed25519' | 'hmac-sha256';
            keyId: string;
            value: string;
        }) => boolean;
        requireSignatureVerification?: boolean;
    }): OperatingCheckpoint;
    computeOperatingProviderPolicyDigest(manifest: OperatingProviderManifest): `sha256:${string}`;
    computeOperatingRoleResultDigest(result: OperatingRoleResult): `sha256:${string}`;
    validateOperatingRoleResultDigest(result: OperatingRoleResult): OperatingRoleResult;
    validateOperatingProviderPolicyDigest(manifest: OperatingProviderManifest): OperatingProviderManifest;
    createOperatingAdvisorBrief(roleId: string): OperatingAdvisorBrief;
    createOperatingAdapterHandoff(input: {
        protocolVersion?: string;
        phase: 'bootstrap' | 'advisors' | 'chair';
        state: OperatingAdapterHandoff['state'];
        cycleId: string;
        evidenceDigest: string;
        runtime: string;
        idempotencyKey: string;
        lease?: string | null;
        expiresAt?: string | null;
        roles: Array<{
            roleId: string;
            status: OperatingAdapterHandoff['roles'][number]['status'];
            inputDigest?: string | null;
        }>;
    }): OperatingAdapterHandoff;
    validateOperatingAdapterHandoffBindings(value: OperatingAdapterHandoff): OperatingAdapterHandoff;
    listOperatingRoles(): Array<Record<string, unknown> & {
        id: string;
    }>;
    listOperatingProviders(): Array<Record<string, unknown> & {
        id: string;
    }>;
}
export declare function resolveOperatingPipelineRoot(options?: {
    requireMission?: boolean;
}): string | null;
export declare function operatingPipelineAvailable(): boolean;
/** Whether a Protocol v1.4 agent-native pipeline install is resolvable. */
export declare function operatingMissionProtocolAvailable(): boolean;
export declare function loadOperatingProtocol(): Promise<PipelineProtocolApi>;
export declare function assertOperatingArtifact<T>(kind: string, value: T): Promise<T>;
export declare function validateOperatingArtifact(kind: string, value: unknown): Promise<Array<{
    path: string;
    detail: string;
}>>;
export {};
//# sourceMappingURL=protocol.d.ts.map