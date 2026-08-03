import { type OperatingArtifactSessionLike } from './pipeline-handoff.js';
import { type OperatingRoutePlan } from './types.js';
export type OperatingArtifactType = 'markdown' | 'html' | 'json' | 'csv';
export interface OperatingArtifactGenerationPlan {
    artifactType: OperatingArtifactType;
    destination: string;
    evidenceRefs: string[];
    inputDigest: `sha256:${string}`;
    template: {
        id: string;
        version: string;
        artifactType: OperatingArtifactType;
        body: string;
        requiredVariables: string[];
    };
    variables: Record<string, string>;
    budget: {
        maxBytes: number;
        maxDurationMs: number;
        maxTokens: number | null;
        maxCostUsd: number | null;
    };
    sandbox: {
        network: 'none';
        filesystem: 'none';
        tools: [];
        allowedUrlSchemes: Array<'https' | 'mailto'>;
    };
    maxAttempts: number;
    planDigest: `sha256:${string}`;
}
export interface OperatingArtifactGenerationRequest {
    attempt: number;
    artifactType: OperatingArtifactType;
    inputDigest: `sha256:${string}`;
    evidenceRefs: string[];
    prompt: string;
    budget: OperatingArtifactGenerationPlan['budget'];
    sandbox: OperatingArtifactGenerationPlan['sandbox'];
    signal: AbortSignal;
    externalActions: [];
}
export interface OperatingArtifactGeneratorAdapter {
    id: string;
    runtime: string;
    mode: 'structured' | 'native-isolated' | 'deterministic';
    toolIsolation: 'enforced' | 'not-applicable';
    capability: 'analysis-standard' | 'analysis-high';
    supportedArtifactTypes: OperatingArtifactType[];
    providerDigest: `sha256:${string}`;
    generate(input: OperatingArtifactGenerationRequest): Promise<{
        content: string;
        usage?: {
            tokens?: number;
            costUsd?: number;
        };
    }>;
}
export interface StoredOperatingArtifactGeneration {
    kind: 'operating-artifact-generation';
    routeId: string;
    cycleId: string;
    routeInputDigest: `sha256:${string}`;
    routePreviewDigest: `sha256:${string}`;
    providerDigest: `sha256:${string}`;
    planDigest: `sha256:${string}`;
    state: 'prepared' | 'generating' | 'failed' | 'generated';
    session: OperatingArtifactSessionLike;
    attempts: Array<{
        attempt: number;
        state: 'failed' | 'generated';
        failureCode?: string;
    }>;
    content?: string;
    exactPreviewDigest?: `sha256:${string}`;
    noExternalActions: true;
    updatedAt: string;
}
export declare function readStoredOperatingArtifactGeneration(input: {
    projectRoot: string;
    route: OperatingRoutePlan;
    localRoot?: string;
}): Promise<StoredOperatingArtifactGeneration | null>;
export declare function createOperatingArtifactGenerationPlan(input: {
    cycleId: string;
    destination: string;
    evidenceRefs: string[];
    title: string;
    problem: string;
    proposal: string;
}): OperatingArtifactGenerationPlan;
export declare function generateOperatingRouteArtifact(input: {
    projectRoot: string;
    localRoot?: string;
    route: OperatingRoutePlan;
    plan: OperatingArtifactGenerationPlan;
    adapter: OperatingArtifactGeneratorAdapter;
    now: string;
    onAttemptFailed?: (attempt: number) => void | Promise<void>;
}): Promise<StoredOperatingArtifactGeneration>;
export declare function resolveOperatingArtifactGenerator(input: {
    projectRoot: string;
    route: OperatingRoutePlan;
    localRoot?: string;
}): Promise<OperatingArtifactGeneratorAdapter>;
export declare function generatedArtifactWrites(generation: StoredOperatingArtifactGeneration): Array<{
    relativePath: string;
    operation: 'create';
    content: string;
}>;
//# sourceMappingURL=artifact-route-generation.d.ts.map