import { sha256Jcs } from 'planr-pipeline/dashboard/verified-json';
import type {
  PlanningBinding,
  PlanningGraphEnvelope,
  PlanningLiveEvent,
} from '../../../../../apps/dashboard/src/features/planning/planning-api.js';
import type {
  PlanningArtifactStatus,
  PlanningArtifactType,
  PlanningModelEdge,
  PlanningModelGraph,
  PlanningModelNode,
} from '../../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  ARTBOARD_FIXTURE_CLOCK,
  artboardManifestData,
  buildArtboardGraph,
} from './premium-artboard-fixture.js';

export { ARTBOARD_FIXTURE_CLOCK };

export const FIXTURE_CLOCK = '2026-10-19T12:00:00.000Z';
export const FIXTURE_SEED = 'premium-dashboard-v1';
export const FIXTURE_VERSION = 1;
export type FixtureDataset = 'representative' | 'artboard' | 'scaling';

const TYPES: readonly PlanningArtifactType[] = [
  'epic',
  'feature',
  'story',
  'task',
  'spec',
  'backlog',
  'quick',
  'sprint',
  'adr',
];
const PREFIXES = ['EPIC', 'FEAT', 'US', 'T', 'SPEC', 'BL', 'QT', 'SPRINT', 'ADR'];
const STATUSES: readonly PlanningArtifactStatus[] = [
  'outstanding',
  'in-progress',
  'blocked',
  'done',
  'addressed',
];
const ARTBOARDS = [
  'Main',
  'Tokens',
  'Components',
  'IA',
  'Journeys',
  'Home',
  'List',
  'Detail',
  'Graph',
  'Board',
  'Sprints',
  'Activity',
  'Operate',
  'Palette',
  'States',
  'Mobile',
];

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function fixtureHash(value: unknown): string {
  return sha256Jcs(value as never);
}

