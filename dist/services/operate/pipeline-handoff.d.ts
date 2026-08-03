import { type OperatingPlanningEngine } from './types.js';
export interface PipelinePoBridge<TPrepared = unknown, TCompleted = unknown> {
    preparePlan(input: {
        projectRoot: string;
        feature: string;
        scaffold: boolean;
        createStackTemplate: boolean;
    }): TPrepared | Promise<TPrepared>;
    completePlan(input: {
        projectRoot: string;
        feature: string;
        runtime: string;
        runId: string;
    }): TCompleted | Promise<TCompleted>;
}
export interface OperatingGeneratorBridge {
    prepareOperatingArtifactGeneration(input: Record<string, unknown>): OperatingArtifactSessionLike;
    renderOperatingArtifactTemplate(template: Record<string, unknown>, variables: Record<string, unknown>): {
        content: string;
        template: Record<string, unknown>;
    };
    startOperatingArtifactGeneration(session: OperatingArtifactSessionLike, options?: {
        now?: string;
    }): OperatingArtifactSessionLike;
    validateOperatingArtifactOutput(session: OperatingArtifactSessionLike, content: string, options?: {
        now?: string;
    }): {
        session: OperatingArtifactSessionLike;
        content: string;
    };
    commitOperatingArtifactGeneration(session: OperatingArtifactSessionLike, options?: {
        now?: string;
    }): OperatingArtifactSessionLike;
    failOperatingArtifactGeneration(session: OperatingArtifactSessionLike, failureCode: string, options?: {
        now?: string;
    }): OperatingArtifactSessionLike;
    resumeOperatingArtifactGeneration(session: OperatingArtifactSessionLike, options?: {
        now?: string;
    }): OperatingArtifactSessionLike;
}
export type OperatingArtifactSessionLike = Record<string, unknown> & {
    kind: 'operating-artifact-session';
    id: string;
    cycleId: string;
    state: 'prepared' | 'generating' | 'validated' | 'committed' | 'failed' | 'cancelled';
    artifactType: 'markdown' | 'html' | 'json' | 'csv';
    inputDigest: `sha256:${string}`;
    outputDigest?: `sha256:${string}`;
    destination: string;
    evidenceRefs: string[];
    producer: {
        product: string;
        version: string;
        runtime: string;
        capability: 'analysis-standard' | 'analysis-high';
    };
    generation: {
        template: {
            id: string;
            version: string;
            digest: `sha256:${string}`;
        };
        attempt: number;
        maxAttempts: number;
        budget: {
            maxBytes: number;
            maxDurationMs: number;
            maxTokens: number | null;
            maxCostUsd: number | null;
        };
        sandbox: {
            network: 'none';
            filesystem: 'none' | 'project-read-only';
            tools: [];
            allowedUrlSchemes: Array<'https' | 'mailto'>;
        };
    };
    provenance?: {
        templateDigest: `sha256:${string}`;
        inputDigest: `sha256:${string}`;
        outputDigest: `sha256:${string}`;
        generatedAt: string;
    };
    createdAt: string;
    updatedAt: string;
};
export interface PipelinePoHandoff<TPrepared = unknown> {
    planningEngine: 'pipeline-po';
    feature: string;
    runId: string;
    preparedDigest: `sha256:${string}`;
    prepared: TPrepared;
    invocation: string;
    state: 'awaiting-native-plan';
    shipInvoked: false;
}
export declare function loadPipelinePoBridge(): Promise<PipelinePoBridge>;
export declare function loadOperatingGeneratorBridge(): Promise<OperatingGeneratorBridge>;
export declare function inspectPlanningProducer(input: {
    projectRoot: string;
    targetPath: string;
}): Promise<{
    populated: boolean;
    producer?: OperatingPlanningEngine;
    files: string[];
}>;
export declare function hasPipelinePoCompletionProvenance(input: {
    projectRoot: string;
    targetPath: string;
    runId: string;
}): Promise<boolean>;
export declare function assertPlanningProducer(input: {
    projectRoot: string;
    targetPath: string;
    selected: OperatingPlanningEngine;
}): Promise<void>;
export declare function preparePipelinePoHandoff<TPrepared>(input: {
    bridge: PipelinePoBridge<TPrepared, unknown>;
    projectRoot: string;
    feature: string;
    runtime: string;
    runId: string;
    targetPath: string;
}): Promise<PipelinePoHandoff<TPrepared>>;
export declare function completePipelinePoHandoff<TPrepared, TCompleted>(input: {
    bridge: PipelinePoBridge<TPrepared, TCompleted>;
    projectRoot: string;
    runtime: string;
    handoff: PipelinePoHandoff<TPrepared>;
    nativePlanCompleted: true;
}): Promise<{
    planningEngine: 'pipeline-po';
    runId: string;
    state: 'plan-completed';
    result: TCompleted;
    shipInvoked: false;
}>;
//# sourceMappingURL=pipeline-handoff.d.ts.map