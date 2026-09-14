import {
  ActionStateBadge,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { OperatingSpine, operatingStageLabel } from '../cycles/OperatingSpine.js';
import { DecisionFocus, type OperateTodayContinuation } from './DecisionFocus.js';
import { EvidenceDesk } from './EvidenceDesk.js';
import {
  type OperateTodayModelSources,
  type OperateTodaySurfaceModel,
  resolveOperateTodayModel,
} from './today-model.js';
import '../operate.css';

export type TodayPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  sources: OperateTodayModelSources;
  onContinuation?: (continuation: OperateTodayContinuation) => void | Promise<void>;
}>;

function materialChange(model: OperateTodaySurfaceModel): string {
  const metric = model.domainMetrics[0];
  if (metric) {
    const metricTitle = metric.title ?? 'A key signal';
    if (metric.change) {
      const changeCopy = {
        added: 'is now available.',
        removed: 'is no longer available.',
        changed: 'has changed.',
        stale: 'may be out of date.',
        conflict: 'needs review.',
      }[metric.change.kind];
      return `${metricTitle} ${changeCopy}`;
    }
    const value = metric.value === null ? null : String(metric.value);
    return value
      ? `${metricTitle} is currently ${value}${metric.unit ? ` ${metric.unit}` : ''}.`
      : `${metricTitle} is current.`;
  }
  return model.priorityAttention?.whyNow ?? 'A fuller update is not available yet.';
}

function readableStatus(value: string): string {
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function attentionLabel(kind: OperateTodaySurfaceModel['attention'][number]['kind']): string {
  return {
    decision: 'Decision',
    approval: 'Approval',
    action: 'Action',
    verification: 'Verification',
    outcome: 'Outcome',
    uncertainty: 'Open question',
  }[kind];
}

function TodayContext({
  model,
}: {
  model: Exclude<ReturnType<typeof resolveOperateTodayModel>, OperateTodaySurfaceModel | null>;
}) {
  const firstUse = model.kind === 'first-use';
  return (
    <div className="op-workspace op-today pc-operate" data-route-kind="operate.today">
      <SectionHeader
        headingLevel={1}
        eyebrow={`planr-operate · today · ${model.vocabulary.context}`}
        title={model.vocabulary.title}
        description="Choose a workspace to see what needs attention."
      />
      <StatePanel
        state="first-use"
        eyebrow={firstUse ? 'First use' : 'Exact empty state'}
        title={firstUse ? 'No active work yet' : 'Nothing active here yet'}
        description={
          firstUse
            ? 'Choose a workspace from the available project context to get started.'
            : 'There is no active work in this workspace right now.'
        }
      />
      <p className="op-today__context-note">
        No next step is available until work is returned for this workspace.
      </p>
    </div>
  );
}

export function TodayPage({ currentBinding, sources, onContinuation }: TodayPageProps) {
  const model = resolveOperateTodayModel(sources, currentBinding);

  if (!model) {
    return (
      <div className="op-workspace op-today pc-operate" data-route-kind="operate.today">
        <StatePanel
          state="incompatible"
          eyebrow="Today projection"
          title="Today cannot be trusted"
          description="The returned state did not match the exact current binding and Today contract."
        />
      </div>
    );
  }

  if (model.kind !== 'surface') return <TodayContext model={model} />;

  return (
    <div
      className="op-workspace op-today pc-operate"
      data-route-kind="operate.today"
      data-today-presentation={model.presentation}
      data-today-source={model.source}
    >
      <SectionHeader
        headingLevel={1}
        eyebrow={`planr-operate · today · ${model.vocabulary.context}`}
        title={model.priorityAttention?.title ?? model.activeCycle.focus[0] ?? 'Continue this work'}
        description={materialChange(model)}
        actions={
          <ActionStateBadge state={model.presentation} label={readableStatus(model.presentation)} />
        }
      />

      {model.source === 'durable-resume' ? (
        <p className="pc-operate__notice" data-tone="verified" role="status">
          Your active work has been restored.
        </p>
      ) : null}

      {model.presentation !== 'ready' ? (
        <p className="pc-operate__notice" role="status">
          This is a {model.presentation} projection. Current access-safe truth remains visible;
          mutation stays unavailable.
        </p>
      ) : null}

      <OperatingSpine
        stages={model.activeCycle.stages}
        cycleId={model.activeCycle.cycleId}
        health={model.activeCycle.health}
        title={
          model.currentStage ? operatingStageLabel(model.currentStage.id) : model.activeCycle.state
        }
        labelledBy="op-today-spine-title"
      />

      <div className="op-today__desk-layout">
        <section className="op-today__work" aria-label="Today decision workspace">
          <DecisionFocus model={model} onContinuation={onContinuation} />

          <section className="pc-operate__section" aria-label="What needs attention now">
            <SectionHeader
              headingLevel={2}
              title="What needs attention now"
              count={`${model.attention.length} item${model.attention.length === 1 ? '' : 's'}`}
            />
            {model.attention.length > 0 ? (
              <ol className="pc-operate__records">
                {model.attention.map((attention) => (
                  <li className="pc-operate__record" key={attention.attentionId}>
                    <div className="pc-operate__record-head">
                      <h3 className="pc-operate__record-title">
                        <span className="pc-operate__record-index">
                          {attentionLabel(attention.kind)}
                        </span>{' '}
                        {attention.title}
                      </h3>
                      <ActionStateBadge state={attention.state} />
                    </div>
                    <p className="pc-operate__record-facts">{attention.whyNow}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pc-operate__notice">
                Nothing else needs attention in this active workspace.
              </p>
            )}
          </section>
        </section>

        <EvidenceDesk model={model} mode="wide" />
        <EvidenceDesk model={model} mode="compact" />
      </div>
    </div>
  );
}
