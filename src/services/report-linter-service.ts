/**
 * Quality linter for stakeholder reports — vague language, structure, evidence hints.
 */

import type {
  CoachingFeedback,
  LintFinding,
  OpenPlanrConfig,
  ReportLinterConfig,
  ReportLintResult,
  StakeholderReportType,
} from '../models/types.js';
import { countEvidenceAnchors } from './evidence-service.js';

const DEFAULT_VAGUE: ReportLinterConfig['vaguePhrases'] = [
  {
    pattern: '\\b(fixed bugs|worked on stuff|almost done|mostly done|making progress)\\b',
    alternatives: [
      'Closed #12, #15 — see PR 44',
      'Completed 3 of 5 stories; remaining: error handling (US-020)',
      'Implementation 90% complete; remaining: tests and docs',
    ],
    hint: 'Stakeholders need countable outcomes and links, not mood.',
  },
  {
    pattern: '\\b(soon|quickly|later|various|several|things)\\b',
    alternatives: ['by Friday EOD', 'in the next sprint (SPRINT-003)', 'three items: A, B, C'],
  },
];

const DEFAULT_RULES: ReportLinterConfig['rules'] = [
  { id: 'evidence-density', enabled: true, minEvidenceLinks: 1 },
  { id: 'weekly-structure', enabled: true, requireSections: ['Wins', 'Risks', 'Ask'] },
];

export function mergeLinterConfig(config?: ReportLinterConfig): ReportLinterConfig {
  return {
    rules: config?.rules?.length ? config.rules : DEFAULT_RULES,
    vaguePhrases: config?.vaguePhrases?.length ? config.vaguePhrases : DEFAULT_VAGUE,
  };
}

export function validateReportMarkdown(
  markdown: string,
  reportType: StakeholderReportType,
  linter: ReportLinterConfig,
): ReportLintResult {
  const findings: LintFinding[] = [];
  const coaching: CoachingFeedback[] = [];
  const cfg = mergeLinterConfig(linter);

  for (const rule of cfg.rules) {
    if (!rule.enabled) continue;
    if (rule.id === 'weekly-structure' && reportType === 'weekly' && rule.requireSections) {
      for (const h of rule.requireSections) {
        const re = new RegExp(`^##\\s+.*${escapeRe(h)}.*$`, 'im');
        if (!re.test(markdown)) {
          findings.push({
            severity: 'warning',
            ruleId: 'weekly-structure',
            message: `Missing recommended section containing "${h}" (e.g. "## ${h}") for weekly updates.`,
            suggestion: `Add a "## …${h}…" section with 2–4 concrete bullets.`,
          });
        }
      }
    }
    if (rule.id === 'evidence-density' && rule.minEvidenceLinks && rule.minEvidenceLinks > 0) {
      const anchors = countEvidenceAnchors(markdown);
      if (anchors < rule.minEvidenceLinks) {
        findings.push({
          severity: 'warning',
          ruleId: 'evidence-density',
          message: 'Few evidence anchors (URLs or #issues) detected.',
          suggestion: 'Link each major claim to a PR, commit, or planr artifact id.',
        });
      }
    }
  }

  for (const v of cfg.vaguePhrases) {
    const re = new RegExp(v.pattern, 'gi');
    let m: RegExpExecArray | null = re.exec(markdown);
    while (m) {
      findings.push({
        severity: 'info',
        ruleId: 'vague-language',
        message: `Vague or low-signal phrase: "${m[0]}".`,
        suggestion: v.alternatives[0],
        span: { start: m.index, end: m.index + m[0].length },
      });
      coaching.push({
        ruleId: 'vague-language',
        message: `Try: ${v.alternatives.slice(0, 2).join(' · ')}`,
        educational: v.hint,
      });
      m = re.exec(markdown);
    }
  }

  const errors = findings.filter((f) => f.severity === 'error');
  const ok = errors.length === 0;
  return { ok, findings, coaching };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Coaching stub for recurring patterns — stateless in OSS build */
export function buildCoachingHistoryKey(_user: string, ruleId: string): string {
  return ruleId;
}

export function lintWithProjectConfig(
  markdown: string,
  reportType: StakeholderReportType,
  projectConfig: OpenPlanrConfig,
): ReportLintResult {
  return validateReportMarkdown(
    markdown,
    reportType,
    mergeLinterConfig(projectConfig.reportLinter),
  );
}
