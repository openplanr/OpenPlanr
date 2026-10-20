import { describe, expect, it } from 'vitest';
import type { PlanningModelNode } from '../../../../apps/dashboard/src/features/planning/planning-model.js';
import {
  buildStructuralDetail,
  createStructuralIndex,
  structuralFilePath,
} from '../../../../apps/dashboard/src/features/planning/planning-structural-model.js';
import { declaredPlanningFiles } from '../../../pipeline/lib/dashboard/server/planning-file-links.mjs';
import { buildArtboardGraph, canonicalArtboardId } from './fixtures/premium-artboard-fixture.js';

const artifact = (id: string, fields: Partial<PlanningModelNode> = {}): PlanningModelNode => ({
  id,
  type: 'task',
  title: id,
  status: 'outstanding',
  frontmatter: {},
  ...fields,
});

const declaredFileCases = [
  {
    name: 'task Create and Modify subsections',
    body: '## Files\n### Create\n- src/new.ts\n### Modify\n- `src/main.ts`\n### Preserve\n- src/stable.ts',
    paths: ['src/new.ts', 'src/main.ts', 'src/stable.ts'],
  },
  {
    name: 'frontmatter files',
    frontmatter: { files: { create: ['src/new.ts'] } },
    paths: [],
  },
  {
    name: 'frontmatter arrays',
    frontmatter: { files: ['src/new.ts', { action: 'Modify', path: 'src/main.ts' }] },
    paths: [],
  },
  {
    name: 'visible declarations repeated in frontmatter',
    frontmatter: { files: { modify: ['src/main.ts'] } },
    body: '## Files\n### Modify\n- src/main.ts',
    paths: ['src/main.ts'],
  },
  {
    name: 'Files-prefixed headings',
    body: '## Files changed\n- src/main.ts',
    paths: [],
  },
  {
    name: 'tagged and annotated items',
    body: '## Files\n- Create: src/new.ts\n- `src/main.ts` note\n- `src/other.ts` - note',
    paths: [],
  },
  {
    name: 'extensionless and quoted paths',
    body: '## Files\n- LICENSE\n- `src/hello #?.ts`',
    paths: ['LICENSE', 'src/hello #?.ts'],
  },
  {
    name: 'unicode within the path length limit',
    body: `## Files\n- src/${'é'.repeat(180)}.ts`,
    paths: [`src/${'é'.repeat(180)}.ts`],
  },
  {
    name: 'hidden and indented items',
    body: '## Files\n- src/visible.ts\n    - src/indented.ts\n<!--\n- src/comment.ts\n-->\n```md\n- src/fenced.ts\n```\n~~~md\n- src/tilde-fenced.ts\n~~~',
    paths: ['src/visible.ts'],
  },
  {
    name: 'setext and peer sections',
    body: '## Files\n- src/visible.ts\nOther section\n=============\n- src/other.ts\n## Notes\n- src/note.ts',
    paths: ['src/visible.ts'],
  },
  {
    name: 'raw HTML',
    body: '## Files\n- src/visible.ts\n<div hidden>\n- src/hidden.ts\n</div>\n## Files\n- src/later.ts',
    paths: ['src/visible.ts'],
  },
  {
    name: 'unsafe paths',
    body: '## Files\n- ../outside.ts\n- /private/file.ts\n- src/../outside.ts\n- src/%2e.ts\n- src\\file.ts\n- `src/null\0.ts`',
    paths: [],
  },
  {
    name: 'heading syntax and deduplicated paths',
    body: '  ## fIlEs ##\r\n### Modify\r\n+ src/main.ts\r\n* `src/main.ts`\r\n# Notes\r\n- src/other.ts',
    paths: ['src/main.ts'],
  },
];

describe('declared file parser parity', () => {
  for (const entry of declaredFileCases) {
    for (const parser of ['client', 'server']) {
      it(`${parser}: ${entry.name}`, () => {
        const current = artifact('T-files', entry);
        const paths =
          parser === 'server'
            ? declaredPlanningFiles(current)
            : new Set(
                buildStructuralDetail(
                  createStructuralIndex({ nodes: [current], edges: [] }),
                  current,
                ).files.flatMap(({ path }) => (path === null ? [] : [path])),
              );
        expect([...paths]).toEqual(entry.paths);
      });
    }
  }
});

