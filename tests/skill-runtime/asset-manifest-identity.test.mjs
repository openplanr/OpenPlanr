import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCustodyManifest,
  buildGeneratedAssetManifest,
  deriveAssetSetId,
} from '../../packages/skill-runtime/src/index.mjs';

const digest = (character) => `sha256:${character.repeat(64)}`;
const sourceMap = Object.freeze([{
  startByte: 0,
  endByte: 1,
  owner: Object.freeze({
    ownerKind: 'source',
    pointer: 'skills/planr-demo/skill.json',
    version: '1.0.0',
    digest: digest('a'),
  }),
}]);

function asset(host, contentDigest) {
  return {
    path: 'skills/planr-demo/SKILL.md',
    host,
    byteLength: 1,
    digest: contentDigest,
    sourceMap,
  };
}

test('asset-set and custody identity are host-qualified and input-order independent', () => {
  const assets = [asset('codex', digest('b')), asset('claude-code', digest('c'))];
  const forward = buildGeneratedAssetManifest({ assets, sourceFormat: 'composed-v1' });
  const reverse = buildGeneratedAssetManifest({ assets: [...assets].reverse(), sourceFormat: 'composed-v1' });

  assert.equal(forward.assetSetId, reverse.assetSetId);
  assert.equal(forward.documentDigest, reverse.documentDigest);
  assert.deepEqual(forward.assets, reverse.assets);
  assert.deepEqual(
    forward.assets.map(({ path, host }) => [path, host]),
    [
      ['skills/planr-demo/SKILL.md', 'claude-code'],
      ['skills/planr-demo/SKILL.md', 'codex'],
    ],
  );

  const forwardCustody = buildCustodyManifest({
    assets,
    sourceFormat: 'composed-v1',
    assetSetId: forward.assetSetId,
  });
  const reverseCustody = buildCustodyManifest({
    assets: [...assets].reverse(),
    sourceFormat: 'composed-v1',
    assetSetId: reverse.assetSetId,
  });
  assert.equal(forwardCustody.custodyDigest, reverseCustody.custodyDigest);
  assert.deepEqual(forwardCustody.assets, reverseCustody.assets);
});

test('duplicate path and host identities fail before a manifest is produced', () => {
  const duplicate = [asset('codex', digest('b')), asset('codex', digest('c'))];
  for (const build of [
    () => deriveAssetSetId(duplicate),
    () => buildGeneratedAssetManifest({ assets: duplicate, sourceFormat: 'composed-v1' }),
    () => buildCustodyManifest({ assets: duplicate, sourceFormat: 'composed-v1', assetSetId: 'sas_test' }),
  ]) {
    assert.throws(build, { code: 'E_ASSET_IDENTITY_COLLISION' });
  }
});

test('custody implementation remains ordinary text without embedded NUL bytes', () => {
  const source = readFileSync(join(
    import.meta.dirname,
    '..',
    '..',
    'packages',
    'skill-runtime',
    'src',
    'manifests',
    'custody.mjs',
  ));
  assert.equal(source.includes(0), false);
});
