/**
 * Evidence linking and validation for stakeholder reports.
 */

import type {
  ClaimValidationResult,
  EvidenceSummary,
  ReportEvidenceItem,
  StakeholderReportType,
} from '../models/types.js';
import { validateRepoAccessible } from './github-service.js';

const URL_RE = /https?:\/\/[^\s)]+/g;
const ISSUE_RE = /(?:#|GH-)\d+/gi;

export function countEvidenceAnchors(markdown: string): number {
  const urls = markdown.match(URL_RE) ?? [];
  const issues = markdown.match(ISSUE_RE) ?? [];
  return urls.length + issues.length;
}

export interface ValidateClaimsOptions {
  /** Included for forward-compatible per-report tuning; reserved for future use. */
  reportType?: StakeholderReportType;
}

function shouldSkipStrictEvidenceSection(heading: string): boolean {
  return /^\s*evidence\b/i.test(heading);
}

/** Template placeholder bullets (italic instructions) are not treated as factual claims. */
function isPlaceholderClaimBullet(line: string): boolean {
  const m = line.match(/^\s*[-*]\s+(.+)$/);
  if (!m) return false;
  const t = m[1].trim();
  return /^_.+_$/s.test(t);
}

export function validateClaimsHaveAnchors(
  markdown: string,
  minAnchors: number,
  options?: ValidateClaimsOptions,
): ClaimValidationResult[] {
  void options?.reportType;
  const sections = markdown.split(/^## /m).slice(1);
  const results: ClaimValidationResult[] = [];
  let idx = 0;
  for (const chunk of sections) {
    idx += 1;
    const lines = chunk.split('\n');
    const heading = lines[0]?.trim() ?? `section-${idx}`;
    if (shouldSkipStrictEvidenceSection(heading)) {
      continue;
    }
    const body = lines.slice(1).join('\n');
    const bullets = body.split('\n').filter((l) => /^\s*[-*]\s+/.test(l));
    for (let j = 0; j < bullets.length; j += 1) {
      const line = bullets[j];
      if (isPlaceholderClaimBullet(line)) {
        continue;
      }
      const n = countEvidenceAnchors(line);
      const claimId = `${heading}:${j}`;
      if (n < minAnchors) {
        results.push({
          claimId,
          ok: false,
          missingReason:
            'No link or issue reference found for this bullet; add a PR URL, commit, or #issue.',
        });
      } else {
        results.push({ claimId, ok: true });
      }
    }
  }
  return results;
}

export async function validateRemoteEvidence(items: ReportEvidenceItem[]): Promise<{
  inaccessible: ReportEvidenceItem[];
  repoOk: boolean;
  repoMessage: string;
}> {
  const repo = await validateRepoAccessible();
  const inaccessible: ReportEvidenceItem[] = [];
  for (const it of items) {
    if (!it.url) continue;
    try {
      const u = new URL(it.url);
      if (u.hostname !== 'github.com') continue;
      // Lightweight check only — full HTTP HEAD would add dependency noise
      if (!repo.ok) inaccessible.push(it);
    } catch {
      inaccessible.push(it);
    }
  }
  return { inaccessible, repoOk: repo.ok, repoMessage: repo.message };
}

export function summarizeEvidenceItem(item: ReportEvidenceItem): EvidenceSummary {
  return {
    evidenceId: item.id,
    title: item.label,
    body: [item.detail, item.url].filter(Boolean).join('\n'),
  };
}
