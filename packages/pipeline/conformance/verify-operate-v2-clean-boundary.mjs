#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkOperateRuntimePurity } from '../scripts/check-operate-runtime-purity.mjs';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const phaseRoot = join(root, '.planr/products/operate-2.0/phases');
const downstreamReports = [
  ['OpenPlanr', 'OPENPLANR_OPERATE_RESET.md'],
  ['skills', 'RUNTIME_ASSETS_SKILLS_RESET.md'],
  ['marketplace', 'MARKETPLACE_OPERATE_RESET.md'],
];

function runJson(relativePath) {
  const result = spawnSync(process.execPath, [join(root, relativePath)], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${relativePath} failed:\n${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

const absence = runJson('conformance/verify-operate-v2-absence.mjs');
const runtime = runJson('conformance/verify-operating-runtime-v2.mjs');
const evidence = runJson('conformance/verify-operate-v2-evidence.mjs');
const operatingIntelligence = runJson('conformance/verify-operate-v2-operating-intelligence.mjs');
const governedExecution = runJson('conformance/verify-operate-v2-governed-execution.mjs');
const productExperience = runJson('conformance/verify-operate-v2-product-experience.mjs');

const purity = checkOperateRuntimePurity(root);
assert.equal(purity.ok, true);

const hasPrivateReports = downstreamReports.every(([, report]) =>
  existsSync(join(phaseRoot, report)),
);
const downstream = hasPrivateReports
  ? downstreamReports.map(([repository, report]) => {
      const content = readFileSync(join(phaseRoot, report), 'utf8');
      assert.match(
        content,
        /\*\*Status:\*\* COMPLETE/u,
        `${report} must record completed owner evidence`,
      );
      return {
        repository,
        status: 'COMPLETE',
        report: `.planr/products/operate-2.0/phases/${report}`,
      };
    })
  : [];

process.stdout.write(
  `${JSON.stringify({
    status: hasPrivateReports ? 'PASS' : 'NOT_APPLICABLE',
    local: {
      status: 'PASS',
      absence,
      runtime,
      evidence,
      operatingIntelligence,
      governedExecution,
      productExperience,
      packagePurity: purity.ok,
    },
    downstream,
  })}\n`,
);
