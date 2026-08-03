function next(records, prefix) {
    const maximum = records.reduce((value, record) => {
        const match = String(record.id ?? '').match(new RegExp(`^${prefix}-(\\d+)$`));
        return Math.max(value, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}-${String(maximum + 1).padStart(3, '0')}`;
}
export function nextCycleId(state) {
    return next(state.cycles, 'CYCLE');
}
export function nextFindingId(state) {
    return next(state.findings, 'FND');
}
export function nextDecisionId(state) {
    return next(state.decisions, 'DEC');
}
export function nextGapId(state) {
    return next(state.dataGaps, 'GAP');
}
export function nextRouteId(state) {
    return next(state.routes, 'ACT');
}
//# sourceMappingURL=ids.js.map