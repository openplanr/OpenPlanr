import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';

/** Retained only as a source-compatible shell seam during the verified-display cutover. */
export type OperateTodaySurface = Readonly<Record<string, unknown>>;

export type TodayPresentation = Readonly<{
  title: string;
  summary: string;
  cycle: string;
  decision: string;
  action: string;
  stage: string;
  evidence: string;
  eventHead: string;
}>;

/**
 * Legacy payload projection is intentionally unreachable. Today now renders
 * only through the parser-branded, verified display-envelope path.
 */
export function projectValidatedOperateTodaySurface(
  _value: unknown,
  _binding: DashboardQueryIdentity,
  _expectedStatus: string,
): TodayPresentation | null {
  return null;
}
