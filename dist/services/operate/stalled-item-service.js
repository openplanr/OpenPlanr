const projectedStalls = new WeakMap();
function closedCyclesAfter(events, sequence) {
    return new Set(events
        .filter((event) => event.type === 'cycle.closed' && event.sequence > sequence)
        .map((event) => event.cycleId)).size;
}
function routeFindingIds(events) {
    const routes = new Map();
    for (const event of events) {
        if (event.type !== 'route.proposed')
            continue;
        const record = event.payload.record;
        if (!record || typeof record !== 'object' || Array.isArray(record))
            continue;
        const route = record;
        const actions = Array.isArray(route.actions) ? route.actions : [];
        routes.set(event.entityId, [
            ...new Set(actions
                .map((action) => action && typeof action === 'object' && !Array.isArray(action)
                ? action.findingId
                : null)
                .filter((findingId) => typeof findingId === 'string')),
        ].sort());
    }
    return routes;
}
function latestSequence(events, predicate) {
    return events.reduce((latest, event) => (predicate(event) ? Math.max(latest, event.sequence) : latest), 0);
}
/**
 * Derives absolute stall counters from lifecycle evidence. Replaying the same
 * event chain always produces the same counters; no wall-clock time is used.
 */
export function deriveOperatingStalledItems(state, events) {
    const routeFindings = routeFindingIds(events);
    const routeIdsByFinding = new Map();
    for (const [routeId, findingIds] of routeFindings) {
        for (const findingId of findingIds) {
            routeIdsByFinding.set(findingId, [...(routeIdsByFinding.get(findingId) ?? []), routeId]);
        }
    }
    const items = [];
    for (const finding of state.findings) {
        const acceptedAt = latestSequence(events, (event) => event.type === 'finding.accepted' && event.entityId === finding.id);
        if (acceptedAt === 0)
            continue;
        const routeIds = new Set(routeIdsByFinding.get(finding.id) ?? []);
        const routeApplied = state.routes.some((route) => routeIds.has(route.id) && route.state === 'applied');
        const terminal = routeApplied || ['done', 'rejected', 'superseded'].includes(String(finding.status));
        const progressAt = latestSequence(events, (event) => (event.entityId === finding.id &&
            ['finding.accepted', 'finding.queued', 'finding.in-progress', 'finding.done'].includes(event.type)) ||
            (routeIds.has(event.entityId) &&
                ['route.accepted', 'route.prepared', 'route.applied'].includes(event.type)));
        const stalledCycles = terminal ? 0 : closedCyclesAfter(events, progressAt || acceptedAt);
        items.push({
            id: finding.id,
            kind: 'finding',
            stalledCycles,
            stalled: stalledCycles >= 2,
            lastProgressSequence: progressAt || acceptedAt,
        });
    }
    for (const decision of state.decisions) {
        const openedAt = latestSequence(events, (event) => event.type === 'decision.open' && event.entityId === decision.id);
        if (openedAt === 0)
            continue;
        const terminal = ['answered', 'closed', 'superseded'].includes(String(decision.status));
        const stalledCycles = terminal ? 0 : closedCyclesAfter(events, openedAt);
        items.push({
            id: decision.id,
            kind: 'decision',
            stalledCycles,
            stalled: stalledCycles >= 2,
            lastProgressSequence: openedAt,
        });
    }
    return items.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
export function projectOperatingStalledItems(state, events) {
    const stalls = deriveOperatingStalledItems(state, events);
    const findingCycles = new Map(stalls.filter((item) => item.kind === 'finding').map((item) => [item.id, item.stalledCycles]));
    const projected = {
        ...state,
        findings: state.findings.map((finding) => {
            const stalledCycles = findingCycles.get(finding.id);
            return stalledCycles === undefined ? finding : { ...finding, stalledCycles };
        }),
        summary: {
            ...state.summary,
            stalledItems: stalls.filter((item) => item.stalled).length,
        },
    };
    projectedStalls.set(projected, stalls);
    return projected;
}
export function operatingStalledItems(state) {
    return (projectedStalls.get(state)?.map((item) => ({ ...item })) ??
        state.findings
            .filter((finding) => Number(finding.stalledCycles ?? 0) > 0)
            .map((finding) => ({
            id: finding.id,
            kind: 'finding',
            stalledCycles: Number(finding.stalledCycles),
            stalled: Number(finding.stalledCycles) >= 2,
            lastProgressSequence: 0,
        })));
}
export function attachOperatingStalledItems(state, stalls) {
    projectedStalls.set(state, stalls.map((item) => ({ ...item })));
    return state;
}
export function overdueOperatingDecisionIds(state, now) {
    const instant = now.getTime();
    return state.decisions
        .filter((decision) => decision.status === 'open' &&
        Number.isFinite(Date.parse(String(decision.deadline))) &&
        Date.parse(String(decision.deadline)) <= instant)
        .map((decision) => decision.id)
        .sort();
}
//# sourceMappingURL=stalled-item-service.js.map