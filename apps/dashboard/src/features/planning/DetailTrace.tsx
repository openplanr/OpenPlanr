import { type CSSProperties, memo, useId } from 'react';
import { artifactTagType } from '../../design-system/components/artifact-recipes.js';
import { ArtifactStatus, InlineAlert, PcIcon } from '../../design-system/components/index.js';
import { useDetailSelectable } from './DetailSelection.js';
import { type DetailTraceStep, detailTraceSteps } from './planning-detail-trace.js';
import { type PlanningModelNode, planningDetailHref, planningDisplayId } from './planning-model.js';
import type { StructuralDetailModel } from './planning-structural-model.js';

const COLUMNS = 5;

function StepBody({ step }: { step: DetailTraceStep }) {
  if (step.kind === 'count')
    return (
      <>
        <span className="pc-detail__step-head">
          <span className="pc-detail__step-role">{step.role}</span>
        </span>
        <span className="pc-detail__step-name">
          <span className="pc-detail__step-count">{step.count}</span>
          <span className="pc-detail__step-summary">{step.summary}</span>
        </span>
      </>
    );
  const tag = artifactTagType(step.node.type);
  return (
    <>
      <span className="pc-detail__step-head">
        <span className="pc-detail__step-role">{step.role}</span>
        <ArtifactStatus
          status={step.blocked ? 'blocked' : step.node.status}
          variant="legend"
          size="sm"
        />
      </span>
      <span className="pc-detail__step-name">
        <span
          className="pc-detail__step-id"
          style={tag ? { color: `var(--pc-type-${tag})` } : undefined}
        >
          {planningDisplayId(step.node)}
        </span>
        <span className="pc-detail__step-title">{step.node.title}</span>
      </span>
    </>
  );
}

function StepLink({
  node,
  href,
  step,
}: {
  node: PlanningModelNode;
  href: string;
  step: DetailTraceStep;
}) {
  return (
    <a className="pc-detail__step" href={href} {...useDetailSelectable(node)}>
      <StepBody step={step} />
    </a>
  );
}

/** Where an item came from and what it unblocks; the current item is the only accent step. */
function DetailTraceContent({ model }: Readonly<{ model: StructuralDetailModel }>) {
  const headingId = useId();
  const steps = detailTraceSteps(model);
  const columns = Math.min(COLUMNS, Math.max(1, steps.length));
  return (
    <section className="pc-card pc-detail__trace-card" aria-labelledby={headingId}>
      <header className="pc-card__head pc-card__header">
        <h2 className="pc-card__title" id={headingId}>
          Trace
        </h2>
        <span className="pc-detail__trace-note">Where this came from and what it unblocks</span>
      </header>
      <ol
        className="pc-detail__trace"
        aria-label="Artifact lineage"
        style={{ '--pc-detail-trace-columns': columns } as CSSProperties}
      >
        {steps.map((step, index) => {
          const href = step.kind === 'node' && !step.current ? planningDetailHref(step.node) : null;
          return (
            <li
              key={step.kind === 'node' ? step.node.id : `count:${step.type}`}
              data-kind={step.kind === 'node' ? step.node.type : 'count'}
              data-current={(step.kind === 'node' && step.current) || undefined}
            >
              {index % columns ? (
                <span className="pc-detail__step-arrow" aria-hidden="true">
                  <PcIcon name="arrow-right" size={16} />
                </span>
              ) : null}
              {href && step.kind === 'node' ? (
                <StepLink node={step.node} href={href} step={step} />
              ) : (
                <div
                  className="pc-detail__step"
                  aria-current={step.kind === 'node' && step.current ? 'step' : undefined}
                >
                  <StepBody step={step} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {model.warnings.length ? (
        <div className="pc-detail__trace-warnings">
          {model.warnings.map((warning) => (
            <InlineAlert key={warning} tone="warning" title="Trace needs attention">
              {warning}
            </InlineAlert>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export const DetailTrace = memo(DetailTraceContent);
