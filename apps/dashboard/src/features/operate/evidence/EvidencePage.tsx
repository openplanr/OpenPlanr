import {
  DefinitionGrid,
  MetricStat,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { AuditNotice, AuditRecords } from './audit-records.js';
import { resolveOperateEvidenceModel } from './evidence-model.js';
import '../operate.css';

export type EvidencePageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

export function EvidencePage({ currentBinding, current }: EvidencePageProps) {
  const model = resolveOperateEvidenceModel(current, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-audit pc-operate" data-route-kind="operate.evidence">
        <StatePanel
          state="incompatible"
          eyebrow="Evidence projection"
          title="Evidence cannot be trusted"
          description="The owner-issued audit display did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const evidence = model.detailRequested
    ? model.evidence.filter((record) => Reflect.get(record, 'evidenceRefId') === model.subjectId)
    : model.evidence;
  const head = `${model.surface.eventHead.sequence} · ${model.surface.eventHead.hash ?? 'genesis'}`;

  return (
    <div
      className="op-workspace op-audit pc-operate"
      data-route-kind={model.detailRequested ? 'operate.evidence-item' : 'operate.evidence'}
      data-audit-presentation={model.presentation}
    >
      <ul className="pc-metrics" aria-label="Evidence">
        <MetricStat label="rows" value={evidence.length} />
        {model.detailRequested ? null : (
          <>
            <MetricStat label="claims" value={model.claims.length} />
            <MetricStat label="rationale" value={model.rationale.length} />
          </>
        )}
      </ul>
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-operate · evidence"
        title={model.detailRequested ? 'Evidence item' : 'Evidence'}
        description="See what supports or challenges the work."
      />
      <DefinitionGrid
        items={[
          { term: 'Event record', description: head, mono: true },
          { term: 'View key', description: model.surface.viewHash, mono: true },
        ]}
      />
      <AuditNotice presentation={model.presentation} />
      {model.detailRequested && evidence.length === 0 ? (
        <StatePanel
          state="unavailable"
          eyebrow="Exact item"
          title="Requested evidence was not returned"
          description="The owner-issued Evidence surface does not contain this subject."
        />
      ) : (
        <>
          <AuditRecords heading="Evidence" records={evidence} />
          {model.detailRequested ? null : (
            <>
              <AuditRecords heading="Claims" records={model.claims} />
              <AuditRecords heading="Rationale" records={model.rationale} />
            </>
          )}
        </>
      )}
    </div>
  );
}