describe('structural detail projection', () => {
  it('traces fixture origin, spec, story, task and the task it unblocks', () => {
    const graph = buildArtboardGraph('structural-detail');
    const index = createStructuralIndex(graph);
    const selected = index.byId.get(canonicalArtboardId('T-112'));
    if (!selected) throw new Error('Fixture detail artifact missing');
    const detail = buildStructuralDetail(index, selected);
    expect(detail.trace.map(({ node }) => node.id)).toEqual([
      'BL-425',
      'SPEC-026',
      'US-096',
      'SPEC-026/T-112',
      'SPEC-026/T-113',
    ]);
    expect(detail.dependencies.map(({ node }) => node?.id)).toEqual([
      'SPEC-026/T-109',
      'SPEC-026/T-110',
    ]);
    expect(detail.trace.find(({ node }) => node.id === selected.id)?.blockedBy).toBe(2);
    expect(selected.status).toBe('outstanding');
    expect(detail.criteria.length).toBeGreaterThan(0);
    expect(detail.files.some(({ group }) => group === 'Create')).toBe(true);
    expect(detail.files.some(({ group, path }) => group === 'Preserve' && path === null)).toBe(
      true,
    );
    expect(detail.sourcePath).toBe(selected.frontmatter.file);
  });

  it('prefers scoped local identities and keeps ambiguous or missing references visible', () => {
    const current = artifact('SPEC-blue/T-shared', {
      frontmatter: { specId: 'SPEC-blue', dependsOn: ['T-other', 'T-unknown'] },
    });
    const graph = {
      nodes: [
        current,
        artifact('T-other'),
        artifact('SPEC-blue/T-other'),
        artifact('SPEC-green/T-other'),
        artifact('SPEC-blue', { type: 'spec' }),
      ],
      edges: [],
    };
    const index = createStructuralIndex(graph);
    expect(index.resolve('T-other', current).node?.id).toBe('SPEC-blue/T-other');
    expect(index.resolve('SPEC-green/T-other', current).node?.id).toBe('SPEC-green/T-other');
    const ambiguous = createStructuralIndex({
      nodes: graph.nodes.filter(({ id }) => id !== 'T-other'),
      edges: [],
    });
    expect(ambiguous.resolve('T-other').reason).toContain('Ambiguous');
    const detail = buildStructuralDetail(index, current);
    expect(detail.dependencies[1]).toMatchObject({ reference: 'T-unknown', node: null });
    expect(detail.warnings.join(' ')).toContain('T-unknown');
  });

  it('keeps canonical graph edges exact when a local authored id also exists', () => {
    const selected = artifact('SPEC-blue/T-first', { frontmatter: { specId: 'SPEC-blue' } });
    const global = artifact('T-shared');
    const scoped = artifact('SPEC-blue/T-shared');
    const index = createStructuralIndex({
      nodes: [selected, global, scoped],
      edges: [{ from: selected.id, to: global.id, kind: 'depends_on' }],
    });
    expect(buildStructuralDetail(index, selected).dependencies[0].node?.id).toBe(global.id);
  });

  it('terminates cycles and exposes both containment and dependency cycle warnings', () => {
    const first = artifact('T-first');
    const second = artifact('T-second');
    const index = createStructuralIndex({
      nodes: [first, second],
      edges: [
        { from: first.id, to: second.id, kind: 'contains' },
        { from: second.id, to: first.id, kind: 'contains' },
        { from: first.id, to: second.id, kind: 'depends_on' },
        { from: second.id, to: first.id, kind: 'depends_on' },
      ],
    });
    const detail = buildStructuralDetail(index, first);
    expect(new Set(detail.trace.map(({ node }) => node.id)).size).toBe(2);
    expect(detail.warnings.some((warning) => warning.includes('ancestry'))).toBe(true);
    expect(detail.warnings.some((warning) => warning.includes('dependency'))).toBe(true);
    expect(detail.parents[0].node?.id).toBe(second.id);
    expect(detail.children[0].node?.id).toBe(second.id);
  });

  it('retains acceptance ids and inherits only referenced specification criteria', () => {
    const spec = artifact('SPEC-blue', {
      type: 'spec',
      body: '## Acceptance Criteria\n- **AC-a**: Keep authored names\n- AC-b: Preserve audit history\n## Other\n- Not a criterion',
    });
    const current = artifact('SPEC-blue/T-first', {
      frontmatter: { specId: spec.id, acceptanceRefs: ['AC-b', 'AC-missing'] },
      body: '## Acceptance Criteria\n- [ ] AC-local: Verify the task',
    });
    const detail = buildStructuralDetail(
      createStructuralIndex({ nodes: [spec, current], edges: [] }),
      current,
    );
    expect(detail.criteria).toEqual([
      { id: 'AC-local', text: 'Verify the task', sourceId: current.id },
      { id: 'AC-b', text: 'Preserve audit history', sourceId: spec.id },
      {
        id: 'AC-missing',
        text: 'Referenced criterion is unavailable in the current detail.',
        sourceId: spec.id,
      },
    ]);
  });

  it('parses grouped file declarations and keeps unsafe evidence inspectable without links', () => {
    const current = artifact('T-files', {
      frontmatter: {
        files: { create: ['src/new.ts'], preserve: ['Existing public names'] },
        shipRef: 'javascript:alert(1)',
        qaRef: 'https://example.com/proof',
      },
      body: '## Files\n### Modify\n- `src/main.ts` changes\n- src/linked.ts\n### Preserve (do not touch)\n- The audit boundary\n## Notes\n- Not a file',
    });
    const detail = buildStructuralDetail(
      createStructuralIndex({ nodes: [current], edges: [] }),
      current,
    );
    expect(detail.files).toEqual([
      { group: 'Create', path: null, text: 'src/new.ts' },
      { group: 'Preserve', path: null, text: 'Existing public names' },
      { group: 'Modify', path: null, text: '`src/main.ts` changes' },
      { group: 'Modify', path: 'src/linked.ts', text: 'src/linked.ts' },
      { group: 'Preserve', path: null, text: 'The audit boundary' },
    ]);
    expect(detail.evidence).toEqual([
      { label: 'shipRef', value: 'javascript:alert(1)', href: null },
      { label: 'qaRef', value: 'https://example.com/proof', href: 'https://example.com/proof' },
    ]);
    expect(structuralFilePath('src/detail #?.ts')).toBe('src/detail #?.ts');
    expect(structuralFilePath('src/file%2Fother.ts')).toBeNull();
    expect(structuralFilePath('../secret.md')).toBeNull();
    expect(structuralFilePath('/private/file.md')).toBeNull();
  });
});
