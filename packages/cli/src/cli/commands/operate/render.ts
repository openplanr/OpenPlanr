import type { OperateApiEnvelopeV2 } from '../../../services/operate/client.js';
import type { PublicOperatingDomain } from '../../../services/operate/domain-catalog-service.js';
import { display } from '../../../utils/logger.js';

export type OperateExperienceSurfaceData = {
  kind: 'operate-experience-surface';
  surface: string;
  domainId: string;
  scopeId: string;
  status: string;
  eventHead: { sequence: number };
  viewHash: string;
  reasonCodes: string[];
  data: Record<string, unknown>;
};

export function renderOperateDomainCatalog(
  domains: readonly PublicOperatingDomain[],
  json = false,
): void {
  const envelope = {
    ok: true as const,
    operation: 'operate.domains.list' as const,
    data: { domains },
    allowedActions: [] as const,
  };
  if (json) {
    display.line(JSON.stringify(envelope));
    return;
  }
  display.line('Registered operating domains:');
  for (const domain of domains) {
    display.line(`${domain.domainId} · ${domain.domainVersion}`);
    for (const role of domain.roles) {
      display.line(`- ${role.roleId} · ${role.roleKind} · ${role.roleVersion} · ${role.label}`);
    }
  }
}

export function renderOperateExperienceSurfaceHuman(data: OperateExperienceSurfaceData): string[] {
  const lines = [
    `${data.surface[0].toUpperCase()}${data.surface.slice(1)} · ${data.domainId} / ${data.scopeId} · event ${data.eventHead.sequence} · ${data.status}`,
  ];
  for (const reason of data.reasonCodes) lines.push(`Reason: ${reason}`);
  const array = (value: unknown): Array<Record<string, unknown>> =>
    Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const activeCycle = data.data.activeCycle as Record<string, unknown> | null;
  const outcome = data.data.outcome as Record<string, unknown> | null;
  const rows =
    data.surface === 'today'
      ? [
          ...array(data.data.attention),
          ...array(data.data.domainMetrics),
          ...array(activeCycle?.assignments),
          ...array(data.data.actions),
          ...array(data.data.outcomes),
        ]
      : data.surface === 'cycles'
        ? array(data.data.cycles)
        : data.surface === 'cycle'
          ? data.data.cycle
            ? [
                data.data.cycle as Record<string, unknown>,
                ...array((data.data.cycle as Record<string, unknown>).assignments),
                ...array((data.data.cycle as Record<string, unknown>).stages),
              ]
            : []
          : data.surface === 'evidence'
            ? [...array(data.data.evidence), ...array(data.data.claims)]
            : data.surface === 'outcomes'
              ? [
                  ...array(data.data.domainMetrics),
                  ...array(data.data.outcomes),
                  ...array(data.data.learnings),
                ]
              : data.surface === 'history'
                ? [
                    ...array(data.data.history),
                    {
                      title: 'Replay proof',
                      state:
                        (
                          (data.data.replay as Record<string, unknown>)?.parityProof as Record<
                            string,
                            unknown
                          >
                        )?.stateParityVerified === true
                          ? 'verified'
                          : 'unverified',
                    },
                  ]
                : data.surface === 'outcome'
                  ? outcome
                    ? [outcome, ...array(data.data.learnings)]
                    : []
                  : data.surface === 'search'
                    ? array(data.data.results)
                    : [];
  if (data.surface === 'export') {
    lines.push(String(data.data.content ?? ''));
    return lines;
  }
  const allowedActions =
    data.surface === 'today'
      ? ((data.data.allowedActions as Array<Record<string, unknown>>) ?? [])
      : [];
  if (rows.length === 0 && allowedActions.length === 0) {
    lines.push('No matching operating work.');
    return lines;
  }
  for (const row of rows) {
    const label =
      row.title ??
      row.statement ??
      row.type ??
      row.evidenceRefId ??
      row.claimId ??
      row.assignmentId ??
      row.metricId ??
      row.cycleId ??
      row.outcomeId ??
      row.id;
    const state = row.state ?? row.status ?? row.accessState ?? '';
    const reason = row.whyNow ?? row.consequence ?? row.deepLink ?? '';
    lines.push(`- ${String(label)}${state ? ` · ${String(state)}` : ''}`);
    if (reason) lines.push(`  ${String(reason)}`);
    const dependencies = array(row.dependencies).length;
    const blockers = array(row.blockers).length;
    const gaps = Array.isArray(row.gaps)
      ? row.gaps.length
      : Array.isArray(row.evidenceGapIds)
        ? row.evidenceGapIds.length
        : 0;
    const verification = row.verification as Record<string, unknown> | null;
    const details = [
      row.role ? `role ${String(row.role)}` : '',
      row.value !== null && row.value !== undefined
        ? `value ${String(row.value)}${row.unit ? ` ${String(row.unit)}` : ''}`
        : '',
      row.claimStatus ? `claim ${String(row.claimStatus)}` : '',
      row.confidence !== null && row.confidence !== undefined
        ? `confidence ${String(row.confidence)}`
        : '',
      dependencies > 0 ? `${dependencies} dependencies` : '',
      blockers > 0 ? `${blockers} blockers` : '',
      gaps > 0 ? `${gaps} evidence gaps` : '',
      verification?.method ? `verify ${String(verification.method)}` : '',
    ].filter(Boolean);
    if (details.length > 0) lines.push(`  ${details.join(' · ')}`);
  }
  if (allowedActions.length > 0) {
    lines.push('Available governed actions:');
    for (const entry of allowedActions) {
      const action = (entry.action ?? entry) as Record<string, unknown>;
      lines.push(`- ${String(action.label)} · ${String(action.effect)}`);
    }
  }
  return lines;
}

