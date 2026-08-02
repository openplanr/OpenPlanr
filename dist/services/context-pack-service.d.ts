/**
 * Assemble stakeholder report context from `.planr/` artifacts and optional GitHub signals.
 */
import type { OpenPlanrConfig, StakeholderReportContext, StakeholderReportType } from '../models/types.js';
export interface BuildContextOptions {
    reportType: StakeholderReportType;
    days: number;
    sprintId?: string;
    includeGitHub: boolean;
}
export declare function buildStakeholderReportContext(projectDir: string, config: OpenPlanrConfig, opts: BuildContextOptions): Promise<StakeholderReportContext>;
//# sourceMappingURL=context-pack-service.d.ts.map