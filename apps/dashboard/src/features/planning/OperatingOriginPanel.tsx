import { DeliveryTrace } from './DeliveryTrace.js';
import {
  normalizePlanningOperatingOrigin,
  type PlanningOperatingOrigin,
  planningReturnHref,
} from './planning-trace-model.js';

export type OperatingOriginPanelProps = Readonly<{
  envelope: unknown;
  title?: string;
  summary?: string;
}>;

function Fact({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === '' ? 'Not available' : value}</dd>
    </div>
  );
}

function OriginIntegrity({ origin }: { origin: PlanningOperatingOrigin }) {
  const eventHead =
    origin.eventHead.sequence === null
      ? null
      : `${origin.eventHead.sequence} · ${origin.eventHead.hash ?? 'genesis'}`;
  return (
    <details className="op-planning-origin__details">
      <summary>Origin integrity details</summary>
      <dl className="op-cycle-custody">
        <Fact label="Proposal" value={origin.proposalId} />
        <Fact label="Proposal revision" value={origin.proposalRevision} />
        <Fact label="Proposal digest" value={origin.proposalHash} />
        <Fact label="Event head" value={eventHead} />
        <Fact label="Origin digest" value={origin.originHash} />
        <Fact label="Planning receipt" value={origin.transaction.receiptHash} />
        <Fact label="Planning provenance" value={origin.transaction.planningProvenanceEventId} />
        <Fact
          label="Verification plan"
          value={
            typeof origin.verification.verificationPlanId === 'string'
              ? origin.verification.verificationPlanId
              : null
          }
        />
        <Fact
          label="Metric"
          value={typeof origin.metric.metricId === 'string' ? origin.metric.metricId : null}
        />
      </dl>
    </details>
  );
}

/** Read-only operating origin and delivery trace for Planning detail surfaces. */
export function OperatingOriginPanel({ envelope, title, summary }: OperatingOriginPanelProps) {
  const record =
    envelope && typeof envelope === 'object' ? (envelope as Record<string, unknown>) : {};
  const origin = normalizePlanningOperatingOrigin(record.origin ?? envelope);
  const operateHref = planningReturnHref(origin);
  const heading =
    title ??
    (origin.spec.specId ? `Why ${origin.spec.specId} exists` : 'Why this Planning work exists');
  return (
    <section
      className="op-planning-origin planning-operating-origin"
      aria-label="Operating origin and delivery trace"
      data-origin-state={origin.status}
    >
      <header className="op-planning-origin__header">
        <div>
          <p className="op-eyebrow">Operating origin</p>
          <h2>{heading}</h2>
          <p>
            {summary ??
              'The sidecar preserves exact Operate custody while Planning remains independently authoritative.'}
          </p>
        </div>
        {operateHref ? (
          <a className="op-cycle-link" href={operateHref}>
            Open in Operate
          </a>
        ) : null}
      </header>
      <dl className="op-cycle-custody">
        <Fact label="SPEC" value={origin.spec.specId} />
        <Fact label="Status" value={origin.spec.status} />
        <Fact label="Decision" value={origin.decision.id} />
        <Fact label="Action" value={origin.action.id} />
        <Fact label="Correlation" value={origin.correlationId} />
      </dl>
      <OriginIntegrity origin={origin} />
      <section
        className="op-planning-origin__trace"
        aria-labelledby="op-planning-delivery-trace-title"
      >
        <header className="op-cycle-section-heading">
          <div>
            <h3 id="op-planning-delivery-trace-title">Delivery and value trace</h3>
            <p>
              Each state belongs to its own ledger. Delivery is evidence; it is not Outcome success.
            </p>
          </div>
        </header>
        <DeliveryTrace progress={record.progress ?? { nodes: [] }} />
      </section>
    </section>
  );
}
