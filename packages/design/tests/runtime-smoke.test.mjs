import assert from 'node:assert/strict';
import { test } from 'node:test';

test('Design canonical root resolves shared artifact helpers', async () => {
  const design = await import('../lib/design/index.mjs');
  assert.equal(design.escapeHtml('<button aria-label="x">&</button>'),
    '&lt;button aria-label=&quot;x&quot;&gt;&amp;&lt;/button&gt;');
  assert.equal(design.contrastRatio('#000', '#fff'), 21);
});
