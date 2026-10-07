import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCliVersionAhead } from '../../scripts/release-train/lib/cli-version.mjs';

test('a Changesets version above every published one is pending', () => {
  const published = ['2.6.3', '2.2639.0', '2.2641.2'];
  assert.equal(assertCliVersionAhead({ current: '3.0.0', published }), true);
  assert.equal(
    assertCliVersionAhead({ current: '3.0.1', published: [...published, '3.0.0'] }),
    true,
  );
  assert.equal(
    assertCliVersionAhead({ current: '3.1.0', published: [...published, '3.0.0'] }),
    true,
  );
});

test('a published version is not pending and prereleases do not count', () => {
  assert.equal(assertCliVersionAhead({ current: '3.0.0', published: ['3.0.0'] }), false);
  assert.equal(
    assertCliVersionAhead({ current: '3.0.0', published: ['2.2641.2', '3.0.0-beta.1'] }),
    true,
  );
});

test('a version at or below the newest published one fails', () => {
  assert.throws(
    () => assertCliVersionAhead({ current: '2.2642.0', published: ['2.2641.2', '3.0.0'] }),
    /openplanr 2\.2642\.0 would not be newer than the published 3\.0\.0/u,
  );
  assert.throws(
    () => assertCliVersionAhead({ current: '2.2641.0', published: ['2.2641.2'] }),
    /would not be newer than the published 2\.2641\.2/u,
  );
});
