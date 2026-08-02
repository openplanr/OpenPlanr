import { type OperatingInitAnswers } from './types.js';
export interface OperatingContextClaim {
    id: string;
    field: 'purpose' | 'stage' | 'business-model' | 'pricing' | 'ideal-customer' | 'goal' | 'metric' | 'architecture' | 'delivery-state' | 'risk' | 'constraint' | 'other';
    value: string;
    epistemicStatus: 'observed' | 'inferred' | 'hypothesis' | 'owner-confirmed' | 'unknown';
    confidence: number;
    citations: Array<Record<string, unknown>>;
    ownerNote?: string;
}
export declare function prepareOperatingContextResearch(input: {
    projectRoot: string;
    runtime: string;
    researchMode?: 'local' | 'connected';
    connectedResearchConsentDigest?: string | null;
    preview?: boolean;
}): Promise<{
    sessionId: string;
    mandate: Record<string, unknown>;
    instruction: string;
}>;
export declare function recordOperatingContextResearch(input: {
    projectRoot: string;
    stdin?: string;
}): Promise<{
    claims: OperatingContextClaim[];
    rejected: Array<{
        id: string;
        reason: string;
    }>;
    contextDigest: string;
}>;
export declare function readOperatingContextResearch(projectRoot: string): Promise<unknown>;
/**
 * Seed the legacy initialization record from validated Protocol v1.4 research.
 * The epistemic status remains in the machine-local context sidecar; using the
 * claim in the charter does not promote it to owner-confirmed. Explicit CLI or
 * runtime answers always win when these defaults are merged by the caller.
 */
export declare function operatingInitializationAnswersFromResearch(projectRoot: string): Promise<OperatingInitAnswers | null>;
//# sourceMappingURL=context-research.d.ts.map