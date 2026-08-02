export interface ArtifactEnvelope {
    schemaVersion: string;
    artifacts: Array<{
        id: string;
        kind: 'html';
        title: string;
        sha256: string;
        html: string;
        viewport: {
            width: number;
            height: number;
        };
        colorScheme: 'light' | 'dark';
    }>;
    viewer: {
        mode: 'single' | 'variants';
        activeArtifactId: string;
        presentation?: 'document' | 'canvas';
    };
    review?: Record<string, unknown>;
}
interface ArtifactBundle {
    html: string;
    sha256: string;
    bytes: number;
    inputBytes: number;
    fileCount: number;
    remoteAssetCount?: number;
}
export interface ArtifactPipelineApi {
    bundleArtifact(options: {
        entry: string;
        root: string;
    }): Promise<ArtifactBundle>;
    createArtifactEnvelope(options: {
        artifacts: Array<{
            id: string;
            title: string;
            html: string;
            viewport: {
                width: number;
                height: number;
            };
            colorScheme: 'light' | 'dark';
        }>;
        viewer?: ArtifactEnvelope['viewer'];
    }): ArtifactEnvelope;
    createReviewLinkPreview(envelope: ArtifactEnvelope): {
        fragmentLength: number;
        compressedBytes: number;
        ciphertextBytes: number;
        fragmentEligible: boolean;
    };
    createReviewLink(envelope: ArtifactEnvelope, options: Record<string, unknown>): Promise<Record<string, unknown>>;
    createLiveReviewRoom?: (envelope: ArtifactEnvelope, options: Record<string, unknown>) => Promise<Record<string, unknown>>;
    hydrateLiveReviewRoom?: (source: string, options?: Record<string, unknown>) => Promise<{
        envelope: ArtifactEnvelope;
        review: Record<string, unknown>;
    }>;
    decodeReviewLink(source: string, options?: Record<string, unknown>): Promise<ArtifactEnvelope>;
    importArtifactReview(options: Record<string, unknown>): Promise<Record<string, unknown>>;
    startArtifactReview(options: Record<string, unknown>): Promise<Record<string, unknown>>;
    exportArtifactReviewSession(sessionId: string, options: {
        format: 'json' | 'markdown';
    }): Promise<{
        content: string;
    } & Record<string, unknown>>;
}
export declare class ArtifactCommandError extends Error {
    readonly code: string;
    readonly fix?: string;
    constructor(code: string, message: string, fix?: string);
    toJSON(): Record<string, unknown>;
}
export declare function loadArtifactPipeline(): Promise<ArtifactPipelineApi>;
export declare function prepareArtifactEnvelope(options: {
    file: string;
    root: string;
    title?: string;
    presentation?: 'auto' | 'document' | 'canvas';
}): Promise<{
    api: ArtifactPipelineApi;
    envelope: ArtifactEnvelope;
    bundle: ArtifactBundle;
    artifactId: string;
    presentation: 'document' | 'canvas';
}>;
export declare function withoutArtifactReview(envelope: ArtifactEnvelope): ArtifactEnvelope;
export declare function openExternalUrl(url: string): Promise<void>;
export declare function resetArtifactPipelineForTests(): void;
export {};
//# sourceMappingURL=artifact-pipeline-service.d.ts.map