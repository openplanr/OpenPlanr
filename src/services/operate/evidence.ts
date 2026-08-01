/**
 * Surviving evidence projection helpers.
 *
 * SPEC-004 retired the pre-dispatch repository collector and its evidence-index
 * and mission-packet machinery. Evidence is now created only from citations
 * returned by operating mandates and resolved fail-closed by
 * citation-resolution.ts.
 */
import type { OperatingEvidence, OperatingEvidenceItem, OperatingSensitivity } from './types.js';

export function evidenceFingerprintItems(items: readonly OperatingEvidenceItem[]): Array<{
  id: string;
  digest: `sha256:${string}`;
  sensitivity: OperatingSensitivity;
}> {
  return items
    .map(({ id, digest, sensitivity }) => ({ id, digest, sensitivity }))
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) ||
        left.digest.localeCompare(right.digest) ||
        left.sensitivity.localeCompare(right.sensitivity),
    );
}

export function evidenceProjectionSources(evidence: OperatingEvidence): Array<{
  id: string;
  freshness: OperatingEvidenceItem['freshness'];
  status: string;
  itemCount: number;
}> {
  return evidence.sources.map((source) => ({
    id: source.id,
    freshness: evidence.items.some(
      (item) => item.source === source.id && item.freshness === 'stale',
    )
      ? 'stale'
      : evidence.items.some((item) => item.source === source.id)
        ? 'fresh'
        : 'unknown',
    status: source.status,
    itemCount: source.itemCount,
  }));
}
