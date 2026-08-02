import type { OperatingState } from './types.js';
export interface OperatingDoctorDiagnostic {
    code: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
}
/**
 * FR7: cycle integrity is a first-class readable-tree surface. This is the
 * regression guard on that surface — a citation rejection or boundary refusal
 * that is recorded in committed state but does NOT appear in the cycle's
 * `integrity.md` means the readable tree stopped reflecting the governed signal,
 * which is exactly the failure mode FR7 fixes (an integrity signal reaching the
 * operator only when a lens happened to restate it). It also reports the three
 * conditions — citation rejections, boundary refusals, not_evaluated roles — as
 * an explicit check so the operator sees them without reading any lens prose.
 * Pure over `(state, cycleId, integrityFileContent)` so the mapping is testable
 * without a full board on disk.
 */
export declare function diagnoseOperatingCycleIntegrity(state: OperatingState, cycleId: string | null, integrityFileContent: string | null): OperatingDoctorDiagnostic;
export declare function diagnoseOperatingBoard(input: {
    projectRoot: string;
    localRoot?: string;
    pipelineVersion?: string;
    runtime?: string;
}): Promise<OperatingDoctorDiagnostic[]>;
//# sourceMappingURL=doctor.d.ts.map