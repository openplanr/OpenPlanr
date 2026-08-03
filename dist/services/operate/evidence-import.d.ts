export interface JsonImportLimits {
    maxDepth: number;
    maxScalars: number;
    maxStringLength: number;
    maxBytes: number;
}
export interface CsvImportLimits {
    maxRows: number;
    maxColumns: number;
    maxFieldLength: number;
    maxBytes: number;
}
export declare function parseStrictJson(source: string, limits?: Partial<JsonImportLimits>): unknown;
export declare function parseStrictCsv(source: string, limits?: Partial<CsvImportLimits>): string[][];
export declare function escapeSpreadsheetCell(value: string): string;
export declare function serializeSafeCsv(rows: readonly (readonly string[])[]): string;
export interface EvidenceImportRoot {
    componentId: string;
    root: string;
}
export interface ImportedEvidenceFile {
    absolutePath: string;
    location: string;
    format: 'json' | 'csv';
    content: string;
    byteCount: number;
}
export declare function resolveEvidenceImportPath(projectRoot: string, configuredPath: string, roots: readonly EvidenceImportRoot[]): Promise<{
    absolutePath: string;
    location: string;
}>;
export declare function readImportedEvidenceFile(input: {
    projectRoot: string;
    configuredPath: string;
    roots: readonly EvidenceImportRoot[];
    maxBytes: number;
    jsonLimits?: Partial<JsonImportLimits>;
    csvLimits?: Partial<CsvImportLimits>;
}): Promise<ImportedEvidenceFile>;
//# sourceMappingURL=evidence-import.d.ts.map