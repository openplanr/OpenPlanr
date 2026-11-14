import type { PlanningGraph } from '../../../../../apps/dashboard/src/features/planning/planning-api.js';

type Node = PlanningGraph['nodes'][number];
type Edge = PlanningGraph['edges'][number];

/** The clock the sprint scenario is drawn against: day 6 of SPRINT-004. */
export const SPRINT_SCENARIO_NOW = '2026-10-23T12:00:00Z';

function item(
  id: string,
  title: string,
  status: Node['status'],
  extra: Readonly<Record<string, unknown>> = {},
): Node {
  const type = id.startsWith('US-') ? 'story' : id.startsWith('BL-') ? 'backlog' : 'task';
  return { id, type, title, status, frontmatter: { id, updated: '2026-10-15', ...extra } };
}

const active = [
  item('T-158', 'Canvas engine: shared pan, zoom and selection model', 'in-progress', {
    priority: 'high',
    updated: '2026-10-21',
  }),
  item('T-156', 'Canvas engine: gesture layer over SVG diagrams', 'in-progress', {
    priority: 'high',
    updated: '2026-10-22',
  }),
  item('US-101', 'Board and List build from the approved canvases', 'in-progress', {
    priority: 'medium',
    updated: '2026-10-20',
  }),
  item('T-160', 'Canvas engine: hit testing for dense graphs', 'in-progress', {
    priority: 'medium',
    updated: '2026-10-23',
  }),
  item('T-157', 'Canvas engine: keyboard camera and focus order', 'blocked', {
    priority: 'high',
    dependsOn: ['T-156'],
  }),
  item('T-159', 'Canvas engine: reduced-motion and trace budgets', 'outstanding', {
    priority: 'medium',
  }),
  item('BL-446', 'Run the dashboard node browser tests in CI', 'outstanding', { priority: 'high' }),
  item('T-128', 'Re-approve canvas-affected screenshots', 'outstanding', { priority: 'medium' }),
  item('T-161', 'Canvas engine: export the view as SVG', 'outstanding', { priority: 'low' }),
  item('T-162', 'Canvas engine: minimap for large graphs', 'outstanding', { priority: 'low' }),
  item('T-163', 'Canvas engine: document the camera API', 'outstanding'),
  ...Array.from({ length: 7 }, (_, index) =>
    item(`T-${170 + index}`, `Redesign build step ${index + 1}`, 'done', { priority: 'medium' }),
  ),
];

const past = {
  'SPRINT-001': ['T-101', 'T-102', 'T-103', 'T-104'],
  'SPRINT-002': ['T-111', 'T-112', 'T-113', 'BL-120'],
  'SPRINT-003': ['T-121', 'T-122', 'T-123', 'T-159'],
} as const;

const pastItems = [
  ...['T-101', 'T-102', 'T-103', 'T-104', 'T-111', 'T-112', 'T-113', 'T-121', 'T-122', 'T-123'].map(
    (id) => item(id, `Completed ${id}`, 'done'),
  ),
  item('BL-120', 'Trace budget for the scaling fixture', 'outstanding'),
];

function sprint(
  id: string,
  name: string,
  frontmatter: Readonly<Record<string, unknown>>,
  status: Node['status'],
): Node {
  return { id, type: 'sprint', title: id, status, frontmatter: { id, name, ...frontmatter } };
}

/** Three closed sprints and an active one drawn after the Sprints canvas; `bare` drops goal and cut. */
export function sprintPlanningGraph(bare = false): PlanningGraph {
  const sprints = [
    sprint(
      'SPRINT-001',
      'Launch sprint 1: prepare launch, first readout',
      {
        status: 'closed',
        startDate: '2026-09-25',
        endDate: '2026-10-08',
        closedAt: '2026-10-08',
        releaseCut: '2026-10-08',
        taskIds: past['SPRINT-001'],
      },
      'done',
    ),
    sprint(
      'SPRINT-002',
      'Engineering hygiene: sprint gates, CI stability, shipping model',
      {
        status: 'closed',
        startDate: '2026-09-28',
        endDate: '2026-10-24',
        closedAt: '2026-10-24',
        releaseCut: '2026-10-24',
        taskIds: past['SPRINT-002'],
      },
      'done',
    ),
    sprint(
      'SPRINT-003',
      'Editor TypeScript UI rollout and data safety',
      {
        status: 'closed',
        startDate: '2026-09-27',
        endDate: '2026-10-25',
        closedAt: '2026-10-25',
        releaseCut: '2026-10-25',
        taskIds: past['SPRINT-003'],
      },
      'done',
    ),
    sprint(
      'SPRINT-004',
      'Dashboard redesign build and canvas engine',
      {
        status: 'active',
        startDate: '2026-10-18',
        endDate: '2026-10-31',
        capacityDays: 40,
        ...(bare
          ? {}
          : {
              goal: 'Ship the approved Home, List, Board and Detail canvases, and land the canvas engine behind them.',
              releaseCut: '2026-10-31',
            }),
        taskIds: active.map((node) => node.id),
      },
      'in-progress',
    ),
  ];
  const edges: Edge[] = [{ from: 'T-157', to: 'T-156', kind: 'depends_on' }];
  const epic: Node = {
    id: 'EPIC-004',
    type: 'epic',
    title: 'Dashboard redesign',
    status: 'in-progress',
    frontmatter: { id: 'EPIC-004', updated: '2026-10-18' },
  };
  return { nodes: [epic, ...sprints, ...active, ...pastItems], edges };
}