function renderHumanSurface(data: OperateExperienceSurfaceData): void {
  for (const line of renderOperateExperienceSurfaceHuman(data)) display.line(line);
}

export function renderOperateEnvelope(envelope: OperateApiEnvelopeV2, json = false): void {
  if (json) {
    display.line(JSON.stringify(envelope));
    return;
  }
  if (!envelope.ok) {
    display.line(`${envelope.error.code}: ${envelope.error.message}`);
    return;
  }
  const data = envelope.data as Partial<OperateExperienceSurfaceData>;
  if (data?.kind === 'operate-experience-surface') {
    renderHumanSurface(data as OperateExperienceSurfaceData);
    return;
  }
  if (envelope.operation === 'operate.planning.preview') {
    const proposal = envelope.data as Record<string, unknown>;
    const preview = proposal.preview as Record<string, unknown>;
    const framing = proposal.framing as Record<string, unknown>;
    display.line(`Planning proposal ${String(proposal.proposalId)} · review required`);
    display.line(`${String(framing.title)} · ${String(proposal.cycleId)}`);
    display.line(`Confirm digest: ${String(preview.digest)}`);
    display.line(`Expires: ${String(preview.expiresAt)}`);
    display.line(
      `Create: planr operate planning create-spec ${String(proposal.proposalId)} --actor ${String((proposal.actor as Record<string, unknown>).actorId)} --confirm ${String(preview.digest)}`,
    );
    return;
  }
  if (envelope.operation === 'operate.planning.create-spec') {
    const receipt = envelope.data as Record<string, unknown>;
    display.line(`Created ${String(receipt.specId)} at ${String(receipt.specFile)}`);
    display.line(`Origin: ${String(receipt.originHash)}`);
    display.line('No decomposition, PLAN, SHIP, deployment, or external effect was started.');
    return;
  }
  if (envelope.operation === 'operate.review.get') {
    const reviewRead = envelope.data as Record<string, unknown>;
    const review = reviewRead.review as Record<string, unknown>;
    const rows = (field: string): Record<string, unknown>[] =>
      Array.isArray(reviewRead[field]) ? (reviewRead[field] as Record<string, unknown>[]) : [];
    display.line(`Review ${String(review.reviewId)} · ${String(review.state)}`);
    display.line(
      `${rows('decisions').length} decision(s) · ${rows('actions').length} action(s) · ${rows('findings').length} Finding(s) · ${rows('dissent').length} dissent item(s) · ${rows('gaps').length} gap(s)`,
    );
    for (const decision of rows('decisions')) {
      display.line(`Decision ${String(decision.decisionId)} · ${String(decision.title)}`);
    }
    for (const action of rows('actions')) {
      display.line(
        `Action ${String(action.actionId)} · ${String(action.title)} · ${String(action.state)}`,
      );
    }
    for (const finding of rows('findings')) {
      display.line(
        `Finding ${String(finding.findingId)} · ${String(finding.title)} · ${String(finding.severity)}`,
      );
    }
    display.line('Advertised disposition choices:');
    for (const choice of rows('dispositionChoices')) {
      display.line(
        `${String(choice.choiceId)} · ${String(choice.label)} · ${String(choice.choiceHash)}`,
      );
    }
    return;
  }
  if (envelope.operation === 'operate.review.submit') {
    const receipt = envelope.data as Record<string, unknown>;
    const summary = receipt.summary as Record<string, unknown>;
    display.line(`Review receipt ${String(receipt.receiptId)} · ${String(receipt.decision)}`);
    display.line(String(summary.message));
    return;
  }
  display.line(`${envelope.operation} completed`);
  display.line(JSON.stringify(envelope.data, null, 2));
}
