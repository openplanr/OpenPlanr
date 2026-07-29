import { describe, expect, it } from 'vitest';
import {
  createOperatingOutcome,
  evaluateOperatingOutcome,
} from '../../src/services/operate/outcomes.js';
import type {
  OperatingOutcome,
  OperatingOutcomeObservation,
} from '../../src/services/operate/types.js';

async function outcome(
  overrides: Partial<
    Omit<
      OperatingOutcome,
      'kind' | 'schemaVersion' | 'protocolVersion' | 'status' | 'createdAt' | 'updatedAt'
    >
  > = {},
): Promise<OperatingOutcome> {
  return createOperatingOutcome({
    id: 'OUT-001',
    sourceCycle: 'CYCLE-001',
    sourceFinding: 'FND-001',
    specId: 'SPEC-001',
    outcomeKind: 'metric',
    metric: 'activated accounts',
    unit: 'percent',
    queryIdentity: 'warehouse.activation-rate.v1',
    direction: 'increase',
    operator: 'gte',
    aggregation: 'rate',
    baselineWindow: {
      from: '2026-06-01T00:00:00.000Z',
      to: '2026-06-30T23:59:59.000Z',
    },
    targetWindow: {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.000Z',
    },
    threshold: { value: 12 },
    minimumCoverage: 0.8,
    minimumSample: 100,
    stalePolicy: 'inconclusive',
    missingPolicy: 'create-gap',
    guardrailPrecedence: 'block-on-breach',
    guardrails: [
      {
        metric: 'support-ticket-rate',
        unit: 'percent',
        operator: 'gt',
        threshold: 5,
      },
    ],
    source: 'warehouse',
    observationWindow: '30d',
    verifyAfter: '2026-08-01',
    rollout: 'Release to all active workspaces after the target window opens.',
    rollback: 'Restore the prior activation path.',
    evidenceRefs: ['EVD-baseline-activation'],
    ...overrides,
    createdAt: '2026-07-01T00:00:00.000Z',
  });
}

async function observe(
  contract: OperatingOutcome,
  overrides: Partial<{
    value: number | null;
    sampleSize: number;
    coverage: number;
    freshness: OperatingOutcomeObservation['freshness'];
    guardrailValues: Record<string, number | null>;
    unit: string;
    queryIdentity: string;
    aggregation: OperatingOutcome['aggregation'];
    observedAt: string;
    window: { from: string; to: string };
  }> = {},
): Promise<OperatingOutcomeObservation> {
  return evaluateOperatingOutcome({
    outcome: contract,
    observationId: 'OBS-activation-001',
    observedAt: '2026-08-01T12:00:00.000Z',
    window: contract.targetWindow,
    value: 14,
    unit: contract.unit,
    queryIdentity: contract.queryIdentity,
    aggregation: contract.aggregation,
    sampleSize: 250,
    coverage: 0.95,
    freshness: 'fresh',
    guardrailValues: { 'support-ticket-rate': 3 },
    evidenceRefs: ['EVD-observed-activation'],
    ...overrides,
  });
}

