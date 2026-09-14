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
  assert.match(page, /rows\.slice\(pageStart, pageStart \+ PAGE_SIZE\)/u);
  assert.match(page, /rows=\{visibleRows\}/u);
  assert.match(page, /aria-label="Planning artifact pages"/u);
  assert.match(page, /Page \{currentPage \+ 1\} of \{pageCount\}/u);
});

test('dependency counts are indexed once instead of filtering edges per row', () => {
  assert.match(columns, /for \(const edge of edges\)/u);
  assert.match(columns, /counts\.get\(node\.id\) \?\? 0/u);
  assert.doesNotMatch(columns, /edges\.filter/u);
});
