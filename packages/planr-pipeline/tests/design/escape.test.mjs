import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, embedJson, hasUnsafeHtml } from '../../lib/design/escape.mjs';

test('escapeHtml escapes all five HTML-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x" class='y'>& tag</a>`),
    '&lt;a href=&quot;x&quot; class=&#39;y&#39;&gt;&amp; tag&lt;/a&gt;');
});

test('escapeHtml coerces null/undefined/numbers without throwing', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('embedJson output parses back to the original value', () => {
  const value = { title: 'Login </script>', tags: ['a', 'b'], n: 3 };
  assert.deepEqual(JSON.parse(embedJson(value)), value);
});

test('embedJson neutralizes </script> so it cannot break out of a block', () => {
  const out = embedJson({ title: '</script><script>alert(1)</script>' });
  assert.ok(!out.includes('</script>'), 'must not contain a literal </script>');
  assert.ok(out.includes('\\u003c'), 'must escape < as \\u003c');
});

test('embedJson escapes U+2028 / U+2029 line separators', () => {
  const value = { copy: `line${String.fromCharCode(0x2028)}sep${String.fromCharCode(0x2029)}end` };
  const out = embedJson(value);
  assert.ok(!out.includes(String.fromCharCode(0x2028)), 'no raw U+2028');
  assert.ok(!out.includes(String.fromCharCode(0x2029)), 'no raw U+2029');
  assert.deepEqual(JSON.parse(out), value);
});

test('hasUnsafeHtml flags unescaped content and clears escaped content', () => {
  assert.equal(hasUnsafeHtml('<img>'), true);
  assert.equal(hasUnsafeHtml(escapeHtml('<img>')), false);
});

// SPEC-015 finding S1 — the injection regression. A malicious screen name must
// be inert in BOTH the HTML-text context and the embedded-JSON context.
test('INJECTION: a hostile screen name is inert after escaping', () => {
  const hostile = `</script><img src=x onerror=alert(document.cookie)>`;

  const asHtml = escapeHtml(hostile);
  assert.equal(hasUnsafeHtml(asHtml), false);
  assert.ok(!asHtml.includes('<img'), 'no live <img in HTML context');

  const asJson = embedJson({ label: hostile });
  assert.ok(!asJson.includes('</script>'), 'no </script> breakout in JSON context');
  assert.equal(JSON.parse(asJson).label, hostile, 'value is preserved, just safely encoded');
});
