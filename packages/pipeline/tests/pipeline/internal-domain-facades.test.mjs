import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const domainNames = ['po', 'dev', 'ship', 'roles', 'guided', 'investigate', 'release', 'state'];

test('pipeline internals expose all eight internal domain facades', async () => {
  for (const domain of domainNames) {
    const facade = await import(`../../lib/${domain}/index.mjs`);
    assert.ok(Object.keys(facade).length > 0, `${domain} facade must expose an owned surface`);
  }
});

test('pipeline domain ownership catalog is complete and explicit', async () => {
  const catalog = JSON.parse(await readFile(new URL('../../lib/domain-ownership.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(catalog.domains), domainNames);
  for (const domain of domainNames) {
    assert.ok(catalog.domains[domain].length > 0, `${domain} must own at least one module`);
  }
});
