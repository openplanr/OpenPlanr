import {
  normalizePlanningDeliveryTrace,
  type PlanningDeliveryTraceNode,
} from './planning-trace-model.js';

export type DeliveryTraceProps = Readonly<{
  progress: unknown;
  label?: string;
  reason?: string;
}>;

function TraceStep({ node }: { node: PlanningDeliveryTraceNode }) {
  const content = (
    <>
      <span className="op-planning-trace__label">{node.label}</span>
      <span className="op-planning-trace__meta">
        {node.owner} · {node.state}
      </span>
      {node.reason ? <span className="op-planning-trace__reason">{node.reason}</span> : null}
    </>
  );
  return (
    <li data-kind={node.kind} data-state={node.state}>
      {node.href ? (
        <a className="op-cycle-link op-planning-trace__link" href={node.href}>
          {content}
        </a>
      ) : (
        <div className="op-planning-trace__static">{content}</div>
      )}
    </li>
  );
}

/** Projection-only delivery trace; never upgrades missing records to success or failure. */
export function DeliveryTrace({ progress, label, reason }: DeliveryTraceProps) {
  const nodes = normalizePlanningDeliveryTrace(progress, { label, reason });
  return (
    <ol className="op-planning-trace operate-delivery-trace" aria-label={label ?? 'Delivery trace'}>
      {nodes.map((node) => (
        <TraceStep key={`${node.kind}:${node.subjectId ?? 'none'}`} node={node} />
      ))}
    </ol>
  );
}
