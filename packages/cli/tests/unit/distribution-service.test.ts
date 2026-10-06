import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import { pushReportByEmail } from '../../src/services/distribution-service.js';

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
