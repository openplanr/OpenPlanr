import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function fixtureContents(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? fixtureContents(path) : [[path, readFileSync(path, 'utf8')]];
  });
}

export const identityCases = [
  [
    'reads legacy ADR identity, title, status, and date from Markdown',
    (graph) => {
      assert.deepEqual(
        graph.nodes.find((node) => node.id === 'ADR-024'),
        {
          id: 'ADR-024',
          type: 'adr',
          title: 'Native-first delegation',
          status: 'outstanding',
          frontmatter: {
            id: 'ADR-024',
            title: 'Native-first delegation',
            status: 'Accepted by the owner',
            date: '2026-10-01',
          },
        },
      );
    },
  ],
  [
    'frontmatter wins over legacy ADR headings and bullets',
    (graph) => {
      assert.deepEqual(graph.nodes.find((node) => node.id === 'ADR-025').frontmatter, {
        id: 'ADR-025',
        title: 'Authored frontmatter title',
        status: 'superseded',
        date: '2026-10-02',
      });
      const empty = graph.nodes.find((node) => node.id === 'ADR-028-empty-frontmatter');
      assert.deepEqual(empty.frontmatter, { id: 'ADR-028-empty-frontmatter' });
    },
  ],
  [
    'missing legacy ADR status and date remain unknown',
    (graph) => {
      const node = graph.nodes.find((entry) => entry.id === 'ADR-026');
      assert.equal(node.title, 'Metadata unavailable');
      assert.equal(Object.hasOwn(node.frontmatter, 'status'), false);
      assert.equal(Object.hasOwn(node.frontmatter, 'date'), false);
      assert.equal(Object.hasOwn(node.frontmatter, 'created'), false);
    },
  ],
  [
    'tolerates a UTF-8 byte order mark before ADR frontmatter',
    (graph) => {
      const node = graph.nodes.find((entry) => entry.id === 'ADR-027');
      assert.equal(node.title, 'BOM frontmatter');
      assert.equal(node.frontmatter.status, 'accepted');
    },
  ],
  [
    'excludes README and other documentation from canonical discovery',
    (graph) => {
      assert.equal(graph.nodes.length, 14);
      assert.ok(!graph.nodes.some((node) => /README|notes|guide/.test(node.id)));
    },
  ],
  [
    'resolves unique bare task refs without choosing ambiguous or missing targets',
    (graph) => {
      assert.deepEqual(
        graph.edges.filter((edge) => edge.from === 'QT-006'),
        [
          { from: 'QT-006', to: 'SPEC-015/T-055', kind: 'depends_on' },
          { from: 'QT-006', to: 'SPEC-016/T-056', kind: 'depends_on' },
        ],
      );
    },
  ],
  [
    'reports exact resolved and unresolved sprint membership separately from authored refs',
    (graph, model) => {
      assert.ok(model, 'a validated diagnostic read model must be available');
      assert.deepEqual(
        model.references
          .filter((ref) => ref.nodeId === 'SPRINT-001')
          .map((ref) => [ref.authoredRef, ref.targetId, ref.reason, ref.candidates]),
        [
          ['T-055', 'SPEC-015/T-055', null, ['SPEC-015/T-055']],
          ['T-056', null, 'ambiguous', ['SPEC-015/T-056', 'SPEC-016/T-056']],
          ['T-999', null, 'missing', []],
          ['SPEC-016/T-056', 'SPEC-016/T-056', null, ['SPEC-016/T-056']],
        ],
      );
      assert.deepEqual(graph.nodes.find((node) => node.id === 'SPRINT-001').frontmatter.taskIds, [
        'T-055',
        'T-056',
        'T-999',
        'SPEC-016/T-056',
      ]);
    },
  ],
  [
    'flags impossible sprint chronology as source data and preserves early valid closure',
    (graph, model) => {
      assert.ok(model, 'a validated diagnostic read model must be available');
      assert.equal(
        graph.nodes.find((node) => node.id === 'SPRINT-002').frontmatter.closedAt,
        '2026-10-02',
      );
      assert.deepEqual(
        model.diagnostics.filter((entry) => entry.nodeId === 'SPRINT-002'),
        [
          {
            nodeId: 'SPRINT-002',
            sourcePath: 'sprints/SPRINT-002-impossible.md',
            field: 'closedAt',
            reason: 'closed-before-start',
            classification: 'source-data',
          },
        ],
      );
      assert.equal(
        model.diagnostics.filter(
          (entry) => entry.nodeId === 'SPRINT-001' && entry.field === 'closedAt',
        ).length,
        0,
      );
      assert.deepEqual(
        model.diagnostics
          .filter((entry) => entry.nodeId === 'SPRINT-003')
          .map((entry) => entry.field),
        ['startDate', 'closedAt'],
      );
      assert.ok(!JSON.stringify(model.diagnostics).includes(process.cwd()));
    },
  ],
  [
    'keeps cyclic dependencies visible without recursive traversal',
    (_graph, model) => {
      assert.ok(model, 'a validated diagnostic read model must be available');
      assert.equal(
        model.diagnostics.filter((entry) => entry.reason === 'dependency-cycle').length,
        3,
      );
    },
  ],
];
