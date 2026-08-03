// Seed of the large-monorepo core package. The real-runtime canary cites
// packages/core/src/index.ts at the cycle's pinned revision, so this file must
// exist and be committed before the cycle runs.
export interface HealthReport {
  status: 'ok' | 'degraded';
  checkedAt: string;
}

export function health(): HealthReport {
  return { status: 'ok', checkedAt: new Date(0).toISOString() };
}
