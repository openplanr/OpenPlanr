import type { DashboardQueryIdentity } from '../../../lib/binding/query-identity.js';
import { OperateSetup } from '../OperateSetup.js';
import { DecisionFocus, type OperateTodayContinuation } from './DecisionFocus.js';
import { TodayLayout } from './TodayParts.js';
import { CouldNotRead, NothingWaiting } from './TodayStates.js';
import { type OperateTodayModelSources, resolveOperateTodayModel } from './today-model.js';
import { todayViewFromSurface } from './today-view.js';
import '../operate.css';

export type TodayPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  sources: OperateTodayModelSources;
  onContinuation?: (continuation: OperateTodayContinuation) => void | Promise<void>;
}>;

export function TodayPage({ currentBinding, sources, onContinuation }: TodayPageProps) {
  const model = resolveOperateTodayModel(sources, currentBinding);

  if (!model) {
    return (
      <div className="op-workspace pc-operate" data-route-kind="operate.today">
        <CouldNotRead
          title="Today could not be read"
          reason="What came back did not match this project's current Operate session, so none of it is shown."
        />
      </div>
    );
  }

  if (model.kind !== 'surface') {
    return (
      <div className="op-workspace pc-operate" data-route-kind="operate.today">
        {model.kind === 'first-use' ? (
          <OperateSetup />
        ) : (
          <NothingWaiting summary="There is no active work in this workspace." />
        )}
      </div>
    );
  }

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
