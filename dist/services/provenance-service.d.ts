export interface ProvenanceInput {
    projectDir: string;
    artifactId: string;
    artifactPath: string;
    operation: string;
    productVersion: string;
    runtime?: string;
    phase?: string;
    runId?: string;
}
export declare function readOpenPlanrVersion(): string;
export declare function appendOpenPlanrProvenance(input: ProvenanceInput): Promise<void>;
//# sourceMappingURL=provenance-service.d.ts.map