import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(
  new URL('../../src/features/planning/ListPage.tsx', import.meta.url),
  'utf8',
);
const columns = await readFile(
  new URL('../../src/features/planning/planning-columns.tsx', import.meta.url),
  'utf8',
);

test('planning list bounds mounted rows and exposes accessible pagination', () => {
  assert.match(page, /const PAGE_SIZE = 100/u);
  assert.match(page, /appearances\.slice\(pageStart, pageStart \+ PAGE_SIZE\)/u);
  assert.match(page, /for \(const \{ group, node \} of visibleRows\)/u);
  assert.match(page, /current\.nodes\.push\(node\)/u);
  assert.doesNotMatch(page, /visibleRows\.filter/u);
  assert.match(page, /rows: group.nodes/u);
  assert.match(page, /aria-label="Planning artifact pages"/u);
  assert.match(page, /Page \{currentPage \+ 1\} of \{pageCount\}/u);
});

test('dependency counts are indexed once instead of filtering edges per row', () => {
  assert.match(columns, /for \(const edge of edges\)/u);
  assert.match(columns, /counts\.get\(node\.id\) \?\? 0/u);
  assert.doesNotMatch(columns, /edges\.filter/u);
});

test('bounded List rows retain global position and React-owned selection semantics', () => {
  assert.match(page, /rowCount=\{/u);
  assert.match(
    page,
    /appearances.length \+ \(effectiveView.groupBy === 'none' \? 0 : grouped.length\)/u,
  );
  assert.match(page, /rowPosition: \(node:/u);
  assert.match(page, /selectedIds=\{selectedSet\}/u);
  assert.match(page, /useListKeyboardWindow/u);
  assert.match(page, /useListScrollAnchor/u);
  assert.match(page, /bulk\.skipped\.slice\(0, 20\)/u);
});
