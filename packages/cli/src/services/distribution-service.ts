/**
 * Delivery channels for stakeholder reports (GitHub issue push; email stub).
 */

import type { DistributionResult, OpenPlanrConfig } from '../models/types.js';
import { PLANNING_FOLDER } from '../utils/constants.js';
import { messageOf } from '../utils/error-message.js';
import { createIssue, ensureLabel } from './github-service.js';

export async function pushReportAsGitHubIssue(args: {
  title: string;
  body: string;
  dryRun: boolean;
}): Promise<DistributionResult> {
  if (args.dryRun) {
    return {
      channel: 'github_issue',
      ok: true,
      message: 'Dry run: would create GitHub issue with stakeholder report body.',
    };
  }
  try {
    await ensureLabel('planr:report');
    const { url } = await createIssue(args.title, args.body, ['planr:report']);
    return {
      channel: 'github_issue',
      ok: true,
      message: 'Created GitHub issue with report.',
      url,
    };
  } catch (err) {
    return {
      channel: 'github_issue',
      ok: false,
      message: messageOf(err),
    };
  }
}

export async function pushReportByEmail(
  _config: OpenPlanrConfig,
  _args: { to: string[]; subject: string; body: string },
): Promise<DistributionResult> {
  if (!_config.distribution?.emailSmtpHost) {
    return {
      channel: 'email',
      ok: false,
      message: `Email is not configured. Set \`distribution.emailSmtpHost\` and related fields in ${PLANNING_FOLDER}/config.json.`,
    };
  }
  return {
    channel: 'email',
    ok: false,
    message: 'SMTP delivery is not implemented in this build.',
  };
}
