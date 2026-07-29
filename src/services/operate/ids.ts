import type { OperatingState } from './types.js';

function next(records: Array<Record<string, unknown>>, prefix: string): string {
  const maximum = records.reduce((value, record) => {
    const match = String(record.id ?? '').match(new RegExp(`^${prefix}-(\\d+)$`));
    return Math.max(value, match ? Number(match[1]) : 0);
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(3, '0')}`;
}

export function nextCycleId(state: OperatingState): string {
  return next(state.cycles, 'CYCLE');
}

export function nextFindingId(state: OperatingState): string {
  return next(state.findings, 'FND');
}

export function nextDecisionId(state: OperatingState): string {
  return next(state.decisions, 'DEC');
}

export function nextGapId(state: OperatingState): string {
  return next(state.dataGaps, 'GAP');
}

export function nextRouteId(state: OperatingState): string {
  return next(state.routes, 'ACT');
}
