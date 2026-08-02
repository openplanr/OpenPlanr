import { canonicalize } from './canonical.js';
import { attachOperatingStalledItems, operatingStalledItems } from './stalled-item-service.js';
function text(record, key, fallback) {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : fallback;
}
function bounded(value, maximumWords) {
    const words = value.split(/\s+/).filter(Boolean);
    return words.length <= maximumWords ? value : `${words.slice(0, maximumWords).join(' ')}…`;
}
function evidence(record) {
    const refs = Array.isArray(record.evidenceRefs)
        ? [
            ...new Set(record.evidenceRefs.filter((value) => typeof value === 'string')),
        ]
            .sort()
            .slice(0, 4)
        : [];
    return refs.length > 0 ? refs.map((reference) => `\`${reference}\``).join(', ') : 'none';
}
function rankedFindings(state) {
    const severity = { critical: 4, high: 3, medium: 2, low: 1 };
    return [...state.findings]
        .filter((finding) => finding.parked !== true && finding.status !== 'rejected')
        .sort((left, right) => {
        const severityDelta = (severity[String(right.severity)] ?? 0) -
            (severity[String(left.severity)] ?? 0);
        if (severityDelta !== 0)
            return severityDelta;
        const scoreDelta = Number(right.score ?? 0) - Number(left.score ?? 0);
        return scoreDelta || String(left.id).localeCompare(String(right.id));
    });
}
export function renderOperatingBrief(state) {
    const cycle = state.summary.currentCycleId ?? 'No active cycle';
    const constraint = state.summary.currentConstraint ?? 'No current constraint';
    const stalls = operatingStalledItems(state);
    const stalledById = new Map(stalls.map((item) => [item.id, item.stalledCycles]));
    const activeDecisions = state.decisions.filter((decision) => ['open', 'default-due'].includes(String(decision.status)));
    const activeGaps = state.dataGaps.filter((gap) => gap.status === 'open');
    if (state.summary.quiet &&
        activeDecisions.length === 0 &&
        activeGaps.length === 0 &&
        !stalls.some((item) => item.stalled)) {
        return [
            '# OpenPlanr Operating Brief',
            `Cycle ${cycle} is quiet.`,
            `No material action is recommended; evidence freshness is ${state.summary.evidenceFreshness}.`,
        ].join('\n');
    }
    const findings = rankedFindings(state).slice(0, 5);
    const decisions = activeDecisions
        .sort((left, right) => {
        const overdueDelta = Number(right.status === 'default-due') - Number(left.status === 'default-due');
        return (overdueDelta ||
            String(left.deadline ?? '').localeCompare(String(right.deadline ?? '')) ||
            left.id.localeCompare(right.id));
    })
        .slice(0, 4);
    const gaps = activeGaps.slice(0, 4);
    const outcomes = state.outcomes.slice(0, 4);
    const lines = [
        '# OpenPlanr Operating Brief',
        '',
        `Cycle: ${cycle}`,
        `Evidence: ${state.summary.evidenceFreshness}`,
        `Current constraint: ${bounded(constraint, 40)}`,
        '',
        '## Recommended actions',
        '',
        ...(findings.length > 0
            ? findings.map((finding) => `- **${finding.id}: ${bounded(text(finding, 'title', 'Untitled finding'), 18)}** — ${text(finding, 'lane', 'OWNER')} · ${text(finding, 'owner', 'unassigned')}.${(stalledById.get(String(finding.id)) ?? 0) >= 2 ? ` Stalled: ${stalledById.get(String(finding.id))} closed cycles.` : ''} ${bounded(text(finding, 'proposal', text(finding, 'problem', 'Review the cited evidence.')), 45)} Evidence: ${evidence(finding)}.`)
            : ['- No governed actions are currently surfaced.']),
        '',
        '## Owner decisions',
        '',
        ...(decisions.length > 0
            ? decisions.map((decision) => `- **${decision.id}:**${decision.status === 'default-due' ? ' **DEFAULT DUE — no action executed.**' : ''} ${bounded(text(decision, 'question', 'Decision required'), 32)}${(stalledById.get(decision.id) ?? 0) >= 2 ? ` Stalled: ${stalledById.get(decision.id)} closed cycles.` : ''} Recommendation: ${bounded(text(decision, 'recommendation', 'Review the available options.'), 28)} Evidence: ${evidence(decision)}.`)
            : ['- No owner decisions are open.']),
        '',
        '## Evidence gaps',
        '',
        ...(gaps.length > 0
            ? gaps.map((gap) => `- **${gap.id}:** ${bounded(text(gap, 'question', 'Evidence required'), 28)} Owner: ${text(gap, 'owner', 'unassigned')}. Evidence: ${evidence(gap)}.`)
            : ['- No blocking evidence gaps are open.']),
        '',
        '## Outcomes',
        '',
        ...(outcomes.length > 0
            ? outcomes.map((outcome) => `- **${outcome.id}:** ${bounded(text(outcome, 'metric', 'Tracked outcome'), 20)} — ${text(outcome, 'status', 'pending')}. Evidence: ${evidence(outcome)}.`)
            : ['- No outcome observation is ready yet.']),
        '',
        `Parked findings: ${state.summary.parkedFindings} · Stalled items: ${state.summary.stalledItems}`,
        '',
        'Complete registers:',
        '`planr operate findings list` · `planr operate decisions list` · `planr operate gaps list` · `planr operate routes list`',
    ];
    return lines.join('\n');
}
/**
 * The complete advisory board (FR5). Every role renders a `board/<role>.md`
 * lens report for each reviewable/closed cycle — roles a cycle did not enable
 * are still written explicitly as `not_evaluated` so the readable tree never
 * hides a silent lens.
 */
