import type {
  PlanningArtifactStatus,
  PlanningArtifactType,
  PlanningModelEdge,
  PlanningModelGraph,
  PlanningModelNode,
} from '../../../../../apps/dashboard/src/features/planning/planning-model.js';
import sourceRecords from './premium-artboard-records.json' with { type: 'json' };

export const ARTBOARD_FIXTURE_CLOCK = '2026-10-18T12:00:00.000Z';

export type ArtboardRecord = Readonly<{
  id: string;
  tag: string;
  attributes: Readonly<Record<string, string | null>>;
  content: readonly (string | { recordId: string })[];
}>;
export type ArtboardSource = Readonly<{
  source: string;
  sourceHash: string;
  title: string;
  preview: {
    $preview: { width: number; height: number };
    theme?: { default: string; options: readonly string[] };
  };
  styles: readonly string[];
  records: readonly ArtboardRecord[];
}>;
export const ARTBOARD_SOURCES = sourceRecords.artboards as unknown as Readonly<
  Record<string, ArtboardSource>
>;

export function artboardRecordText(source: ArtboardSource, record: ArtboardRecord): string {
  const byId = new Map(source.records.map((entry) => [entry.id, entry]));
  const text = (entry: ArtboardRecord): string =>
    entry.content
      .map((part) => {
        if (typeof part === 'string') return part;
        const child = byId.get(part.recordId);
        if (!child) throw new Error(`Missing artboard record ${part.recordId}.`);
        return text(child);
      })
      .join(' ');
  return text(record);
}

function id(prefix: string, ordinal: number): string {
  return `${prefix}-${String(ordinal).padStart(3, '0')}`;
}

export function canonicalArtboardId(value: string): string {
  const ordinal = Number(value.slice(2));
  if (!value.startsWith('T-')) return value;
  const spec =
    ordinal >= 31 && ordinal <= 40
      ? 13
      : ordinal >= 41 && ordinal <= 46
        ? 14
        : ordinal >= 47 && ordinal <= 67
          ? 15
          : ordinal >= 98 && ordinal <= 103
            ? 22
            : ordinal === 105 || ordinal === 106
              ? 25
              : ordinal >= 109 && ordinal <= 113
                ? 26
                : null;
  return spec === null ? value : `${id('SPEC', spec)}/${value}`;
}

const ARTIFACT_COUNTS: readonly [string, PlanningArtifactType, number][] = [
  ['SPEC', 'spec', 26],
  ['US', 'story', 97],
  ['T', 'task', 113],
  ['BL', 'backlog', 435],
  ['ADR', 'adr', 24],
  ['QT', 'quick', 9],
  ['SPRINT', 'sprint', 3],
  ['EPIC', 'epic', 1],
];

function sourceTitles(): Map<string, { title: string; recordId: string }> {
  const result = new Map<string, { title: string; recordId: string }>();
  for (const name of [
    'List',
    'Graph',
    'Home',
    'Board',
    'Detail',
    'Sprints',
    'Activity',
    'Components',
  ]) {
    const source = ARTBOARD_SOURCES[name];
    const parent = new Map<string, ArtboardRecord>();
    for (const record of source.records)
      for (const part of record.content)
        if (typeof part !== 'string') parent.set(part.recordId, record);
    for (const record of source.records) {
      if (!record.attributes.class?.split(' ').includes('tag')) continue;
      const local = artboardRecordText(source, record);
      if (!/^(?:SPEC|US|T|BL|ADR|QT|SPRINT|EPIC)-\d{3}$/u.test(local)) continue;
      let container = parent.get(record.id);
      while (
        container &&
        !['row', 'r', 'n', 'node', 'k'].some((value) =>
          container?.attributes.class?.split(' ').includes(value),
        ) &&
        container.tag !== 'tr'
      )
        container = parent.get(container.id);
      if (!container) continue;
      const children = source.records.filter((child) => parent.get(child.id)?.id === container.id);
      const titleRecord =
        children.find((child) =>
          ['t', 'tt'].some((value) => child.attributes.class?.split(' ').includes(value)),
        ) ??
        (container.tag === 'tr' ? children.filter((child) => child.tag === 'td')[1] : undefined);
      if (!titleRecord) continue;
      const title = artboardRecordText(source, titleRecord);
      const prior = result.get(local);
      if (!prior || title.length > prior.title.length)
        result.set(local, { title, recordId: titleRecord.id });
    }
  }
  return result;
}