function localId(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(3, '0')}`;
}

function generatedNodes(count: number, seed: string): PlanningModelNode[] {
  return Array.from({ length: count }, (_, index) => {
    const typeIndex = index % TYPES.length;
    const id = localId(PREFIXES[typeIndex], Math.floor(index / TYPES.length) + 1);
    const scopedId = typeIndex === 3 ? `specs/fixture-${index % 2}/${id}` : id;
    const dateCase = index % 8;
    const frontmatter: Record<string, unknown> = {
      id,
      fixtureSeed: seed,
      priority: `P${index % 4}`,
      status: STATUSES[index % STATUSES.length],
      evidence: {
        state: ['available', 'missing', 'inaccessible', 'partial', 'unavailable'][index % 5],
      },
    };
    if (dateCase !== 0) frontmatter.created = '2026-10-01';
    if (dateCase === 1) frontmatter.updated = 'invalid-date';
    else if (dateCase === 2) frontmatter.updated = '2026-09-01';
    else if (dateCase === 3) frontmatter.updated = '2026-12-01';
    else if (dateCase > 3)
      frontmatter.updated = `2026-10-${String(10 + (index % 9)).padStart(2, '0')}`;
    if (typeIndex === 7) {
      Object.assign(frontmatter, {
        name: `Fixture sprint ${Math.floor(index / 9) + 1}`,
        status: index % 2 === 0 ? 'closed' : 'active',
        startDate: '2026-10-01',
        endDate: '2026-10-15',
        ...(index % 2 === 0 ? { closedAt: '2026-10-16' } : {}),
        taskIds: [localId('QT', Math.floor(index / 9) + 1)],
      });
    }
    if (index === 0) frontmatter.dependsOn = ['MISSING-001'];
    return {
      id: scopedId,
      type: TYPES[typeIndex],
      title: `Fixture ${TYPES[typeIndex]} ${index + 1}`,
      status: STATUSES[index % 5],
      frontmatter,
    };
  });
}

export function buildPremiumDashboardFixture(
  dataset: FixtureDataset,
  options: Readonly<{ seed?: string; clock?: string }> = {},
) {
  const seed = options.seed ?? FIXTURE_SEED;
  const clock = options.clock ?? (dataset === 'artboard' ? ARTBOARD_FIXTURE_CLOCK : FIXTURE_CLOCK);
  if (!/^[a-zA-Z0-9._-]{1,80}$/u.test(seed)) throw new TypeError('Invalid fixture seed.');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(clock) ||
    !Number.isFinite(Date.parse(clock)) ||
    new Date(clock).toISOString() !== clock
  )
    throw new TypeError('Fixture clock must be a canonical UTC instant.');
  if (!['representative', 'artboard', 'scaling'].includes(dataset))
    throw new TypeError('Unknown fixture dataset.');
  let graph: PlanningModelGraph;
  if (dataset === 'artboard') graph = buildArtboardGraph(seed);
  else {
    const nodes = generatedNodes(dataset === 'scaling' ? 5_000 : 708, seed);
    const edges: PlanningModelEdge[] = [];
    const containmentCount = dataset === 'scaling' ? 4_999 : 300;
    const dependencyCount = dataset === 'scaling' ? 3_500 : 177;
    for (let index = 1; index <= containmentCount; index += 1)
      edges.push({
        from: nodes[Math.floor((index - 1) / 4)].id,
        to: nodes[index].id,
        kind: 'contains',
      });
    for (let index = 0; index < dependencyCount; index += 1)
      edges.push({
        from: nodes[index].id,
        to: nodes[index === 0 ? 1 : index === 1 ? 0 : index + 1].id,
        kind: 'depends_on',
      });
    graph = { nodes, edges };
  }
  const baseManifest = {
    version: FIXTURE_VERSION,
    seed,
    clock,
    dataset,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    graphHash: fixtureHash(graph),
    selectedId: graph.nodes.find((node) => node.type === 'task')?.id ?? graph.nodes[0].id,
    sourceMapping: ARTBOARDS.map((name) => ({
      source: `.planr/design/dashboard-redesign/project/${name}.dc.html`,
      coverage:
        dataset === 'artboard' && ['Sprints', 'Journeys'].includes(name)
          ? 'review-corrected examples'
          : 'synthetic coverage',
    })),
    artboard: {
      sprintId: localId('SPRINT', 1),
      done: 78,
      total: 82,
      carryOver: [
        localId('QT', 6),
        localId('BL', 7),
        localId('QT', 5),
        `specs/handoff/${localId('T', 55)}`,
      ],
      layout: { desktop: { width: 1440, height: 1000 }, mobile: { width: 390, height: 844 } },
      unavailable: [
        'approved artboard source bytes',
        'unprovided example titles and layout geometry',
        'durable activity history',
        'commit and PR evidence',
      ],
      authoredDates: 'Synthetic fixed dates; no historical completion claim.',
    },
  };
  const manifest =
    dataset === 'artboard' ? { ...baseManifest, ...artboardManifestData(graph) } : baseManifest;
  return freeze({ graph, manifest, manifestHash: fixtureHash(manifest) });
}

export function buildAmbiguousDashboardFixture() {
  const { graph } = buildPremiumDashboardFixture('artboard');
  const original = graph.nodes.find(
    (node) => node.id === `${localId('SPEC', 15)}/${localId('T', 55)}`,
  );
  if (!original) throw new Error('Missing scoped carry-over fixture.');
  return freeze({
    nodes: [
      ...graph.nodes.map((node) =>
        node.type === 'sprint'
          ? {
              ...node,
              frontmatter: {
                ...node.frontmatter,
                taskIds: (node.frontmatter.taskIds as string[]).map((id) =>
                  id === original.id ? String(original.frontmatter.id) : id,
                ),
              },
            }
          : node,
      ),
      { ...original, id: `specs/other/${original.frontmatter.id}` },
    ],
    edges: graph.edges,
  });
}

export function fixtureSnapshot(
  graph: PlanningModelGraph,
  binding: PlanningBinding,
): PlanningGraphEnvelope {
  const agile = graph.nodes.some((node) => node.type === 'epic' || node.type === 'feature');
  const spec = graph.nodes.some((node) => node.type === 'spec');
  return freeze({
    kind: 'planning-graph-snapshot',
    schemaVersion: '1.0.0',
    binding,
    cursor: { eventHead: { sequence: 0, hash: null }, viewHash: fixtureHash(graph) },
    mode: agile && spec ? 'mixed' : agile ? 'agile' : spec ? 'spec' : 'empty',
    graph,
  });
}

export function fixturePatch(snapshot: PlanningGraphEnvelope, selectedId: string) {
  const original = snapshot.graph.nodes.find((node) => node.id === selectedId);
  if (!original) throw new TypeError('Patch target is absent.');
  const sequence = snapshot.cursor.eventHead.sequence + 1;
  const updated = { ...original, title: `Fixture patch ${sequence}` };
  const patch = { updated: [updated], added: [], removed: [], edges: { added: [], removed: [] } };
  const graph = {
    ...snapshot.graph,
    nodes: snapshot.graph.nodes.map((node) => (node.id === selectedId ? updated : node)),
  };
  const viewHash = fixtureHash(graph);
  const from = snapshot.cursor;
  const to = {
    viewHash,
    eventHead: {
      sequence,
      hash: fixtureHash({
        kind: 'planning-live-head',
        previous: from.eventHead,
        sequence,
        patchHash: fixtureHash(patch),
        viewHash,
      }),
    },
  };
  const patchHash = fixtureHash({ from, to, patch });
  const event: PlanningLiveEvent = {
    kind: 'planning-live-event',
    schemaVersion: '1.0.0',
    binding: snapshot.binding,
    event: 'patch',
    cursor: to,
    payload: {
      patchId: `ppatch_${sequence}_${patchHash.slice(7, 23)}`,
      patchHash,
      from,
      to,
      patch,
    },
  };
  return freeze({ snapshot: { ...snapshot, graph, cursor: to }, event });
}
