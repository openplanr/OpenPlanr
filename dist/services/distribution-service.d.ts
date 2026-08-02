/**
 * Delivery channels for stakeholder reports (GitHub issue push; Slack webhooks; email stub).
 */
import type { DistributionResult, OpenPlanrConfig } from '../models/types.js';
export declare function pushReportAsGitHubIssue(args: {
    title: string;
    body: string;
    dryRun: boolean;
}): Promise<DistributionResult>;
export declare function pushReportToSlack(config: OpenPlanrConfig, markdown: string, args?: {
    dryRun?: boolean;
}): Promise<DistributionResult>;
export declare function pushReportByEmail(_config: OpenPlanrConfig, _args: {
    to: string[];
    subject: string;
    body: string;
}): Promise<DistributionResult>;
//# sourceMappingURL=distribution-service.d.ts.map