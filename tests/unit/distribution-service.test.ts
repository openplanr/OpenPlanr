import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import { pushReportByEmail, pushReportToSlack } from '../../src/services/distribution-service.js';

function baseConfig(overrides: Partial<OpenPlanrConfig> = {}): OpenPlanrConfig {
  return {
    projectName: 'test',
    targets: ['cursor'],
    outputPaths: {
      agile: '.planr',
      cursorRules: '.cursor/rules',
      claudeConfig: '.claude',
      codexConfig: '.codex',
    },
    idPrefix: {
      epic: 'EPIC',
      feature: 'FEAT',
      story: 'US',
      task: 'TASK',
      quick: 'QUICK',
      backlog: 'BACKLOG',
      sprint: 'SPRINT',
      spec: 'SPEC',
    },
    createdAt: '2026-01-01',
    ...overrides,
  };
}

describe('distribution-service', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('pushReportToSlack', () => {
    it('dry run without webhook succeeds with guidance', async () => {
      const res = await pushReportToSlack(baseConfig(), '# Hello', { dryRun: true });
      expect(res.ok).toBe(true);
      expect(res.channel).toBe('slack');
      expect(res.message).toMatch(/no Slack webhook/);
    });

    it('dry run with webhook describes POST size without fetching', async () => {
      const res = await pushReportToSlack(
        baseConfig({ distribution: { slackWebhookUrl: 'https://hooks.slack.com/services/TEST' } }),
        '# Hello',
        { dryRun: true },
      );
      expect(res.ok).toBe(true);
      expect(res.message).toMatch(/Dry run.*POST/);
    });

    it('returns error when not dry-run and webhook missing', async () => {
      const res = await pushReportToSlack(baseConfig(), '# Hello');
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/Slack is not configured/);
    });

    it('POSTs JSON payload when webhook configured', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => 'ok',
      });

      const res = await pushReportToSlack(
        baseConfig({ distribution: { slackWebhookUrl: 'https://hooks.slack.com/x' } }),
        '# Report body',
      );

      expect(res.ok).toBe(true);
      expect(res.message).toMatch(/Posted report to Slack/);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/x',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.text).toContain('Report body');
    });

    it('surfaces non-OK webhook responses', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'invalid_payload',
      });

      const res = await pushReportToSlack(
        baseConfig({ distribution: { slackWebhookUrl: 'https://hooks.slack.com/x' } }),
        '# x',
      );
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/400/);
      expect(res.message).toMatch(/invalid_payload/);
    });
  });

  describe('pushReportByEmail', () => {
    it('returns not configured when SMTP host missing', async () => {
      const res = await pushReportByEmail(baseConfig(), {
        to: ['a@b.com'],
        subject: 's',
        body: 'b',
      });
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/Email is not configured/);
    });

    it('returns not implemented when SMTP host set', async () => {
      const res = await pushReportByEmail(
        baseConfig({ distribution: { emailSmtpHost: 'smtp.example.com' } }),
        { to: ['a@b.com'], subject: 's', body: 'b' },
      );
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/not implemented/);
    });
  });
});
