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
import { resolveOperateHistoryModel } from './history-model.js';

export type HistoryPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function replayFacts(replay: object): readonly Readonly<{ key: string; value: string }>[] {
  const tail = Reflect.get(replay, 'tail');
  const finalHead = Reflect.get(replay, 'finalHead');
  const parity = Reflect.get(replay, 'parityProof');
  const facts: Array<{ key: string; value: string }> = [];
  if (typeof tail === 'object' && tail !== null) {
    const start = Reflect.get(tail, 'startSequence');
    const end = Reflect.get(tail, 'endSequence');
    const count = Reflect.get(tail, 'eventCount');
    if (typeof start === 'number') facts.push({ key: 'Tail start', value: String(start) });
    if (typeof end === 'number') facts.push({ key: 'Tail end', value: String(end) });
    if (typeof count === 'number') facts.push({ key: 'Event count', value: String(count) });
  }
  if (typeof finalHead === 'object' && finalHead !== null) {
    const sequence = Reflect.get(finalHead, 'sequence');
    const hash = Reflect.get(finalHead, 'hash');
    if (typeof sequence === 'number') facts.push({ key: 'Final head', value: String(sequence) });
    if (typeof hash === 'string') facts.push({ key: 'Final hash', value: hash });
  }
  if (typeof parity === 'object' && parity !== null) {
    for (const key of [
      'checkpointVerified',
      'finalEventHashMatches',
      'stateParityVerified',
    ] as const) {
      const value = Reflect.get(parity, key);
      if (typeof value === 'boolean') facts.push({ key, value: value ? 'true' : 'false' });
    }
  }
  const liveAccessUsed = Reflect.get(replay, 'liveAccessUsed');
  if (typeof liveAccessUsed === 'boolean') {
    facts.push({ key: 'Live access used', value: liveAccessUsed ? 'true' : 'false' });
  }
  return Object.freeze(facts);
}

export function HistoryPage({ currentBinding, current }: HistoryPageProps) {
  const model = resolveOperateHistoryModel(current, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-audit pc-operate" data-route-kind="operate.history">
        <StatePanel
          state="incompatible"
          eyebrow="History projection"
          title="History cannot be trusted"
          description="The owner-issued audit display did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const proof = replayFacts(model.replay);
  const head = `${model.surface.eventHead.sequence} · ${model.surface.eventHead.hash ?? 'genesis'}`;

  return (
    <div
      className="op-workspace op-audit pc-operate"
      data-route-kind="operate.history"
      data-audit-presentation={model.presentation}
    >
      <ul className="pc-metrics" aria-label="History">
        <MetricStat label="events" value={model.history.length} />
      </ul>
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-operate · history"
        title="History"
        description="See what changed, why it changed, and what happens next."
      />
      <DefinitionGrid
        items={[
          { term: 'Event record', description: head, mono: true },
          { term: 'View key', description: model.surface.viewHash, mono: true },
        ]}
      />
      <AuditNotice presentation={model.presentation} />
      <AuditRecords heading="History" records={model.history} />
      <section className="pc-operate__section" aria-label="Replay proof">
        <SectionHeader headingLevel={2} title="Replay proof" count={proof.length} />
        {proof.length === 0 ? (
          <StatePanel
            state="unavailable"
            eyebrow="Replay"
            title="No replay proof returned"
            description="OpenPlanr returned no checkpoint, tail, head, or parity fields for this Cycle."
          />
        ) : (
          <DefinitionGrid
            items={proof.map((fact) => ({ term: fact.key, description: fact.value, mono: true }))}
          />
        )}
      </section>
    </div>
  );
}
