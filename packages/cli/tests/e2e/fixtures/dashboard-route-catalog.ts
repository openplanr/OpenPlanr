import type { DashboardRouteKind } from '../../../../../apps/dashboard/src/app/router.js';

export const DASHBOARD_FIXTURE_SPEC_ID = 'SPEC-020';
export const DASHBOARD_FIXTURE_CYCLE_ID = 'cyc_appointment_reminders';
export const DASHBOARD_FIXTURE_REVIEW_ID = 'rev_appointment_reminders';
export const DASHBOARD_FIXTURE_INBOX_ITEM_ID = 'verification:asg_reminder_delivery_0001';
export const DASHBOARD_FIXTURE_ACTION_ID = 'act_reminder_delivery_0001';
export const DASHBOARD_FIXTURE_EVIDENCE_ID = 'evref_reminder_delivery_0001';
export const DASHBOARD_FIXTURE_OUTCOME_ID = 'out_reminder_delivery_0001';

export type DashboardRouteFixture = Readonly<{
  kind: DashboardRouteKind;
  hash: string;
  readyText: string;
  composition: 'shell' | 'diagnostics';
}>;

const ROUTE_FIXTURES = [
  {
    kind: 'planning.overview',
    hash: '#/overview',
    readyText: 'Improve appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'planning.graph',
    hash: '#/graph',
    readyText: 'No depends_on edges in this plan',
    composition: 'shell',
  },
  {
    kind: 'planning.board',
    hash: '#/board',
    readyText: 'Improve appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'planning.list',
    hash: '#/list',
    readyText: 'Improve appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'planning.sprints',
    hash: '#/sprints',
    readyText: 'No sprints yet',
    composition: 'shell',
  },
  {
    kind: 'planning.activity',
    hash: '#/activity',
    readyText: 'No activity returned',
    composition: 'shell',
  },
  {
    kind: 'planning.search',
    hash: '#/search',
    readyText: 'Improve appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'planning.console',
    hash: '#/console',
    readyText: 'Console',
    composition: 'shell',
  },
  {
    kind: 'planning.detail',
    hash: `#/detail/${DASHBOARD_FIXTURE_SPEC_ID}`,
    readyText: 'Improve appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'planning.spec',
    hash: `#/plan/specs/${DASHBOARD_FIXTURE_SPEC_ID}`,
    readyText: 'Improve appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'system.diagnostics',
    hash: '#/diagnostics',
    readyText: 'Dashboard compatibility is certified',
    composition: 'diagnostics',
  },
  {
    kind: 'operate.today',
    hash: '#/operate/today',
    readyText: 'Confirm appointment reminders are arriving',
    composition: 'shell',
  },
  {
    kind: 'operate.cycles',
    hash: '#/operate/cycles',
    readyText: 'Confirm appointment reminders are arriving',
    composition: 'shell',
  },
  {
    kind: 'operate.cycle',
    hash: `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}`,
    readyText: 'Confirm appointment reminders are arriving',
    composition: 'shell',
  },
  {
    kind: 'operate.review',
    hash: `#/operate/cycles/${DASHBOARD_FIXTURE_CYCLE_ID}/reviews/${DASHBOARD_FIXTURE_REVIEW_ID}`,
    readyText: 'Review',
    composition: 'shell',
  },
  {
    kind: 'operate.inbox',
    hash: '#/operate/inbox',
    readyText: 'Review tomorrow’s reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'operate.inbox-item',
    hash: `#/operate/inbox/${encodeURIComponent(DASHBOARD_FIXTURE_INBOX_ITEM_ID)}`,
    readyText: 'Review tomorrow’s reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'operate.actions',
    hash: '#/operate/actions',
    readyText: 'Restore appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'operate.action',
    hash: `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}`,
    readyText: 'Restore appointment reminder delivery',
    composition: 'shell',
  },
  {
    kind: 'operate.action-planning',
    hash: `#/operate/actions/${DASHBOARD_FIXTURE_ACTION_ID}/planning`,
    readyText: 'This Action does not enter Planning',
    composition: 'shell',
  },
  {
    kind: 'operate.evidence',
    hash: '#/operate/evidence',
    readyText: DASHBOARD_FIXTURE_EVIDENCE_ID,
    composition: 'shell',
  },
  {
    kind: 'operate.evidence-item',
    hash: `#/operate/evidence/${DASHBOARD_FIXTURE_EVIDENCE_ID}`,
    readyText: DASHBOARD_FIXTURE_EVIDENCE_ID,
    composition: 'shell',
  },
  {
    kind: 'operate.outcomes',
    hash: '#/operate/outcomes',
    readyText: DASHBOARD_FIXTURE_OUTCOME_ID,
    composition: 'shell',
  },
  {
    kind: 'operate.outcome',
    hash: `#/operate/outcomes/${DASHBOARD_FIXTURE_OUTCOME_ID}`,
    readyText: DASHBOARD_FIXTURE_OUTCOME_ID,
    composition: 'shell',
  },
  {
    kind: 'operate.history',
    hash: '#/operate/history',
    readyText: 'The team restored a safe setting and will review delivery data tomorrow.',
    composition: 'shell',
  },
  {
    kind: 'operate.recovery',
    hash: '#/operate/recovery',
    readyText: 'Recovery is blocked',
    composition: 'shell',
  },
] as const satisfies readonly DashboardRouteFixture[];

export const DASHBOARD_ROUTE_FIXTURES: readonly DashboardRouteFixture[] = Object.freeze(
  ROUTE_FIXTURES.map((fixture) => Object.freeze({ ...fixture })),
);

const ROUTE_FIXTURE_BY_HASH: ReadonlyMap<string, DashboardRouteFixture> = new Map(
  DASHBOARD_ROUTE_FIXTURES.map((fixture) => [fixture.hash, fixture]),
);

export function dashboardRouteFixture(hash: string): DashboardRouteFixture | undefined {
  return ROUTE_FIXTURE_BY_HASH.get(hash);
}
