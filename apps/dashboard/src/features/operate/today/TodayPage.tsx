import { SectionHeader, StatePanel } from '../../../design-system/components/index.js';
import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { OperateSetup } from '../OperateSetup.js';
import { DecisionFocus, type OperateTodayContinuation } from './DecisionFocus.js';
import { TodayLayout } from './TodayParts.js';
import {
  type OperateTodayModelSources,
  type OperateTodaySurfaceModel,
  resolveOperateTodayModel,
} from './today-model.js';
import { todayViewFromSurface } from './today-view.js';
import '../operate.css';

export type TodayPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  sources: OperateTodayModelSources;
  onContinuation?: (continuation: OperateTodayContinuation) => void | Promise<void>;
}>;

function TodayContext({
  model,
}: {
  model: Exclude<ReturnType<typeof resolveOperateTodayModel>, OperateTodaySurfaceModel | null>;
}) {
  const firstUse = model.kind === 'first-use';
  return (
    <div className="op-workspace op-today pc-operate" data-route-kind="operate.today">
      {!firstUse ? (
        <SectionHeader
          headingLevel={1}
          eyebrow={`planr-operate · today · ${model.vocabulary.context}`}
          title={model.vocabulary.title}
          description="The current operating context for this project."
        />
      ) : null}
      {firstUse ? (
        <OperateSetup />
      ) : (
        <StatePanel
          state="empty"
          eyebrow="Exact empty state"
          title="Nothing active here yet"
          description="There is no active work in this workspace right now."
        />
      )}
      <p className="op-today__context-note">
        No governed next step is available until work is returned for this workspace.
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
      className="op-workspace pc-operate"
      data-route-kind="operate.today"
      data-today-presentation={model.presentation}
      data-today-source={model.source}
    >
      <TodayLayout
        view={todayViewFromSurface(model)}
        places
        inboxCount={model.inbox.length}
        next={<DecisionFocus model={model} onContinuation={onContinuation} />}
        notices={
          <>
            {model.source === 'durable-resume' ? (
              <p className="pc-operate__notice" data-tone="verified" role="status">
                Your active work has been restored.
              </p>
            ) : null}
            {model.presentation !== 'ready' ? (
              <p className="pc-operate__notice" role="status">
                This is a {model.presentation} projection. Current access-safe truth remains
                visible; mutation stays unavailable.
              </p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