describe('typed operating outcome evaluation', () => {
  it('evaluates sufficient fresh measurements as positive or negative', async () => {
    const contract = await outcome();
    const positive = await observe(contract, { value: 12 });
    const negative = await observe(contract, { value: 11.99 });

    expect(positive.evaluation).toBe('positive');
    expect(negative.evaluation).toBe('negative');
    expect(positive).toMatchObject({
      outcomeId: 'OUT-001',
      unit: 'percent',
      queryIdentity: 'warehouse.activation-rate.v1',
      aggregation: 'rate',
      evidenceRefs: ['EVD-observed-activation'],
    });
  });

  it.each([
    ['missing value', { value: null }],
    ['insufficient sample', { sampleSize: 99 }],
    ['insufficient coverage', { coverage: 0.79 }],
    ['stale evidence', { freshness: 'stale' as const }],
    ['unknown freshness', { freshness: 'unknown' as const }],
  ])('marks %s as inconclusive', async (_label, overrides) => {
    const observation = await observe(await outcome(), overrides);
    expect(observation.evaluation).toBe('inconclusive');
  });

  it('lets a breached blocking guardrail override a positive primary outcome', async () => {
    const contract = await outcome({ guardrailPrecedence: 'block-on-breach' });
    const observation = await observe(contract, {
      value: 20,
      guardrailValues: { 'support-ticket-rate': 8 },
    });

    expect(observation.evaluation).toBe('negative');
    expect(observation.guardrails).toEqual([
      {
        metric: 'support-ticket-rate',
        breached: true,
        observedValue: 8,
      },
    ]);
  });

  it('keeps the primary result when guardrail precedence is outcome-first', async () => {
    const contract = await outcome({ guardrailPrecedence: 'outcome-first' });
    const observation = await observe(contract, {
      value: 20,
      guardrailValues: { 'support-ticket-rate': 8 },
    });

    expect(observation.evaluation).toBe('positive');
    expect(observation.guardrails[0]?.breached).toBe(true);
  });

  it('reports an unchanged maintain target as neutral', async () => {
    const contract = await outcome({
      direction: 'maintain',
      operator: 'eq',
      threshold: { value: 12 },
    });
    const observation = await observe(contract, { value: 12 });

    expect(observation.evaluation).toBe('neutral');
  });

  it('rejects observations whose typed metric identity does not match', async () => {
    const contract = await outcome();
    await expect(
      observe(contract, { queryIdentity: 'warehouse.activation-rate.v2' }),
    ).rejects.toMatchObject({
      code: 'E_OPERATE_OUTCOME_NOT_READY',
    });
    await expect(observe(contract, { unit: 'accounts' })).rejects.toMatchObject({
      code: 'E_OPERATE_OUTCOME_NOT_READY',
    });
    await expect(observe(contract, { aggregation: 'latest' })).rejects.toMatchObject({
      code: 'E_OPERATE_OUTCOME_NOT_READY',
    });
  });

  it('requires ordered windows and a complete range threshold', async () => {
    await expect(
      outcome({
        baselineWindow: {
          from: '2026-06-30T00:00:00.000Z',
          to: '2026-06-01T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_OUTCOME_NOT_READY' });
    await expect(
      outcome({
        direction: 'range',
        operator: 'between',
        threshold: { value: 10 },
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_OUTCOME_NOT_READY' });
  });

  it.each([
    ['increase', 'lt'],
    ['increase', 'lte'],
    ['decrease', 'gt'],
    ['decrease', 'gte'],
    ['maintain', 'gte'],
    ['range', 'eq'],
  ] as const)('rejects the incoherent %s/%s direction and operator pair', async (direction, operator) => {
    await expect(outcome({ direction, operator })).rejects.toMatchObject({
      code: 'E_OPERATE_OUTCOME_NOT_READY',
    });
  });

  it('requires a non-overlapping target window and verifyAfter at its end', async () => {
    await expect(
      outcome({
        targetWindow: {
          from: '2026-06-15T00:00:00.000Z',
          to: '2026-07-15T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_OUTCOME_NOT_READY' });
    await expect(outcome({ verifyAfter: '2026-07-15' })).rejects.toMatchObject({
      code: 'E_OPERATE_OUTCOME_NOT_READY',
    });
  });

  it('rejects observations before verifyAfter or outside the declared target window', async () => {
    const contract = await outcome();
    await expect(
      observe(contract, { observedAt: '2026-07-31T23:59:59.000Z' }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_OUTCOME_NOT_READY' });
    await expect(
      observe(contract, {
        window: {
          from: '2026-07-02T00:00:00.000Z',
          to: '2026-08-01T00:00:00.000Z',
        },
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_OUTCOME_NOT_READY' });
  });
});
