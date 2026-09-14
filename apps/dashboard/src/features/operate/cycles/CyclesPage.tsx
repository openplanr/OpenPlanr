/* biome-ignore-all lint/suspicious/noArrayIndexKey: owner Cycle order and duplicate display values remain visible without client deduplication. */
import {
  assertOperateExperienceDisplaySurfaceV1,
  type OperateDisplayBindingV1,
  type OperateExperienceDisplaySurfaceV1,
} from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import {
  ActionStateBadge,
  DataTable,
  type DataTableColumn,
  MetricStat,
  SectionHeader,
  StatePanel,
} from '../../../design-system/components/index.js';
import type { DashboardProductState } from '../../../lib/api/product-state.js';
import { isValidatedDashboardProductState } from '../../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import {
  createDashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../../lib/binding/query-identity.js';
import { operatingStageLabel } from './OperatingSpine.js';
import '../operate.css';

type CyclesDisplay = Readonly<OperateExperienceDisplaySurfaceV1>;
type CyclesSurface = Extract<CyclesDisplay['payload'], { surface: 'cycles' }>;
type CyclesPresentation = 'ready' | 'read-only' | 'stale' | 'partial' | 'blocked' | 'offline';

export type CyclesPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

function humanLabel(value: string): string {
  const words = value.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words === '' ? value : `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

const PRESENTATION = Object.freeze({
  ready: 'ready',
  'read-only': 'read-only',
  stale: 'stale',
  partial: 'partial',
  blocked: 'blocked',
  offline: 'offline',
} satisfies Readonly<Record<CyclesPresentation, CyclesPresentation>>);

function exactCyclesBinding(value: DashboardQueryIdentity): DashboardQueryIdentity | null {
  try {
    const binding = createDashboardQueryIdentity(value);
    return binding.productArea === 'operate' &&
      binding.route === '#/operate/cycles' &&
      binding.subjectId === null &&
      binding.eventHead !== null &&
      binding.viewHash !== null
      ? binding
      : null;
  } catch {
    return null;
  }
}

/** Parser validator: exact query custody plus the owner schema/semantic/SHA-256-JCS verifier. */
export function createOperateCyclesDisplayValidator(
  current: DashboardQueryIdentity,
): (value: unknown) => value is CyclesDisplay {
  const binding = exactCyclesBinding(current);
  return (value: unknown): value is CyclesDisplay => {
    if (!binding || !Object.isFrozen(value)) return false;
    try {
      const display = assertOperateExperienceDisplaySurfaceV1(value);
      const payload = display.payload;
      if (
        payload.surface !== 'cycles' ||
        binding.eventHead === null ||
        binding.viewHash === null ||
        payload.eventHead.sequence !== binding.eventHead.sequence ||
        payload.eventHead.hash !== binding.eventHead.hash
      ) {
        return false;
      }
      const expected: OperateDisplayBindingV1 = Object.freeze({
        actorId: binding.actorId,
        scopeId: binding.scopeId,
        domainId: binding.domainId,
        domainVersion: binding.domainVersion,
        generatedAt: payload.generatedAt,
        eventHead: payload.eventHead,
        viewHash: binding.viewHash,
        surface: 'cycles',
        subjectId: null,
        cycleId: binding.cycleId,
      });
      assertOperateExperienceDisplaySurfaceV1(display, expected);
      return true;
    } catch {
      return false;
    }
  };
}

function resolveCyclesSurface(
  state: DashboardProductState<unknown>,
  current: DashboardQueryIdentity,
): Readonly<{
  display: CyclesDisplay;
  surface: CyclesSurface;
  presentation: CyclesPresentation;
}> | null {
  const binding = exactCyclesBinding(current);
  if (
    !binding ||
    !isValidatedDashboardProductState(state) ||
    state.binding === null ||
    state.data === null ||
    !isCurrentDashboardQuery(state.binding, binding) ||
    !createOperateCyclesDisplayValidator(binding)(state.data)
  ) {
    return null;
  }
  const display = state.data;
  if (display.payload.surface !== 'cycles') return null;
  const surface = display.payload;
  const presentation = PRESENTATION[state.kind as CyclesPresentation];
  if (
    presentation === undefined ||
    surface.status !== presentation ||
    surface.mutationEnabled !== state.mutationEnabled
  ) {
    return null;
  }
  return Object.freeze({ display, surface, presentation });
}

function cycleVocabulary(domainId: string): string {
  return domainId === 'business'
    ? 'Business Cycles'
    : domainId === 'software'
      ? 'Repository Cycles'
      : 'Operating Cycles';
}

type CycleRow = CyclesSurface['data']['cycles'][number] & Readonly<{ id: string }>;

const ATTENTION_CYCLE_STATES = new Set(['blocked', 'failed', 'cancelled']);

function currentStageLabel(cycle: CyclesSurface['data']['cycles'][number]): string {
  const currentStage = cycle.stages.find((stage) => stage.state === 'current');
  return currentStage ? operatingStageLabel(currentStage.id) : humanLabel(cycle.health);
}

const CYCLE_COLUMNS: readonly DataTableColumn<CycleRow>[] = [
  {
    key: 'cycle',
    label: 'Cycle',
    render: (row) => (
      <a className="pc-row-link" href={row.deepLink} aria-label={`Open ${row.focus[0] ?? 'cycle'}`}>
        {row.focus[0] ?? 'Untitled cycle'}
      </a>
    ),
  },
  { key: 'state', label: 'State', render: (row) => <ActionStateBadge state={row.state} /> },
  { key: 'health', label: 'Health', render: (row) => <ActionStateBadge state={row.health} /> },
  { key: 'current', label: 'Current stage', render: (row) => currentStageLabel(row) },
  {
    key: 'assignments',
    label: 'Assignments',
    align: 'right',
    mono: true,
    render: (row) => row.assignments.length,
  },
  {
    key: 'persistent',
    label: 'Persistent actions',
    align: 'right',
    mono: true,
    render: (row) => row.persistentActionIds.length,
  },
];

export function CyclesPage({ currentBinding, current }: CyclesPageProps) {
  const model = resolveCyclesSurface(current, currentBinding);
  if (!model) {
    return (
      <div className="op-workspace op-cycle-list pc-operate" data-route-kind="operate.cycles">
        <StatePanel
          state="incompatible"
          eyebrow="Cycle projection"
          title="Cycles cannot be trusted"
          description="The owner-issued display did not pass exact binding and integrity verification."
        />
      </div>
    );
  }

  const { surface, presentation } = model;
  const cycles = surface.data.cycles;
  const rows: readonly CycleRow[] = cycles.map((cycle, index) => ({
    ...cycle,
    id: `${cycle.cycleId}:${index}`,
  }));
  const stateOrder: string[] = [];
  const tally = new Map<string, number>();
  for (const cycle of cycles) {
    if (!tally.has(cycle.state)) stateOrder.push(cycle.state);
    tally.set(cycle.state, (tally.get(cycle.state) ?? 0) + 1);
  }

  return (
    <div
      className="op-workspace op-cycle-list pc-operate"
      data-route-kind="operate.cycles"
      data-cycle-presentation={presentation}
    >
      {presentation !== 'ready' ? (
        <p className="pc-operate__notice" role="status">
          This is a {presentation} projection. Durable Cycle identity remains visible; no action is
          inferred.
        </p>
      ) : null}
      {stateOrder.length > 0 ? (
        <ul className="pc-metrics" aria-label="Cycle states">
          {stateOrder.map((state) => (
            <MetricStat
              key={state}
              label={humanLabel(state)}
              value={tally.get(state) ?? 0}
              tone={ATTENTION_CYCLE_STATES.has(state) ? 'attention' : 'default'}
            />
          ))}
        </ul>
      ) : null}
      <SectionHeader
        headingLevel={1}
        eyebrow="planr-operate · cycles"
        title={cycleVocabulary(surface.domainId)}
        count={`${cycles.length} ${cycles.length === 1 ? 'cycle' : 'cycles'}`}
        description="Follow the work from observation through learning."
      />
      {cycles.length === 0 ? (
        <StatePanel
          state="unavailable"
          eyebrow="Cycles"
          title="No cycles yet"
          description="There is no active cycle in this workspace yet."
        />
      ) : (
        <DataTable columns={CYCLE_COLUMNS} rows={rows} caption="Operating cycles" />
      )}
    </div>
  );
}
