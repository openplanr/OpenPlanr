/**
 * Delivery channels for stakeholder reports (GitHub issue push; Slack webhooks; email stub).
 */

import type { DistributionResult, OpenPlanrConfig } from '../models/types.js';
import { createIssue, ensureLabel } from './github-service.js';

const SLACK_TEXT_MAX = 12000;

function truncateForSlack(text: string): string {
  const t = text.trim();
  if (t.length <= SLACK_TEXT_MAX) return t;
  return `${t.slice(0, SLACK_TEXT_MAX)}\n\n…(truncated; full report saved locally)`;
}

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
      message: (err as Error).message,
    };
  }
}

export async function pushReportToSlack(
  config: OpenPlanrConfig,
  markdown: string,
  args?: { dryRun?: boolean },
): Promise<DistributionResult> {
  const url = config.distribution?.slackWebhookUrl;

  if (args?.dryRun) {
    if (!url) {
      return {
        channel: 'slack',
        ok: true,
        message:
          'Dry run: no Slack webhook in config (no POST). Add `distribution.slackWebhookUrl` to .planr/config.json, then run without --dry-run to send.',
      };
    }
    return {
      channel: 'slack',
      ok: true,
      message: `Dry run: would POST ~${Math.min(markdown.length, SLACK_TEXT_MAX)} chars to your Slack webhook (no request sent).`,
    };
  }

  if (!url) {
    return {
      channel: 'slack',
      ok: false,
      message:
        'Slack is not configured. Set `distribution.slackWebhookUrl` in .planr/config.json (or use --push github).',
    };
  }

  try {
    const payload = { text: truncateForSlack(markdown) };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      return {
        channel: 'slack',
        ok: false,
        message: `Slack webhook failed (${res.status}): ${bodyText || res.statusText}. Check the webhook URL and app permissions.`,
      };
    }

    return {
      channel: 'slack',
      ok: true,
      message: 'Posted report to Slack.',
    };
  } catch (err) {
    return {
      channel: 'slack',
      ok: false,
      message: `Slack request failed: ${(err as Error).message}`,
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
      message:
        'Email is not configured. Set `distribution.emailSmtpHost` and related fields in .planr/config.json.',
    };
  }
  return {
    channel: 'email',
    ok: false,
    message: 'SMTP delivery is not implemented in this build.',
  };
}