function fillStatuses(
  nodes: PlanningModelNode[],
  type: 'backlog' | 'other',
  totals: Readonly<Partial<Record<PlanningArtifactStatus, number>>>,
  locked: Set<string>,
) {
  for (const [status, total] of Object.entries(totals)) {
    const candidates = nodes.filter((node) => (node.type === 'backlog') === (type === 'backlog'));
    let remaining =
      total - candidates.filter((node) => locked.has(node.id) && node.status === status).length;
    if (remaining < 0) throw new Error(`Artboard ${type} ${status} quota exceeded.`);
    for (const node of candidates) {
      if (remaining === 0) break;
      if (locked.has(node.id)) continue;
      const index = nodes.findIndex((entry) => entry.id === node.id);
      nodes[index] = { ...node, status: status as PlanningArtifactStatus };
      locked.add(node.id);
      remaining -= 1;
    }
    if (remaining !== 0) throw new Error(`Artboard ${type} ${status} quota is incomplete.`);
  }
}

export function buildArtboardGraph(seed: string): PlanningModelGraph {
  const titles = sourceTitles();
  const nodes: PlanningModelNode[] = ARTIFACT_COUNTS.flatMap(([prefix, type, count]) =>
    Array.from({ length: count }, (_, index) => {
      const local = id(prefix, index + 1);
      const example = titles.get(local);
      return {
        id: canonicalArtboardId(local),
        type,
        title: example?.title ?? local,
        status: 'outstanding' as const,
        frontmatter: {
          id: local,
          fixtureSeed: seed,
          ...(example ? { titleRecordId: example.recordId } : { fixtureRole: 'aggregate-support' }),
        },
      };
    }),
  );
  const locked = new Set<string>();
  const change = (
    local: string,
    fields: Partial<PlanningModelNode>,
    frontmatter: Readonly<Record<string, unknown>> = {},
  ) => {
    const index = nodes.findIndex((node) => node.id === canonicalArtboardId(local));
    if (index < 0) throw new Error(`Missing artboard artifact ${local}.`);
    nodes[index] = {
      ...nodes[index],
      ...fields,
      frontmatter: { ...nodes[index].frontmatter, ...frontmatter },
    };
    if (fields.status) locked.add(nodes[index].id);
  };
  const range = (prefix: string, first: number, last: number) =>
    Array.from({ length: last - first + 1 }, (_, index) => id(prefix, first + index));
  const outstanding = [
    'SPEC-025',
    'SPEC-026',
    ...range('US', 91, 92),
    ...range('US', 94, 97),
    ...range('T', 105, 113),
    ...range('T', 36, 40),
    ...range('T', 55, 67),
    'T-103',
    'QT-005',
    'QT-006',
    'BL-007',
    'BL-047',
    'BL-401',
    'BL-396',
    'BL-412',
    ...range('BL', 416, 426),
    ...range('BL', 433, 435),
  ];
  for (const local of outstanding) change(local, { status: 'outstanding' });
  for (const local of [
    ...range('US', 41, 44),
    ...range('T', 31, 35),
    ...range('T', 41, 45),
    ...range('T', 47, 54),
    'US-084',
    'US-085',
    'US-088',
    'US-089',
    ...range('T', 98, 102),
    'BL-411',
    'BL-397',
    ...range('SPRINT', 1, 3),
    ...range('QT', 1, 4),
    ...range('QT', 7, 9),
  ])
    change(local, { status: 'done' });
  for (const local of [
    'SPEC-013',
    'SPEC-014',
    'SPEC-015',
    'SPEC-022',
    'US-045',
    'US-086',
    'US-087',
    'T-046',
    'BL-022',
    'BL-051',
  ])
    change(local, { status: 'in-progress' });
  change('BL-004', { status: 'addressed' }, { status: 'superseded' });
  fillStatuses(
    nodes,
    'backlog',
    { done: 238, outstanding: 194, 'in-progress': 2, addressed: 1 },
    locked,
  );
  fillStatuses(nodes, 'other', { done: 179, outstanding: 80, 'in-progress': 14 }, locked);

  change('SPEC-014', { title: 'Design-to-Delivery Handoff Center' }, { priority: 'P0' });
  change(
    'SPEC-026',
    { title: 'Ship and Investigate offer to file out-of-scope findings' },
    { status: 'shaped', priority: 'P1', originId: 'BL-425' },
  );
  change(
    'SPEC-025',
    { title: 'Raise local design craft in the design skills' },
    { status: 'shaped', priority: 'P2' },
  );
  change(
    'SPEC-022',
    { title: 'Host connections for chat, trackers and source control' },
    { priority: 'P2' },
  );
  change('US-045', { title: 'Continue from approved design to Plan with durable lineage' });
  change('T-046', { title: 'Connect Plan Ship company sync and release proof' });
  change(
    'T-112',
    { title: 'Findings contract, consent and filing guidance in Ship and Investigate' },
    {
      status: 'pending',
      storyId: 'US-096',
      specId: 'SPEC-026',
      agent: 'backend-agent',
      type: 'Tech',
      size: 'M',
      reviewRisks: ['api-contract'],
    },
  );
  change('T-055', { title: 'T-055' }, { fixtureRole: 'title-not-provided' });

  const detail = ARTBOARD_SOURCES.Detail;
  const detailRecords = (className: string) =>
    detail.records
      .filter((record) => record.attributes.class?.split(' ').includes(className))
      .map((record) => artboardRecordText(detail, record));
  change(
    'T-112',
    {},
    {
      acceptanceCriteria: detailRecords('ac'),
      files: detailRecords('file'),
      file: '.planr/specs/SPEC-026-file-out-of-scope-findings/tasks/T-112-findings-guidance.md',
    },
  );
  const quiet = nodes
    .filter(
      (node) =>
        node.status === 'in-progress' &&
        !['US-086', 'US-087', 'BL-051'].includes(String(node.frontmatter.id)),
    )
    .slice(0, 13);
  if (quiet.length !== 13) throw new Error('Quiet artboard quota is incomplete.');
  for (const node of quiet)
    change(
      String(node.frontmatter.id),
      {},
      {
        artboardQuietExample: true,
        updated: ['SPEC-013', 'BL-022'].includes(String(node.frontmatter.id))
          ? '2026-09-13'
          : '2026-09-24',
      },
    );
  for (const local of ['US-086', 'US-087']) change(local, {}, { updated: '2026-10-09' });
  change('BL-051', {}, { updated: '2026-10-04' });
  const today = [
    'SPEC-026',
    ...range('US', 94, 97),
    ...range('T', 109, 113),
    'SPEC-025',
    ...range('US', 91, 92),
    'T-105',
    'T-106',
    ...range('BL', 433, 435),
  ];
  for (const local of today)
    change(
      local,
      {},
      {
        updated: '2026-10-18',
        ...(['SPEC-025', 'US-091', 'US-092', 'T-105', 'T-106'].includes(local)
          ? {}
          : { created: '2026-10-18' }),
      },
    );
  for (const local of range('BL', 416, 426).filter((local) => local !== 'BL-426'))
    change(local, {}, { created: '2026-10-17', updated: '2026-10-17' });
  for (const local of ['BL-411', 'BL-397']) change(local, {}, { updated: '2026-10-17' });
  change('BL-426', {}, { created: '2026-10-17' });
  change(
    'BL-412',
    {},
    { created: '2026-10-16', updated: '2026-10-16', labels: ['bug'], priority: 'high' },
  );
  change('BL-425', {}, { priority: 'high', labels: ['feature'] });
  change('BL-435', {}, { priority: 'medium', labels: ['ship', 'quality'] });
  change('BL-434', {}, { priority: 'low', labels: ['cli', 'config'] });
  change('BL-433', {}, { priority: 'low', labels: ['cli'] });
  change('BL-424', {}, { priority: 'medium', labels: ['doctor', 'cli'] });
  change('BL-426', {}, { priority: 'medium', labels: ['bug'] });
  change('BL-401', {}, { priority: 'high', updated: '2026-10-15' });
  change('BL-396', {}, { priority: 'high', updated: '2026-10-15' });
  change(
    'BL-047',
    {},
    { priority: 'high', dependsOn: ['partner programme'], blockedReason: 'partner programme' },
  );
  const high = ['BL-425', 'BL-412', 'BL-401', 'BL-396', 'BL-047'];
  high.push(
    ...nodes
      .filter(
        (node) =>
          node.type === 'backlog' &&
          node.status === 'outstanding' &&
          !high.includes(node.id) &&
          !node.frontmatter.priority,
      )
      .slice(0, 11)
      .map((node) => node.id),
  );
  for (const local of high) change(local, {}, { priority: 'high', artboardHighPriority: true });
  for (const [day, total] of [
    ['12', 3],
    ['13', 18],
    ['14', 27],
    ['15', 17],
    ['16', 15],
    ['17', 12],
    ['18', 18],
  ] as const) {
    const date = `2026-10-${day}`;
    const remaining = total - nodes.filter((node) => node.frontmatter.updated === date).length;
    for (const node of nodes.filter((node) => !node.frontmatter.updated).slice(0, remaining))
      change(String(node.frontmatter.id), {}, { updated: date });
  }
  const withoutDates = nodes.filter((node) => !node.frontmatter.updated);
  for (const node of withoutDates.slice(41))
    change(String(node.frontmatter.id), {}, { updated: '2026-09-09' });

  const edges: PlanningModelEdge[] = [];
  const edgeKeys = new Set<string>();
  const edge = (kind: PlanningModelEdge['kind'], from: string, to: string) => {
    from = canonicalArtboardId(from);
    to = canonicalArtboardId(to);
    const key = `${kind}:${from}:${to}`;
    if (edgeKeys.has(key)) return;
    edges.push({ kind, from, to });
    edgeKeys.add(key);
    if (kind === 'depends_on') {
      const node = nodes.find((node) => node.id === from);
      if (!node) throw new Error(`Missing dependency source ${from}.`);
      change(
        String(node.frontmatter.id),
        {},
        {
          dependsOn: [...((node.frontmatter.dependsOn as readonly string[] | undefined) ?? []), to],
        },
      );
    }
  };
  for (const local of range('US', 41, 45)) edge('contains', 'SPEC-014', local);
  for (const [story, tasks] of [
    [41, [41, 42]],
    [42, [43]],
    [43, [44]],
    [44, [45]],
    [45, [46]],
  ] as const)
    for (const task of tasks) edge('contains', id('US', story), id('T', task));
  for (const local of range('US', 94, 97)) edge('contains', 'SPEC-026', local);
  edge('contains', 'US-096', 'T-112');
  for (const local of ['T-109', 'T-110', 'T-111', 'T-113']) edge('contains', 'SPEC-026', local);
  for (const local of ['US-091', 'US-092', 'T-105', 'T-106']) edge('contains', 'SPEC-025', local);
  for (const local of [...range('US', 84, 89), ...range('T', 98, 103)])
    edge('contains', 'SPEC-022', local);
  for (const local of range('T', 31, 40)) edge('contains', 'SPEC-013', local);
  for (const local of range('T', 47, 67)) edge('contains', 'SPEC-015', local);
  edge('depends_on', 'T-046', 'T-045');
  for (const [from, targets] of [
    ['T-112', ['T-109', 'T-110']],
    ['T-113', ['T-111', 'T-112']],
    ['T-108', ['T-105', 'T-106']],
    ['T-040', range('T', 33, 39)],
  ] as const)
    for (const to of targets) edge('depends_on', from, to);
  const waiting = ['T-112', 'T-108', 'T-113', 'T-040', 'BL-047'];
  waiting.push(
    ...nodes
      .filter(
        (node) =>
          node.type === 'task' &&
          node.status === 'outstanding' &&
          !waiting.includes(String(node.frontmatter.id)) &&
          !['T-109', 'T-110', 'T-111', 'T-055', 'T-103'].includes(String(node.frontmatter.id)),
      )
      .slice(0, 11)
      .map((node) => String(node.frontmatter.id)),
  );
  for (const local of waiting) {
    change(local, {}, { artboardWaiting: true });
    if (!['T-112', 'T-108', 'T-113', 'T-040', 'BL-047'].includes(local))
      edge('depends_on', local, 'T-109');
  }
  const carryOver = ['QT-006', 'BL-007', 'QT-005', 'T-055'].map(canonicalArtboardId);
  const doneGroups = ['task', 'story', 'quick', 'backlog'].map((type) =>
    nodes.filter((node) => node.status === 'done' && node.type === type),
  );
  const done = Array.from(
    { length: Math.max(...doneGroups.map((group) => group.length)) },
    (_, index) => doneGroups.flatMap((group) => (group[index] ? [group[index]] : [])),
  ).flat();
  const members = [...carryOver, ...done.slice(0, 78).map((node) => node.id)];
  const sprintMembers = [
    members,
    done.slice(0, 45).map((node) => node.id),
    done.slice(45, 64).map((node) => node.id),
  ];
  for (let index = 0; index < 3; index += 1) {
    const sprint = id('SPRINT', index + 1);
    change(
      sprint,
      {
        title: ['Launch sprint 1', 'Engineering hygiene', 'Editor TypeScript, UI, data safety'][
          index
        ],
      },
      {
        status: 'closed',
        taskIds: sprintMembers[index],
        name: ['Launch sprint 1', 'Engineering hygiene', 'Editor TypeScript, UI, data safety'][
          index
        ],
        startDate: ['2026-09-25', '2026-09-28', '2026-09-27'][index],
        endDate: ['2026-10-08', '2026-10-24', '2026-10-25'][index],
        closedAt: ['2026-09-26', '2026-09-27', '2026-09-28'][index],
        plannedWindowSource: 'Sprints timeline geometry',
        closedAtSource: 'Sprints timeline marker geometry',
      },
    );
    for (const member of sprintMembers[index]) edge('contains', sprint, member);
  }
  for (const node of nodes) {
    if (edges.filter((entry) => entry.kind === 'contains').length === 328) break;
    if (
      node.id !== 'SPEC-001' &&
      !edges.some((entry) => entry.kind === 'contains' && entry.to === node.id)
    )
      edge('contains', 'SPEC-001', node.id);
  }
  for (let index = 0; edges.filter((entry) => entry.kind === 'depends_on').length < 149; index += 1)
    edge('depends_on', done[index % done.length].id, done[(index + 1) % done.length].id);
  return { nodes, edges };
}

