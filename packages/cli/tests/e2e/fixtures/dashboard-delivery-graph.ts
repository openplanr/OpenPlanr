import type { PlanningGraph } from '../../../../../apps/dashboard/src/features/planning/planning-api.js';

export const deliveryPlanningGraph: PlanningGraph = {
  nodes: [
    {
      id: 'EPIC-009',
      type: 'epic',
      title: 'Reliable registration operations',
      status: 'in-progress',
      frontmatter: { id: 'EPIC-009', updated: '2026-09-08' },
    },
    {
      id: 'QT-070',
      type: 'quick',
      title: 'Configure the dedicated CRM flow',
      status: 'done',
      frontmatter: { id: 'QT-070', updated: '2026-09-03' },
    },
    {
      id: 'QT-071',
      type: 'quick',
      title: 'Make failed CRM registrations visible and replayable',
      status: 'in-progress',
      frontmatter: {
        id: 'QT-071',
        dependsOn: ['QT-070'],
        updated: '2026-09-08',
        githubIssue: 162,
      },
    },
    {
      id: 'T-072',
      type: 'task',
      title: 'Add structured logs and correlation IDs',
      status: 'outstanding',
      frontmatter: { id: 'T-072', dependsOn: ['QT-071'], updated: '2026-09-09' },
    },
    {
      id: 'T-073',
      type: 'task',
      title: 'Verify alerting and replay outcomes',
      status: 'blocked',
      frontmatter: { id: 'T-073', dependsOn: ['T-072'], updated: '2026-09-10' },
    },
    {
      id: 'SPRINT-009',
      type: 'sprint',
      title: 'SPRINT-009',
      status: 'outstanding',
      frontmatter: {
        id: 'SPRINT-009',
        name: 'CRM recovery and observability',
        status: 'active',
        startDate: '2026-09-08',
        endDate: '2026-09-22',
        goal: 'Recover failed registrations and prove the path is observable.',
        taskIds: ['QT-071', 'T-072', 'T-073'],
      },
    },
    ...Array.from({ length: 32 }, (_, index) => ({
      id: `QT-${String(index + 100).padStart(3, '0')}`,
      type: 'quick',
      title: `Completed maintenance item ${index + 1}`,
      status: 'done',
      frontmatter: {
        id: `QT-${String(index + 100).padStart(3, '0')}`,
        updated: '2026-09-01',
      },
    })),
  ],
  edges: [
    { from: 'QT-071', to: 'QT-070', kind: 'depends_on' },
    { from: 'T-072', to: 'QT-071', kind: 'depends_on' },
    { from: 'T-073', to: 'T-072', kind: 'depends_on' },
  ],
};
