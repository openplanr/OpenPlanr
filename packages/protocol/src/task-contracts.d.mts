export interface ProtocolSemanticDiagnostic { code: string; path: string; message: string }
export declare function validateTaskManifestSemantics(value: unknown, options?: object): ProtocolSemanticDiagnostic[];
export declare function assertTaskManifestSemantics<T>(value: T, options?: object): T;
export declare function validateTaskGraph(values: unknown[]): ProtocolSemanticDiagnostic[];
export declare function countR2Tasks(values: unknown[]): number;
export declare function validateTaskOutputSemantics(value: unknown, options?: { taskManifest?: any }): ProtocolSemanticDiagnostic[];
export declare function assertTaskOutputSemantics<T>(value: T, options?: { taskManifest?: any }): T;
