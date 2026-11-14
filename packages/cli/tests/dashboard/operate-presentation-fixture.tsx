import type { ReactNode } from 'react';
import { DashboardProviders } from '../../../../apps/dashboard/src/app/providers.js';
import { parseDashboardRoute } from '../../../../apps/dashboard/src/app/router.js';
import { CycleDetailPage } from '../../../../apps/dashboard/src/features/operate/cycles/CycleDetailPage.js';
import { createOperateCycleDisplayWorkspaceValidator } from '../../../../apps/dashboard/src/features/operate/cycles/cycle-model.js';
import { createOperateEvidenceDisplayValidator } from '../../../../apps/dashboard/src/features/operate/evidence/evidence-model.js';
import { createOperateHistoryDisplayValidator } from '../../../../apps/dashboard/src/features/operate/history/history-model.js';
import { createOperateOutcomeDisplayValidator } from '../../../../apps/dashboard/src/features/operate/outcomes/outcome-model.js';
import { operateRouteRegistry } from '../../../../apps/dashboard/src/features/shell/routes/operate/index.js';
import {
  dashboardProductStatePolicy,
  parseDashboardProductState,
} from '../../../../apps/dashboard/src/lib/api/product-state.js';
import { createDashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  createDashboardApiFixture,
  DASHBOARD_FIXTURE_CYCLE_ID,
} from '../e2e/fixtures/dashboard-api-fixture.mjs';

const registry = operateRouteRegistry;
const fixture = createDashboardApiFixture();
const displays = {
  'operate.today': fixture.today,
  'operate.cycles': fixture.cycles,
  'operate.cycle': fixture.cycle,
  'operate.review': fixture.review,
  'operate.inbox': fixture.inbox,
  'operate.inbox-item': fixture.inboxItem,
  'operate.actions': fixture.actions,
  'operate.action': fixture.action,
  'operate.action-planning': fixture.action,
  'operate.evidence': fixture.evidence,
  'operate.evidence-item': fixture.evidenceItem,
  'operate.outcomes': fixture.outcomes,
  'operate.outcome': fixture.outcome,
  'operate.history': fixture.history,
  'operate.recovery': fixture.recovery,
};

type OperateKind = keyof typeof displays;

export function operatePresentationFixture(hash: string) {
  const route = parseDashboardRoute(hash);
  if (route.product !== 'operate' || !(route.kind in displays))
    throw new Error(`Expected an Operate fixture route: ${hash}`);
  const kind = route.kind as OperateKind;
  const display = displays[kind];
  const payload = display.payload;
  const binding = createDashboardQueryIdentity({
    ...fixture.bootstrap.queryRoots.operate,
    productArea: 'operate',
    route: hash,
    subjectId: route.subjectId,
    cycleId: DASHBOARD_FIXTURE_CYCLE_ID,
    eventHead: payload.sourceEventHead ?? payload.eventHead,
    viewHash: payload.sourceViewHash ?? payload.viewHash,
  });
  const validators = {
    'operate.today': registry.today.createValidator,
    'operate.cycles': registry.cycles.createListValidator,
    'operate.cycle': createOperateCycleDisplayWorkspaceValidator,
    'operate.review': registry.review.createValidator,
    'operate.inbox': registry.inboxRecovery.createInboxValidator,
    'operate.inbox-item': registry.inboxRecovery.createInboxValidator,
    'operate.actions': registry.actions.createListValidator,
    'operate.action': registry.actions.createDetailValidator,
    'operate.action-planning': registry.actions.createDetailValidator,
    'operate.evidence': createOperateEvidenceDisplayValidator,
    'operate.evidence-item': createOperateEvidenceDisplayValidator,
    'operate.outcomes': createOperateOutcomeDisplayValidator,
    'operate.outcome': createOperateOutcomeDisplayValidator,
    'operate.history': createOperateHistoryDisplayValidator,
    'operate.recovery': registry.inboxRecovery.createRecoveryValidator,
  };
  const validationBinding =
    kind === 'operate.action-planning'
      ? createDashboardQueryIdentity({ ...binding, route: hash.replace(/\/planning$/u, '') })
      : binding;
  const validate = validators[kind](validationBinding);
  const stateKind = payload.status;
  const current = parseDashboardProductState(
    {
      kind: stateKind,
      binding,
      data: JSON.parse(JSON.stringify(display)),
      reasonCodes: stateKind === 'ready' ? [] : ['FIXTURE_PRESENTATION'],
      error: null,
      mutationEnabled: kind === 'operate.action-planning' ? false : payload.mutationEnabled,
      policy: dashboardProductStatePolicy(stateKind),
    },
    { currentBinding: binding, validateData: (value): value is unknown => validate(value) },
  );
  const props = { currentBinding: binding, current };
  let page: ReactNode;
  switch (kind) {
    case 'operate.today':
      page = <registry.today.Page currentBinding={binding} sources={{ current }} />;
      break;
    case 'operate.cycle':
      page = (
        <CycleDetailPage currentBinding={binding} sources={{ current: { workspace: current } }} />
      );
      break;
    case 'operate.cycles':
      page = <registry.cycles.ListPage {...props} />;
      break;
    case 'operate.review':
      page = <registry.review.Page {...props} />;
      break;
    case 'operate.inbox':
    case 'operate.inbox-item':
      page = <registry.inboxRecovery.InboxPage {...props} />;
      break;
    case 'operate.actions':
      page = <registry.actions.ListPage {...props} />;
      break;
    case 'operate.action':
      page = <registry.actions.DetailPage {...props} />;
      break;
    case 'operate.action-planning':
      page = <registry.actions.PlanningHandoffPage {...props} />;
      break;
    case 'operate.evidence':
    case 'operate.evidence-item':
      page = <registry.audit.EvidencePage {...props} />;
      break;
    case 'operate.outcomes':
    case 'operate.outcome':
      page = <registry.audit.OutcomesPage {...props} />;
      break;
    case 'operate.history':
      page = <registry.audit.HistoryPage {...props} />;
      break;
    case 'operate.recovery':
      page = <registry.inboxRecovery.RecoveryPage {...props} />;
      break;
  }
  return (
    <DashboardProviders
      buildId="operate-presentation"
      initialHash={hash}
      binding={binding}
      projection={current}
      bootPhase="compatible"
    >
      <main>{page}</main>
    </DashboardProviders>
  );
}