export function artboardManifestData(graph: PlanningModelGraph) {
  const carryOver = ['QT-006', 'BL-007', 'QT-005', 'T-055'].map(canonicalArtboardId);
  const sourceMapping = Object.entries(ARTBOARD_SOURCES).map(([name, source]) => {
    const localIds = new Set(
      source.records.flatMap((record) =>
        record.content.flatMap((part) =>
          typeof part === 'string'
            ? (part.match(/\b(?:SPEC|US|T|BL|ADR|QT|SPRINT|EPIC)-\d{3}\b/gu) ?? [])
            : [],
        ),
      ),
    );
    return {
      source: source.source,
      sourceHash: source.sourceHash,
      coverage: 'exact source records and layout',
      recordIds: source.records.map((record) => record.id),
      nodeIds: graph.nodes
        .filter((node) => localIds.has(String(node.frontmatter.id)))
        .map((node) => node.id),
      projectionIds: [name],
    };
  });
  return {
    sourceMapping,
    selectedId: 'SPEC-026/T-112',
    artboard: {
      sprintId: 'SPRINT-001',
      done: 78,
      total: 82,
      carryOver,
      sourceAsOfDate: '2026-10-18',
      layout: {
        desktop: ARTBOARD_SOURCES.Home.preview.$preview,
        mobile: ARTBOARD_SOURCES.Mobile.preview.$preview,
      },
      unavailable: [
        'Operate has no state; bracketed cycle values are illustrative',
        'Commit history is not supplied in Detail',
      ],
      authoredDates:
        '18 October source snapshot; aggregate-support dates reproduce the Activity histogram.',
      sources: ARTBOARD_SOURCES,
      projections: {
        Main: { nodes: 708, edges: 477, waiting: 16, changedToday: 18, specs: 26 },
        Tokens: {
          source: 'Tokens',
          theme: 'dark',
          fonts: ['Outfit', 'DM Sans', 'Source Code Pro'],
        },
        Components: {
          types: Object.fromEntries(ARTIFACT_COUNTS.map(([, type, count]) => [type, count])),
          baseStatuses: { outstanding: 274, 'in-progress': 16, addressed: 1, done: 417 },
          blockedOverlay: 16,
        },
        IA: { source: 'IA', routeTextPreserved: true },
        Journeys: { count: 5, waiting: 16, stale: 13, highOpen: 16, toastCount: 3 },
        Home: {
          waiting: 16,
          waitingBreakdown: { graph: 15, external: 1 },
          stale: 13,
          highOpen: 16,
          changedToday: 18,
          donePercent: 59,
          tasksDone: {
            'SPEC-014': [5, 6],
            'SPEC-022': [5, 6],
            'SPEC-013': [5, 10],
            'SPEC-015': [8, 21],
            'SPEC-026': [0, 5],
          },
        },
        List: {
          all: 708,
          open: 291,
          highPriority: 16,
          blocked: 16,
          adrs: 24,
          shown: 13,
          groups: 3,
          backlogOpen: 194,
          specTraceItems: 9,
        },
        Detail: {
          origin: 'BL-425',
          spec: 'SPEC-026',
          story: 'US-096',
          task: 'SPEC-026/T-112',
          unblocks: 'SPEC-026/T-113',
          criteriaCount: 7,
          created: '2026-10-18',
          updated: '2026-10-18',
        },
        Graph: {
          focusedSpec: 'SPEC-014',
          visibleNodes: 12,
          totalNodes: 708,
          contains: 328,
          dependencies: 149,
          canvas: { width: 1000, height: 640 },
          quietDays: 24,
        },
        Board: {
          outstanding: 274,
          'in-progress': 16,
          blocked: 16,
          addressed: 1,
          done: 417,
          blockedIsOverlay: true,
          lanes: { 'SPEC-026': [0, 9], 'SPEC-022': [9, 12], backlog: [238, 435] },
        },
        Sprints: {
          count: 3,
          active: 0,
          distinctDone: 78,
          distinctTotal: 82,
          carryOver,
          rawCards: [
            [14, 18],
            [45, 45],
            [19, 19],
          ],
          correctedFirstSprint: [78, 82],
          timeline: {
            axis: ['25 Sep', '2 Oct', '10 Oct', '17 Oct', '25 Oct'],
            windows: [
              [0, 43],
              [10, 86.7],
              [6.7, 93.3],
            ],
            closeMarkers: [3.3, 6.7, 10],
          },
        },
        Activity: {
          undated: 41,
          histogram: [3, 18, 27, 17, 15, 12, 18],
          days: [12, 13, 14, 15, 16, 17, 18],
          today: 18,
          yesterday: 12,
          filedToday: 3,
        },
        Operate: {
          state: 'not-set-up',
          exampleCycle: 'illustrative',
          seats: 7,
          authoritativeCycle: null,
        },
        Palette: {
          headingMatches: 6,
          visibleNodeRows: 5,
          searched: 708,
          preview: 'BL-425',
          shapedInto: 'SPEC-026',
        },
        States: {
          noResultsQuery: 'escape hatch',
          activeFilters: 3,
          hiddenDoneMatches: 2,
          snapshotTime: '23:46',
          reconnectAttempt: 3,
          referenceWarnings: 3,
        },
        Mobile: {
          waiting: 16,
          stale: 13,
          highOpen: 16,
          changedToday: 18,
          breakpoint: 900,
          bottomTabs: 4,
        },
      },
      sourceCorrections: [
        {
          source: 'Sprints',
          field: 'firstSprintMembership',
          raw: [14, 18],
          effective: [78, 82],
          reason:
            'The corrected story requires 82 distinct first-sprint items and four still-open items. Later closed sprints reuse completed members, so distinct totals remain 78/82.',
        },
        {
          source: 'Board',
          field: 'blocked',
          reason:
            'Blocked is a dependency overlay included in base-status totals, not 16 additional nodes.',
        },
        {
          source: 'Sprints',
          field: 'carryOverTask',
          raw: 'T-055',
          effective: 'SPEC-015/T-055',
          reason:
            'The positive fixture resolves the scope; the separate error fixture retains ambiguity.',
        },
        {
          source: 'Palette',
          field: 'matches',
          reason:
            'The source heading says six matches while drawing five node rows; both source values are preserved.',
        },
      ],
    },
  };
}