export const OPERATING_BOARD_ROLES = [
    { id: 'strategy-finance', label: 'Strategy & Finance (CEO)' },
    { id: 'technology-risk', label: 'Technology & Risk (CTO)' },
    { id: 'product-activation', label: 'Product & Activation (CPO)' },
    { id: 'growth-market', label: 'Growth & Market (CMO)' },
    { id: 'operations-customer', label: 'Operations & Customer (COO)' },
    { id: 'chair', label: 'Chair' },
];
/**
 * State-derived lens report for a single board role and cycle. Role proposals
 * live outside the projected state, so the persisted board report carries the
 * cycle-local, role-attributable facts (evaluation status and the evidence gaps
 * that name the role) and points at the live `planr operate report` lens for
 * the full advisory output.
 *
 * `Status:` derives from whether a persisted `advisor-result` record actually
 * exists for the role+cycle (`evaluatedRoleIds`), never from `config.enabledRoles`
 * or `cycle.enabledRoles` — a role a cycle enabled but that never produced a
 * result must read `not_evaluated`, not "evaluated" (FR1). The rich
 * `markdownLens` assembly in `reports.ts` is the primary board renderer; this
 * state-only renderer is the honest fallback when the advisor-result records
 * cannot be re-read from the event log.
 */
export function renderOperatingBoardReport(state, cycleId, role, evaluatedRoleIds = new Set()) {
    const evaluated = evaluatedRoleIds.has(role.id);
    const lines = [
        `# ${role.label} — ${cycleId}`,
        '',
        `Status: ${evaluated ? 'evaluated' : 'not_evaluated'}`,
        '',
    ];
    const gaps = state.dataGaps.filter((gap) => gap.cycleId === cycleId &&
        Array.isArray(gap.affectedRoles) &&
        gap.affectedRoles.some((entry) => entry === role.id));
    if (!evaluated) {
        lines.push(`This advisory lens produced no advisor-result record for ${cycleId}; it was not evaluated.`);
        // FR8: when the not_evaluated state was driven by a governed gap naming this
        // lens, state that gap's real question and reason — never a bare "- None." —
        // so the board file is honest about WHY the lens was not evaluated. A lens
        // with no gap naming it keeps the bare not-evaluated line (no empty section).
        if (gaps.length > 0) {
            lines.push('', '## Evidence gaps', '', ...gaps.map((gap) => `- **${text(gap, 'id', 'GAP')}:** ${bounded(text(gap, 'question', 'Evidence required'), 28)}${text(gap, 'reason', '') ? ` — ${bounded(text(gap, 'reason', ''), 40)}` : ''}`));
        }
        return lines.join('\n');
    }
    lines.push('## Evidence gaps', '', ...(gaps.length > 0
        ? gaps.map((gap) => `- **${text(gap, 'id', 'GAP')}:** ${bounded(text(gap, 'question', 'Evidence required'), 28)}`)
        : ['- None.']), '', `Full lens report: \`planr operate report ${cycleId} --lens ${role.id}\``);
    return lines.join('\n');
}
/**
 * Canonical machine-readable evidence index (FR5). The projected state carries
 * evidence-source summaries rather than the full v1.3 evidence items, so this
 * index reflects those sources deterministically for the readable tree.
 */
export function renderOperatingEvidenceIndex(state) {
    const sources = [...state.evidenceSources].sort((left, right) => String(left.id).localeCompare(String(right.id)));
    return `${canonicalize({
        kind: 'operating-evidence-index',
        generatedAt: state.generatedAt,
        eventHead: state.eventHead,
        evidenceFreshness: state.summary.evidenceFreshness,
        sources,
    })}\n`;
}
export function selectCycleState(state, cycleId) {
    if (!cycleId)
        return state;
    const sourceStalls = operatingStalledItems(state);
    const selected = {
        ...structuredClone(state),
        cycles: state.cycles.filter((cycle) => cycle.id === cycleId),
        findings: state.findings.filter((finding) => finding.cycleId === cycleId),
        decisions: state.decisions.filter((decision) => decision.cycleId === cycleId),
        dataGaps: state.dataGaps.filter((gap) => gap.cycleId === cycleId),
        routes: state.routes.filter((route) => route.cycleId === cycleId),
    };
    const surfaced = selected.findings.filter((finding) => finding.parked !== true);
    selected.summary = {
        ...selected.summary,
        currentCycleId: selected.cycles[0]?.id ?? null,
        currentConstraint: text(rankedFindings(selected)[0] ?? {}, 'problem', text(rankedFindings(selected)[0] ?? {}, 'title', '')) || null,
        quiet: surfaced.length === 0,
        surfacedFindings: surfaced.length,
        parkedFindings: selected.findings.length - surfaced.length,
        openDecisions: selected.decisions.filter((decision) => ['open', 'default-due'].includes(String(decision.status))).length,
        openGaps: selected.dataGaps.filter((gap) => gap.status === 'open').length,
        stalledItems: sourceStalls.filter((item) => item.stalled &&
            (selected.findings.some((finding) => finding.id === item.id) ||
                selected.decisions.some((decision) => decision.id === item.id))).length,
    };
    return attachOperatingStalledItems(selected, sourceStalls.filter((item) => selected.findings.some((finding) => finding.id === item.id) ||
        selected.decisions.some((decision) => decision.id === item.id)));
}
//# sourceMappingURL=projection.js.map