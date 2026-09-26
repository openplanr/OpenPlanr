import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packOperateV2DevelopmentSnapshot } from '../../scripts/check-operate-runtime-purity.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-operate-v2-product-dogfood-'));

after(() => rmSync(temporaryRoot, { recursive: true, force: true }));

test('external installed package certifies both contained product domains offline', {
  timeout: 180_000,
}, () => {
  const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'package'), {
    sourceRoot,
  });
  const consumer = join(temporaryRoot, 'external-consumer');
  const installed = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installed, { recursive: true });
  const extracted = spawnSync(
    'tar',
    ['-xzf', packed.tarballPath, '-C', installed, '--strip-components=1'],
    { encoding: 'utf8' },
  );
  assert.equal(extracted.status, 0, extracted.stderr);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module', private: true }));
  const runner = join(consumer, 'verify-product.mjs');
  writeFileSync(
    runner,
    [
      "import { verifyOperateV2ProductExperience } from './node_modules/planr-pipeline/conformance/verify-operate-v2-product-experience.mjs';",
      'process.stdout.write(JSON.stringify(await verifyOperateV2ProductExperience()));',
    ].join('\n'),
  );
  const result = spawnSync(process.execPath, [runner], {
    cwd: consumer,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: process.env.PATH,
      HOME: join(temporaryRoot, 'isolated-home'),
      npm_config_ignore_scripts: 'true',
      npm_config_offline: 'true',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.domains, ['business', 'software']);
  assert.deepEqual(report.safety, {
    networkAttempts: 0,
    credentialReads: 0,
    externalEffects: 0,
    realEffects: 0,
    containedEffects: 3,
    modelDispatches: 0,
  });
  assert.equal(report.journeys[0].rollback.status, 'succeeded');
  assert.equal(report.journeys[1].rollback, null);
  for (const journey of report.journeys) {
    assert.equal(journey.execution.acknowledgementLossRecovered, true);
    assert.equal(journey.execution.divergentRetry.effects, 0);
    assert.equal(journey.verification.revisit, true);
  }
  assert.equal(result.stdout.includes(sourceRoot), false);
});
