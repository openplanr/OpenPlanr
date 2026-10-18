import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createPlanningSseReconciler,
  parsePlanningGraphEnvelope,
} from '../../../../apps/dashboard/src/features/planning/planning-api.js';
import { filterPlanningNodes } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import type { DashboardQueryIdentity } from '../../../../apps/dashboard/src/lib/binding/query-identity.js';
import {
  ARTBOARD_SOURCES,
  artboardManifestData,
  artboardRecordText,
} from './fixtures/premium-artboard-fixture.js';
import {
  ARTBOARD_FIXTURE_CLOCK,
  buildAmbiguousDashboardFixture,
  buildPremiumDashboardFixture,
  FIXTURE_CLOCK,
  FIXTURE_SEED,
  fixtureHash,
  fixturePatch,
  fixtureSnapshot,
} from './fixtures/premium-dashboard-fixtures.js';

const binding = {
  actorId: 'fixture-reader',
  projectId: `sha256:${'1'.repeat(64)}`,
  scopeId: 'planning',
  domainId: 'planning',
  domainVersion: '1.0.0',
  generation: 1,
} as const;
const identity: DashboardQueryIdentity = {
  ...binding,
  productArea: 'planning',
  route: '#/list',
  cycleId: null,
  subjectId: null,
  eventHead: null,
  viewHash: null,
};
const EXPECTED_MANIFEST_HASHES = {
  representative: 'sha256:0377e8ffa9d3d14750e3c48d2b9c37fd198af08e8c3f936c909117156a5145fa',
  artboard: 'sha256:372ce8bf83b4a52d91cf1cd247d08df0815c6d2791cd415c709366cf8f5a5233',
  scaling: 'sha256:b53f65fc2a1307cdbb7ebfa3261749735717ee0c028fdf4cb9e206481b8083aa',
};

