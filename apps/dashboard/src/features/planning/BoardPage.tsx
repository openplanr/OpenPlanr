import type { DashboardProductState } from '../../lib/api/product-state.js';
import type { DashboardQueryIdentity } from '../../lib/binding/query-identity.js';
import { usePlanningView } from '../../lib/routing/planning-presentation.js';
import { BoardWorkspace } from './BoardWorkspace.js';
import { PlanningRefusal, resolvePlanningWorkspace } from './planning-workspace.js';
import './planning.css';
import './board.css';

export type BoardPageProps = Readonly<{
  currentBinding: DashboardQueryIdentity;
  current: DashboardProductState<unknown>;
}>;

export function BoardPage({ currentBinding, current }: BoardPageProps) {
  const token = usePlanningView();
  const presentation = token?.route === 'board' ? token : null;
  const model = resolvePlanningWorkspace(current, currentBinding);
  if (!model)
    return <PlanningRefusal routeKind="planning.board" title="Planning cannot be trusted" />;
  const { actorId, projectId, scopeId, domainId, domainVersion, generation } = model.binding;
  return (
    <BoardWorkspace
      key={JSON.stringify([actorId, projectId, scopeId, domainId, domainVersion, generation])}
      model={model}
      presentation={presentation}
    />
  );
}
