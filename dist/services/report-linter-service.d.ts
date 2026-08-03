/**
 * Quality linter for stakeholder reports — vague language, structure, evidence hints.
 */
import type { OpenPlanrConfig, ReportLinterConfig, ReportLintResult, StakeholderReportType } from '../models/types.js';
export declare function mergeLinterConfig(config?: ReportLinterConfig): ReportLinterConfig;
export declare function validateReportMarkdown(markdown: string, reportType: StakeholderReportType, linter: ReportLinterConfig): ReportLintResult;
/** Coaching stub for recurring patterns — stateless in OSS build */
export declare function buildCoachingHistoryKey(_user: string, ruleId: string): string;
export declare function lintWithProjectConfig(markdown: string, reportType: StakeholderReportType, projectConfig: OpenPlanrConfig): ReportLintResult;
//# sourceMappingURL=report-linter-service.d.ts.map