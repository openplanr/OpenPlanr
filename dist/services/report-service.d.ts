/**
 * Stakeholder report generation from context packs and Handlebars templates.
 */
import type { OpenPlanrConfig, StakeholderReportContext, StakeholderReportFormat, StakeholderReportType } from '../models/types.js';
import { type BuildContextOptions } from './context-pack-service.js';
export declare function resolveReportTemplate(reportType: StakeholderReportType): string;
export declare function generateStakeholderReportMarkdown(context: StakeholderReportContext, config: OpenPlanrConfig): Promise<string>;
/**
 * Remove the first Markdown H1 line (and following blank lines) so HTML export does not
 * duplicate the document title: wrapHtmlDocument() already injects a single <h1>.
 */
export declare function stripLeadingMarkdownH1(md: string): string;
/** Minimal markdown → HTML for reports (headings, lists, links, paragraphs). */
export declare function markdownToBasicHtml(md: string): string;
export declare function formatStakeholderReportOutput(context: StakeholderReportContext, config: OpenPlanrConfig, format: StakeholderReportFormat): Promise<{
    markdown: string;
    html?: string;
}>;
export declare function generateStakeholderReport(projectDir: string, config: OpenPlanrConfig, opts: BuildContextOptions & {
    format: StakeholderReportFormat;
}): Promise<{
    markdown: string;
    html?: string;
    context: StakeholderReportContext;
}>;
export declare function writeReportOutputs(args: {
    projectDir: string;
    config: OpenPlanrConfig;
    baseName: string;
    markdown: string;
    html?: string;
    outputDir?: string;
}): Promise<{
    mdPath?: string;
    htmlPath?: string;
}>;
//# sourceMappingURL=report-service.d.ts.map