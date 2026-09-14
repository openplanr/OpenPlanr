import {
  DefinitionGrid,
  MetricStat,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { AuditNotice, AuditRecords } from '../evidence/audit-records.js';
import '../operate.css';
import { resolveOperateOutcomeModel } from './outcome-model.js';

export type OutcomesPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

export function OutcomesPage({ currentBinding, current }: OutcomesPageProps) {
  const model = resolveOperateOutcomeModel(current, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-audit pc-operate" data-route-kind="operate.outcomes">
        <StatePanel
          state="incompatible"
          eyebrow="Outcomes projection"
          title="Outcomes cannot be trusted"
          description="The owner-issued audit display did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const head = `${model.surface.eventHead.sequence} · ${model.surface.eventHead.hash ?? 'genesis'}`;

  if (model.kind === 'outcome') {
    return (
      <div
        className="op-workspace op-audit pc-operate"
        data-route-kind="operate.outcome"
        data-audit-presentation={model.presentation}
      >
        <SectionHeader
          headingLevel={1}
          eyebrow="planr-operate · outcome"
          title="Outcome"
          description="Track what changed and what still needs proof."
        />
        <DefinitionGrid
          items={[
            { term: 'Outcome ID', description: model.subjectId ?? 'Not returned', mono: true },
            { term: 'Event record', description: head, mono: true },
            { term: 'View key', description: model.surface.viewHash, mono: true },
          ]}
        />
        <AuditNotice presentation={model.presentation} />
        <AuditRecords heading="Outcome" records={[model.outcome]} />
        <AuditRecords heading="Learnings" records={model.learnings} />
      </div>
    );
  }

  return (
    <div
      className="op-workspace op-audit pc-operate"
      data-route-kind="operate.outcomes"
      data-audit-presentation={model.presentation}
    >
      <ul className="pc-metrics" aria-label="Outcomes">
        <MetricStat label="domain metrics" value={model.domainMetrics.length} />
        <MetricStat label="outcomes" value={model.outcomes.length} />
        <MetricStat label="learnings" value={model.learnings.length} />
      </ul>
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-operate · outcomes"
        title="Outcomes"
        description="Track results, measurements, and what the team learned."
      />
      <DefinitionGrid
        items={[
          { term: 'Event record', description: head, mono: true },
          { term: 'View key', description: model.surface.viewHash, mono: true },
        ]}
      />
      <AuditNotice presentation={model.presentation} />
      <AuditRecords heading="Domain metrics" records={model.domainMetrics} />
      <AuditRecords heading="Outcomes" records={model.outcomes} />
      <AuditRecords heading="Learnings" records={model.learnings} />
    </div>
  );
}