describe('deterministic premium dashboard fixtures', () => {
  it.each([
    ['representative', 708, 477],
    ['artboard', 708, 477],
    ['scaling', 5_000, 8_499],
  ] as const)('builds stable %s identities and commitments', (dataset, nodes, edges) => {
    const clock = dataset === 'artboard' ? ARTBOARD_FIXTURE_CLOCK : FIXTURE_CLOCK;
    const first = buildPremiumDashboardFixture(dataset, {
      seed: FIXTURE_SEED,
      clock,
    });
    const second = buildPremiumDashboardFixture(dataset, {
      seed: FIXTURE_SEED,
      clock,
    });
    expect(first).toEqual(second);
    expect(first.graph.nodes).toHaveLength(nodes);
    expect(first.graph.edges).toHaveLength(edges);
    expect(new Set(first.graph.nodes.map((node) => node.id)).size).toBe(nodes);
    expect(
      new Set(first.graph.edges.map((edge) => `${edge.kind}:${edge.from}:${edge.to}`)).size,
    ).toBe(edges);
    expect(first.manifest.graphHash).toBe(fixtureHash(first.graph));
    expect(first.manifestHash).toBe(fixtureHash(first.manifest));
    expect(first.manifestHash).toBe(EXPECTED_MANIFEST_HASHES[dataset]);
    expect(Object.isFrozen(first.graph.nodes[0].frontmatter)).toBe(true);
    expect(first.manifest.clock).toBe(clock);
    expect(
      parsePlanningGraphEnvelope(fixtureSnapshot(first.graph, binding), identity).graph,
    ).toEqual(first.graph);
    expect(first.manifest.sourceMapping).toHaveLength(16);
  });

  it('covers artifact/status, scoped identity, reference, date and evidence cases', () => {
    const { graph } = buildPremiumDashboardFixture('representative');
    expect(new Set(graph.nodes.map((node) => node.type)).size).toBe(9);
    expect(new Set(graph.nodes.map((node) => node.status)).size).toBe(5);
    expect(graph.nodes.some((node) => node.id.startsWith('specs/fixture-0/'))).toBe(true);
    expect(graph.nodes.some((node) => node.id.startsWith('specs/fixture-1/'))).toBe(true);
    expect(graph.edges.slice(300, 302)).toEqual([
      { from: graph.nodes[0].id, to: graph.nodes[1].id, kind: 'depends_on' },
      { from: graph.nodes[1].id, to: graph.nodes[0].id, kind: 'depends_on' },
    ]);
    expect(graph.nodes[0].frontmatter.dependsOn).toEqual(['MISSING-001']);
    expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.to))).toBe(true);
    expect(graph.nodes.some((node) => !('updated' in node.frontmatter))).toBe(true);
    expect(graph.nodes.some((node) => node.frontmatter.updated === 'invalid-date')).toBe(true);
    expect(graph.nodes.some((node) => node.frontmatter.updated === '2026-09-01')).toBe(true);
    expect(graph.nodes.some((node) => node.frontmatter.updated === '2026-12-01')).toBe(true);
    expect(
      new Set(graph.nodes.map((node) => (node.frontmatter.evidence as { state: string }).state))
        .size,
    ).toBe(5);
    expect(
      graph.nodes.some((node) => node.type === 'sprint' && node.frontmatter.status === 'closed'),
    ).toBe(true);
    expect(
      graph.nodes.some((node) => node.type === 'sprint' && node.frontmatter.status === 'active'),
    ).toBe(true);
  });

  it('keeps the corrected all-item sprint denominator and carry-over unambiguous', () => {
    const { graph, manifest } = buildPremiumDashboardFixture('artboard');
    const sprint = graph.nodes.find((node) => node.id === manifest.artboard.sprintId);
    const ids = sprint?.frontmatter.taskIds as string[];
    expect(new Set(ids).size).toBe(82);
    const members = ids.map((id) => {
      const member = graph.nodes.find((node) => node.id === id);
      if (!member) throw new Error(`Missing sprint member ${id}.`);
      return member;
    });
    expect(members.filter((node) => node.status === 'done')).toHaveLength(78);
    expect(members.filter((node) => node.status !== 'done').map((node) => node.id)).toEqual(
      manifest.artboard.carryOver,
    );
    expect(new Set(members.map((node) => node.type))).toEqual(
      new Set(['quick', 'backlog', 'task', 'story']),
    );
    expect(sprint?.frontmatter).toMatchObject({ status: 'closed', closedAt: '2026-09-26' });
    const carryTask = manifest.artboard.carryOver[3].split('/').at(-1);
    expect(graph.nodes.filter((node) => node.frontmatter.id === carryTask)).toHaveLength(1);
    expect(
      buildAmbiguousDashboardFixture().nodes.filter((node) => node.frontmatter.id === carryTask),
    ).toHaveLength(2);
    const ambiguous = buildAmbiguousDashboardFixture();
    expect(ambiguous.nodes.find((node) => node.type === 'sprint')?.frontmatter.taskIds).toContain(
      carryTask,
    );
    expect(members.every((node) => !('sprintId' in node.frontmatter))).toBe(true);
    expect(manifest.artboard.unavailable).not.toContain('approved artboard source bytes');
    expect(manifest.artboard.carryOver[3]).toBe('SPEC-015/T-055');
  });

  it('reproduces the artboard counts without double-counting dependency overlays', () => {
    const { graph, manifest } = buildPremiumDashboardFixture('artboard');
    const { artboard } = artboardManifestData(graph);
    expect(artboard.projections.Home).toMatchObject({
      waiting: 16,
      stale: 13,
      highOpen: 16,
      changedToday: 18,
      donePercent: 59,
    });
    expect(graph.nodes.filter((node) => node.frontmatter.artboardWaiting)).toHaveLength(16);
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const graphBlocked = new Set(
      graph.edges
        .filter(
          (edge) =>
            edge.kind === 'depends_on' &&
            !['done', 'addressed'].includes(byId.get(edge.from)?.status ?? '') &&
            !['done', 'addressed'].includes(byId.get(edge.to)?.status ?? ''),
        )
        .map((edge) => edge.from),
    );
    expect(graphBlocked.size).toBe(15);
    expect(
      graph.nodes
        .filter((node) => node.frontmatter.artboardWaiting && !graphBlocked.has(node.id))
        .map((node) => node.id),
    ).toEqual(['BL-047']);
    expect(artboard.projections.Home.waitingBreakdown).toEqual({ graph: 15, external: 1 });
    expect(graph.nodes.filter((node) => node.frontmatter.artboardQuietExample)).toHaveLength(13);
    expect(
      graph.nodes.filter(
        (node) => node.frontmatter.priority === 'high' && node.status === 'outstanding',
      ),
    ).toHaveLength(16);
    expect(
      Object.fromEntries(
        ['outstanding', 'in-progress', 'addressed', 'done'].map((status) => [
          status,
          graph.nodes.filter((node) => node.status === status).length,
        ]),
      ),
    ).toEqual({ outstanding: 274, 'in-progress': 16, addressed: 1, done: 417 });
    expect(
      Object.fromEntries(
        ['spec', 'story', 'task', 'backlog', 'adr', 'quick', 'sprint', 'epic'].map((type) => [
          type,
          graph.nodes.filter((node) => node.type === type).length,
        ]),
      ),
    ).toEqual({
      spec: 26,
      story: 97,
      task: 113,
      backlog: 435,
      adr: 24,
      quick: 9,
      sprint: 3,
      epic: 1,
    });
    expect(graph.nodes.filter((node) => !node.frontmatter.updated)).toHaveLength(41);
    expect(
      [12, 13, 14, 15, 16, 17, 18].map(
        (day) => graph.nodes.filter((node) => node.frontmatter.updated === `2026-10-${day}`).length,
      ),
    ).toEqual([3, 18, 27, 17, 15, 12, 18]);
    expect(graph.edges.filter((edge) => edge.kind === 'contains')).toHaveLength(328);
    expect(graph.edges.filter((edge) => edge.kind === 'depends_on')).toHaveLength(149);
    expect(artboard.sourceAsOfDate).toBe('2026-10-18');
    expect(manifest.clock).toBe(ARTBOARD_FIXTURE_CLOCK);
    expect(artboard.layout).toEqual({
      desktop: { width: 1440, height: 1120 },
      mobile: { width: 390, height: 1560 },
    });
    expect(artboard.projections.List).toMatchObject({
      all: 708,
      open: 291,
      shown: 13,
      groups: 3,
      adrs: 24,
    });
    expect(artboard.projections.Graph).toMatchObject({
      visibleNodes: 12,
      totalNodes: 708,
      canvas: { width: 1000, height: 640 },
    });
    expect(artboard.projections.Palette).toMatchObject({ headingMatches: 6, visibleNodeRows: 5 });
    expect(artboard.projections.Operate).toMatchObject({
      state: 'not-set-up',
      authoritativeCycle: null,
    });
    const allSprintItems = new Set(
      graph.nodes
        .filter((node) => node.type === 'sprint')
        .flatMap((node) => node.frontmatter.taskIds as string[]),
    );
    expect(allSprintItems.size).toBe(82);
    expect(
      graph.nodes.filter((node) => allSprintItems.has(node.id) && node.status === 'done'),
    ).toHaveLength(78);
  });

  it('reproduces both spec traces and the exact named example titles', () => {
    const { graph } = buildPremiumDashboardFixture('artboard');
    const node = (id: string) => {
      const found = graph.nodes.find((node) => node.id === id);
      if (!found) throw new Error(`Missing trace node ${id}.`);
      return found;
    };
    expect(node('SPEC-014').title).toBe('Design-to-Delivery Handoff Center');
    expect(node('SPEC-026').frontmatter).toMatchObject({
      originId: 'BL-425',
      priority: 'P1',
      status: 'shaped',
    });
    for (const [spec, done, total] of [
      ['SPEC-013', 5, 10],
      ['SPEC-014', 5, 6],
      ['SPEC-015', 8, 21],
      ['SPEC-022', 5, 6],
      ['SPEC-026', 0, 5],
    ] as const) {
      const tasks = graph.nodes.filter(
        (node) => node.type === 'task' && node.id.startsWith(`${spec}/`),
      );
      expect(tasks, spec).toHaveLength(total);
      expect(
        tasks.filter((node) => node.status === 'done'),
        spec,
      ).toHaveLength(done);
    }
    const stories = graph.edges
      .filter((edge) => edge.kind === 'contains' && edge.from === 'SPEC-014')
      .map((edge) => node(edge.to));
    expect(stories.map((node) => node.id)).toEqual([
      'US-041',
      'US-042',
      'US-043',
      'US-044',
      'US-045',
    ]);
    expect(stories.filter((node) => node.status === 'done')).toHaveLength(4);
    expect(node('SPEC-014/T-046')).toMatchObject({
      title: 'Connect Plan Ship company sync and release proof',
      status: 'in-progress',
      frontmatter: { updated: '2026-09-24', dependsOn: ['SPEC-014/T-045'] },
    });
    expect(
      graph.edges
        .filter((edge) => edge.kind === 'depends_on' && edge.from === 'SPEC-014/T-046')
        .map((edge) => edge.to),
    ).toEqual(['SPEC-014/T-045']);
    expect(node('SPEC-026/T-112')).toMatchObject({
      title: 'Findings contract, consent and filing guidance in Ship and Investigate',
      frontmatter: {
        storyId: 'US-096',
        created: '2026-10-18',
        updated: '2026-10-18',
        dependsOn: ['SPEC-026/T-109', 'SPEC-026/T-110'],
      },
    });
    expect(node('SPEC-026/T-112').frontmatter.acceptanceCriteria).toHaveLength(7);
    expect(node('SPEC-026/T-112').frontmatter.files).toHaveLength(6);
    expect(graph.edges).toContainEqual({ kind: 'contains', from: 'US-096', to: 'SPEC-026/T-112' });
    expect(node('SPEC-026/T-113').frontmatter.dependsOn).toEqual([
      'SPEC-026/T-111',
      'SPEC-026/T-112',
    ]);
    expect(node('BL-425')).toMatchObject({
      title: 'Ship and Investigate offer to file out-of-scope findings as backlog items',
      frontmatter: { created: '2026-10-17', priority: 'high', labels: ['feature'] },
    });
    expect(node('BL-433')).toMatchObject({
      title: 'backlog add accepts any priority value',
      frontmatter: { created: '2026-10-18', labels: ['cli'] },
    });
    expect(node('BL-434')).toMatchObject({
      title: 'Config saves still drop unknown keys inside nested settings',
      frontmatter: { labels: ['cli', 'config'] },
    });
    expect(node('BL-435')).toMatchObject({
      title:
        'Epic: track defects found after merge (escapes) on backlog items and report them per gate',
      frontmatter: { labels: ['ship', 'quality'] },
    });
  });

  it('maps every artboard to exact text and layout records and real fixture identities', () => {
    const { graph, manifest } = buildPremiumDashboardFixture('artboard');
    const byNodeId = new Set(graph.nodes.map((node) => node.id));
    const { sourceMapping, artboard } = artboardManifestData(graph);
    expect(manifest.sourceMapping).toEqual(sourceMapping);
    expect(sourceMapping).toHaveLength(16);
    for (const mapping of sourceMapping) {
      const name = mapping.projectionIds[0];
      const source = ARTBOARD_SOURCES[name];
      const recordIds = new Set(source.records.map((record) => record.id));
      expect(mapping.sourceHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(mapping.recordIds.length).toBeGreaterThan(0);
      expect(mapping.recordIds.every((id) => recordIds.has(id))).toBe(true);
      expect(mapping.nodeIds.every((id) => byNodeId.has(id))).toBe(true);
      expect(name in artboard.projections).toBe(true);
      for (const record of source.records)
        for (const child of record.content)
          if (typeof child !== 'string') expect(recordIds.has(child.recordId)).toBe(true);
      expect(source.styles.length).toBeGreaterThan(0);
    }
    const text = (name: string) =>
      artboardRecordText(ARTBOARD_SOURCES[name], ARTBOARD_SOURCES[name].records[0]);
    expect(text('Journeys')).toContain('Needs attention: 16 waiting, 13 stale, 16 high open.');
    expect(text('Sprints')).toContain('78 of 82 sprint items are done.');
    expect(text('Graph')).toContain('contains · 328');
    expect(text('Graph')).toContain('depends on · 149');
    expect(text('Activity')).toContain('41 nodes carry no date');
    expect(
      ARTBOARD_SOURCES.Graph.records.some(
        (record) => record.attributes.style === 'left:600px;top:530px',
      ),
    ).toBe(true);
    expect(artboard.sourceCorrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'firstSprintMembership',
          raw: [14, 18],
          effective: [78, 82],
        }),
      ]),
    );
  });

  it.runIf(
    existsSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../.planr/design/dashboard-redesign/project/Home.dc.html',
      ),
    ),
  )('matches all available approved artboard source digests', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
    for (const source of Object.values(ARTBOARD_SOURCES))
      expect(
        `sha256:${createHash('sha256')
          .update(readFileSync(resolve(root, source.source)))
          .digest('hex')}`,
      ).toBe(source.sourceHash);
  });

  it('pins scaling edge families without orphan or duplicate edges', () => {
    const { graph } = buildPremiumDashboardFixture('scaling');
    expect(graph.edges.filter((edge) => edge.kind === 'contains')).toHaveLength(4_999);
    expect(graph.edges.filter((edge) => edge.kind === 'depends_on')).toHaveLength(3_500);
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });

  it.each(['representative', 'scaling'] as const)(
    'keeps the selected %s task identity, status and filter membership in a live patch',
    (dataset) => {
      const fixture = buildPremiumDashboardFixture(dataset);
      const snapshot = fixtureSnapshot(fixture.graph, binding);
      const selected = snapshot.graph.nodes.find((node) => node.id === fixture.manifest.selectedId);
      if (!selected) throw new Error('Selected fixture task is absent.');
      expect(selected.type).toBe('task');
      const next = fixturePatch(snapshot, selected.id);
      if (next.event.event !== 'patch') throw new Error('Expected a Planning patch event.');
      const payload = next.event.payload.patch;
      expect(payload).toEqual({
        updated: [{ ...selected, title: 'Fixture patch 1' }],
        added: [],
        removed: [],
        edges: { added: [], removed: [] },
      });
      const updated = payload.updated[0];
      expect({ id: updated.id, type: updated.type, status: updated.status }).toEqual({
        id: selected.id,
        type: selected.type,
        status: selected.status,
      });
      expect(updated.frontmatter).toEqual(selected.frontmatter);
      expect(
        filterPlanningNodes(next.snapshot.graph.nodes, { typeFilter: ['task'] }),
      ).toContainEqual(updated);
      expect(next.snapshot.cursor.viewHash).toBe(fixtureHash(next.snapshot.graph));
      expect(next.snapshot.cursor.viewHash).not.toBe(snapshot.cursor.viewHash);
      expect(snapshot.cursor.viewHash).toBe(fixtureHash(snapshot.graph));
    },
  );

  it.each(['representative', 'scaling'] as const)(
    'accepts all 50 %s patches through the production reconciler',
    (dataset) => {
      const fixture = buildPremiumDashboardFixture(dataset);
      let snapshot = fixtureSnapshot(fixture.graph, binding);
      const selected = snapshot.graph.nodes.find((node) => node.id === fixture.manifest.selectedId);
      if (!selected) throw new Error('Selected fixture task is absent.');
      const accepted: string[] = [];
      const reconciler = createPlanningSseReconciler({
        identity,
        initial: snapshot,
        isCurrent: () => true,
        onSnapshot: () => {
          throw new Error('Unexpected snapshot replacement.');
        },
        onPatch: (next) => {
          accepted.push(next.cursor.viewHash);
        },
        onRefetch: (reason) => {
          throw new Error(`Unexpected refetch: ${reason}`);
        },
      });
      for (let index = 0; index < 50; index += 1) {
        const next = fixturePatch(snapshot, fixture.manifest.selectedId);
        if (next.event.event !== 'patch') throw new Error('Expected a Planning patch event.');
        expect(next.event.payload.patch.updated).toEqual([
          { ...selected, title: `Fixture patch ${index + 1}` },
        ]);
        expect(reconciler.ingestSseFrame(JSON.stringify(next.event), 'patch')).toEqual({
          kind: 'accepted',
          event: 'patch',
        });
        snapshot = next.snapshot;
      }
      expect(new Set(accepted).size).toBe(50);
      expect(snapshot.graph.nodes.map((node) => node.id)).toEqual(
        fixture.graph.nodes.map((node) => node.id),
      );
      expect(snapshot.graph.edges).toEqual(fixture.graph.edges);
      expect(snapshot.cursor.eventHead.sequence).toBe(50);
      reconciler.dispose();
    },
  );

  it('commits seed/clock changes and rejects invalid fixture options', () => {
    const original = buildPremiumDashboardFixture('representative');
    expect(
      buildPremiumDashboardFixture('representative', { seed: 'alternate' }).manifest.graphHash,
    ).not.toBe(original.manifest.graphHash);
    expect(
      buildPremiumDashboardFixture('representative', { clock: '2026-10-20T12:00:00.000Z' })
        .manifestHash,
    ).not.toBe(original.manifestHash);
    for (const clock of ['invalid', '2026-02-30T00:00:00.000Z', '2026-10-19T12:00:00+00:00'])
      expect(() => buildPremiumDashboardFixture('representative', { clock })).toThrow();
    expect(() => buildPremiumDashboardFixture('representative', { seed: '' })).toThrow();
  });
});
