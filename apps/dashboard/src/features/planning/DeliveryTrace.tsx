import { memo, useState } from 'react';
import {
  ArtifactStatus,
  Button,
  InlineAlert,
  WorkItemChip,
} from '../../design-system/components/index.js';
import type { PlanningModelNode } from './planning-model.js';
import { planningDetailHref, planningDisplayId } from './planning-model.js';
import type { StructuralDetailModel } from './planning-structural-model.js';
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

/** Authored artifact lineage and downstream relationships, separate from delivery proof. */
function StructuralTraceContent({
  model,
  onNavigate,
}: Readonly<{
  model: StructuralDetailModel;
  onNavigate?: (node: PlanningModelNode) => void;
}>) {
  const pageSize = 12;
  const current = model.trace.findIndex((entry) => entry.role === 'Current artifact');
  const currentPage = Math.floor(Math.max(0, current) / pageSize);
  const anchor = `${model.trace[current]?.node.id}:${currentPage}`;
  const [selection, setSelection] = useState({ anchor, page: currentPage });
  const pages = Math.ceil(model.trace.length / pageSize);
  const page = selection.anchor === anchor ? selection.page : currentPage;
  const boundedPage = Math.min(page, Math.max(0, pages - 1));
  const setPage = (page: number) => setSelection({ anchor, page });
  return (
    <section className="pc-detail__structural-trace" aria-label="Structural trace">
      <ol className="op-planning-trace pc-detail__trace" aria-label="Artifact lineage">
        {model.trace
          .slice(boundedPage * pageSize, (boundedPage + 1) * pageSize)
          .map(({ node, role, blockedBy }) => {
            const href = planningDetailHref(node);
            return (
              <li
                key={node.id}
                data-kind={node.type}
                data-current={role === 'Current artifact' || undefined}
              >
                <span className="op-planning-trace__reason">{role}</span>
                {href ? (
                  <a
                    className="op-planning-trace__link"
                    href={href}
                    aria-current={role === 'Current artifact' ? 'step' : undefined}
                    onClick={
                      onNavigate
                        ? (event) => {
                            if (
                              event.button !== 0 ||
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              event.altKey
                            )
                              return;
                            event.preventDefault();
                            onNavigate(node);
                          }
                        : undefined
                    }
                  >
                    <WorkItemChip
                      type={node.type}
                      id={planningDisplayId(node)}
                      title={node.title}
                      interactive
                    />
                  </a>
                ) : (
                  <WorkItemChip type={node.type} id={planningDisplayId(node)} title={node.title} />
                )}
                <ArtifactStatus status={blockedBy ? 'blocked' : node.status} size="sm" />
              </li>
            );
          })}
      </ol>
      {pages > 1 ? (
        <nav className="pc-detail__trace-pages" aria-label="Trace pages">
          <Button size="sm" disabled={boundedPage === 0} onClick={() => setPage(boundedPage - 1)}>
            Previous trace items
          </Button>
          <span>
            {boundedPage * pageSize + 1}–
            {Math.min((boundedPage + 1) * pageSize, model.trace.length)} of {model.trace.length}{' '}
            artifacts
          </span>
          <Button
            size="sm"
            disabled={boundedPage === pages - 1}
            onClick={() => setPage(boundedPage + 1)}
          >
            Next trace items
          </Button>
        </nav>
      ) : null}
      {model.warnings.map((warning) => (
        <InlineAlert key={warning} tone="warning" title="Trace needs attention">
          {warning}
        </InlineAlert>
      ))}
    </section>
  );
}

export const StructuralTrace = memo(StructuralTraceContent);
