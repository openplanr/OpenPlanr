import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  assertOperateExperienceSurfaceV1,
  validateOperateExperienceSurfaceV1,
} from 'planr-pipeline/schemas/v1.2.0/operate-experience-surface.mjs';
import { selectOperateExperienceSurface } from '../../lib/dashboard/operate-experience-reader.mjs';
import { deriveDashboardSchemaGenerationValues } from '../../scripts/generate-dashboard-surface-schema-data.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

const fixture = JSON.parse(
  await readFile(
    new URL(
      '../../conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
      import.meta.url,
    ),
    'utf8',
  ),
)['operate-experience-view'];
const binding = {
  actorId: fixture.actorId,
  scopeId: fixture.scopeId,
  domainId: fixture.domainId,
  domainVersion: fixture.domainVersion,
};
const clone = (value) => structuredClone(value);
const REVIEW_SCHEMA_EXPORTS = Object.freeze([
  ['OPERATE_ALLOWED_ACTION_SCHEMA', 'operate-allowed-action.schema.json'],
  ['OPERATE_EXPERIENCE_VIEW_SCHEMA', 'operate-experience-view.schema.json'],
  ['OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA', 'operate-review-bound-submission.schema.json'],
  ['OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA', 'operate-review-display-workspace.schema.json'],
  ['OPERATING_ASSIGNMENT_SCHEMA', 'operating-assignment.schema.json'],
  ['OPERATING_EVIDENCE_RESOLUTION_SCHEMA', 'operating-evidence-resolution.schema.json'],
  ['OPERATING_REVIEW_READ_SCHEMA', 'operating-review-read.schema.json'],
  ['OPERATING_REVIEW_RECEIPT_SCHEMA', 'operating-review-receipt.schema.json'],
  ['OPERATING_REVIEW_SCHEMA', 'operating-review.schema.json'],
  ['OPERATING_TRACE_MATRIX_SCHEMA', 'operating-trace-matrix.schema.json'],
]);
const SURFACE_SCHEMA_EXPORTS = Object.freeze([
  [
    'OPERATE_ACTION_DISPLAY_WORKSPACE_SCHEMA',
    'schemas/v1.2.0/operate-action-display-workspace.schema.json',
  ],
  [
    'OPERATE_CYCLE_DISPLAY_WORKSPACE_SCHEMA',
    'schemas/v1.2.0/operate-cycle-display-workspace.schema.json',
  ],
  [
    'OPERATE_RECOVERY_DISPLAY_SURFACE_SCHEMA',
    'schemas/v1.2.0/operate-recovery-display-surface.schema.json',
  ],
  [
    'OPERATE_EXECUTIVE_BOARD_DISPLAY_SURFACE_SCHEMA',
    'schemas/v1.2.0/operate-executive-board-display-surface.schema.json',
  ],
  [
    'OPERATE_EXPERIENCE_DISPLAY_SURFACE_SCHEMA',
    'schemas/v1.2.0/operate-experience-display-surface.schema.json',
  ],
  [
    'OPERATE_EXPERIENCE_AUDIT_DISPLAY_SURFACE_SCHEMA',
    'schemas/v1.2.0/operate-experience-audit-display-surface.schema.json',
  ],
  ['OPERATE_EXPERIENCE_SURFACE_SCHEMA', 'schemas/v1.2.0/operate-experience-surface.schema.json'],
  ['OPERATE_API_ENVELOPE_SCHEMA', 'schemas/v2.0.0/operate-api-envelope.schema.json'],
  ['OPERATE_ALLOWED_ACTION_SCHEMA', 'schemas/v2.0.0/operate-allowed-action.schema.json'],
  ['OPERATE_EXPERIENCE_VIEW_SCHEMA', 'schemas/v2.0.0/operate-experience-view.schema.json'],
  [
    'OPERATE_REVIEW_BOUND_SUBMISSION_SCHEMA',
    'schemas/v2.0.0/operate-review-bound-submission.schema.json',
  ],
  [
    'OPERATE_REVIEW_DISPLAY_WORKSPACE_SCHEMA',
    'schemas/v2.0.0/operate-review-display-workspace.schema.json',
  ],
  ['OPERATING_ASSIGNMENT_SCHEMA', 'schemas/v2.0.0/operating-assignment.schema.json'],
  ['OPERATING_FINDING_SCHEMA', 'schemas/v2.0.0/operating-finding.schema.json'],
  ['OPERATE_EXPERIENCE_PREVIEW_SCHEMA', 'schemas/v2.0.0/operate-experience-preview.schema.json'],
  ['OPERATING_WORK_LEDGER_SCHEMA', 'schemas/v2.0.0/operating-work-ledger.schema.json'],
  ['OPERATING_DELIVERY_ROUTE_SCHEMA', 'schemas/v2.0.0/operating-delivery-route.schema.json'],
  [
    'OPERATING_EVIDENCE_RESOLUTION_SCHEMA',
    'schemas/v2.0.0/operating-evidence-resolution.schema.json',
  ],
  ['OPERATING_EXECUTION_RESULT_SCHEMA', 'schemas/v2.0.0/operating-execution-result.schema.json'],
  [
    'OPERATING_GOVERNED_OPERATION_SCHEMA',
    'schemas/v2.0.0/operating-governed-operation.schema.json',
  ],
  ['OPERATING_REVIEW_SCHEMA', 'schemas/v2.0.0/operating-review.schema.json'],
  ['OPERATING_REVIEW_READ_SCHEMA', 'schemas/v2.0.0/operating-review-read.schema.json'],
  ['OPERATING_REVIEW_RECEIPT_SCHEMA', 'schemas/v2.0.0/operating-review-receipt.schema.json'],
  ['OPERATING_TRACE_MATRIX_SCHEMA', 'schemas/v2.0.0/operating-trace-matrix.schema.json'],
]);

test('generated surface schema data is deterministic and check mode detects drift', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'planr-surface-generation-'));
  const generated = join(temporaryRoot, 'operate-experience-surface-schema-data.mjs');
  const reviewGenerated = join(temporaryRoot, 'operate-review-schema-data.mjs');
  const codecGenerated = join(temporaryRoot, 'operate-schema-token-codec.mjs');
  try {
    for (let index = 0; index < 2; index += 1) {
      const result = spawnSync(
        process.execPath,
        [
          'scripts/generate-dashboard-surface-schema-data.mjs',
          '--output',
          generated,
          '--review-output',
          reviewGenerated,
          '--codec-output',
          codecGenerated,
        ],
        { cwd: root, encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      const bytes = await readFile(generated, 'utf8');
      const reviewBytes = await readFile(reviewGenerated, 'utf8');
      const codecBytes = await readFile(codecGenerated, 'utf8');
      if (index === 0) {
        await writeFile(join(temporaryRoot, 'first.mjs'), bytes);
        await writeFile(join(temporaryRoot, 'review-first.mjs'), reviewBytes);
        await writeFile(join(temporaryRoot, 'codec-first.mjs'), codecBytes);
      } else {
        assert.equal(bytes, await readFile(join(temporaryRoot, 'first.mjs'), 'utf8'));
        assert.equal(reviewBytes, await readFile(join(temporaryRoot, 'review-first.mjs'), 'utf8'));
        assert.equal(codecBytes, await readFile(join(temporaryRoot, 'codec-first.mjs'), 'utf8'));
      }
    }
    const reviewExports = [
      ...(await readFile(reviewGenerated, 'utf8')).matchAll(/^export const ([A-Z0-9_]+) =/gmu),
    ].map((match) => match[1]);
    assert.equal(reviewExports.length, 10);
    assert.deepEqual(reviewExports, [...reviewExports].sort());
    assert.deepEqual(
      reviewExports,
      REVIEW_SCHEMA_EXPORTS.map(([exportName]) => `${exportName}_REVIEW_SLICE`).sort(),
    );
    const surfaceBytes = await readFile(generated, 'utf8');
    assert.match(surfaceBytes, /from "\.\/operate-review-schema-data\.mjs";/u);
    assert.match(surfaceBytes, /\/\* @__PURE__ \*\/ decodeDashboardSchema/u);
    assert.match(
      await readFile(reviewGenerated, 'utf8'),
      /\/\* @__PURE__ \*\/ decodeDashboardSchema/u,
    );
    assert.doesNotMatch(surfaceBytes, /JSON\.parse/u);
    assert.doesNotMatch(await readFile(reviewGenerated, 'utf8'), /JSON\.parse/u);
    const nonce = `?test=${Date.now()}`;
    const startedAt = performance.now();
    const surfaceModule = await import(`${pathToFileURL(generated).href}${nonce}`);
    const reviewModule = await import(`${pathToFileURL(reviewGenerated).href}${nonce}`);
    const decodeDurationMs = performance.now() - startedAt;
    assert.ok(
      decodeDurationMs < 1_000,
      `dashboard schema decode took ${decodeDurationMs.toFixed(1)}ms`,
    );
    assert.equal(Object.keys(surfaceModule).length, 24);
    assert.equal(Object.keys(reviewModule).length, 10);
    const derived = deriveDashboardSchemaGenerationValues({ sourceRoot: root });
    assert.deepEqual(
      Object.keys(surfaceModule).sort(),
      SURFACE_SCHEMA_EXPORTS.map(([exportName]) => exportName).sort(),
    );
    assert.deepEqual(Object.keys(surfaceModule).sort(), Object.keys(derived.surface).sort());
    assert.deepEqual(Object.keys(reviewModule).sort(), Object.keys(derived.review).sort());
    for (const [exportName, relativePath] of SURFACE_SCHEMA_EXPORTS) {
      const canonical = JSON.parse(await readFile(join(root, relativePath), 'utf8'));
      assert.deepEqual(surfaceModule[exportName], canonical, exportName);
      assert.equal(
        JSON.stringify(surfaceModule[exportName]),
        JSON.stringify(derived.surface[exportName]),
        `${exportName} decoded key order`,
      );
    }
    for (const [exportName, expected] of Object.entries(derived.review)) {
      assert.deepEqual(reviewModule[exportName], expected, exportName);
      assert.equal(
        JSON.stringify(reviewModule[exportName]),
        JSON.stringify(expected),
        `${exportName} decoded key order`,
      );
    }
    let exactShared = 0;
    let partialSlices = 0;
    for (const [exportName, filename] of REVIEW_SCHEMA_EXPORTS) {
      const canonical = JSON.parse(await readFile(join(root, 'schemas/v2.0.0', filename), 'utf8'));
      assert.deepEqual(surfaceModule[exportName], canonical, exportName);
      const slice = reviewModule[`${exportName}_REVIEW_SLICE`];
      if (JSON.stringify(slice) === JSON.stringify(canonical)) exactShared += 1;
      else partialSlices += 1;
    }
    assert.equal(exactShared, 6);
    assert.equal(partialSlices, 4);
    const { decodeDashboardSchema } = await import(`${pathToFileURL(codecGenerated).href}${nonce}`);
    const firstPayload = (await readFile(reviewGenerated, 'utf8')).match(
      /decodeDashboardSchema\("([A-Za-z0-9+/=]+)"\)/u,
    )?.[1];
    assert.equal(typeof firstPayload, 'string');
    assert.deepEqual(
      decodeDashboardSchema(firstPayload),
      reviewModule[Object.keys(reviewModule).sort()[0]],
    );
    for (const invalidPayload of [
      '',
      'not-base64',
      'AB==',
      Buffer.from([0xff]).toString('base64'),
      Buffer.from([0x06, 0x80, 0x00]).toString('base64'),
      Buffer.from([0x06, 0x02, 0x00, 0x00, 0x00, 0x00]).toString('base64'),
      Buffer.from([0x06, 0x01, 0xff, 0xff, 0xff, 0xff, 0x0f, 0x00]).toString('base64'),
      Buffer.from([0x06, 0x01, 0x00, 0x03, 0x00]).toString('base64'),
      Buffer.concat([Buffer.from(firstPayload, 'base64'), Buffer.from([0x00])]).toString('base64'),
    ]) {
      assert.throws(() => decodeDashboardSchema(invalidPayload), {
        code: 'E_DASHBOARD_SCHEMA_TOKEN_INVALID',
      });
    }
    await writeFile(generated, `${await readFile(generated, 'utf8')}\n`);
    const drift = spawnSync(
      process.execPath,
      [
        'scripts/generate-dashboard-surface-schema-data.mjs',
        '--check',
        '--output',
        generated,
        '--review-output',
        reviewGenerated,
        '--codec-output',
        codecGenerated,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /E_DASHBOARD_SURFACE_SCHEMA_DRIFT/);

    await writeFile(generated, await readFile(join(temporaryRoot, 'first.mjs'), 'utf8'));
    await writeFile(reviewGenerated, `${await readFile(reviewGenerated, 'utf8')}\n`);
    const reviewDrift = spawnSync(
      process.execPath,
      [
        'scripts/generate-dashboard-surface-schema-data.mjs',
        '--check',
        '--output',
        generated,
        '--review-output',
        reviewGenerated,
        '--codec-output',
        codecGenerated,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(reviewDrift.status, 1);
    assert.match(reviewDrift.stderr, /E_DASHBOARD_REVIEW_SCHEMA_DRIFT/);

    await writeFile(
      reviewGenerated,
      await readFile(join(temporaryRoot, 'review-first.mjs'), 'utf8'),
    );
    await writeFile(codecGenerated, `${await readFile(codecGenerated, 'utf8')}\n`);
    const codecDrift = spawnSync(
      process.execPath,
      [
        'scripts/generate-dashboard-surface-schema-data.mjs',
        '--check',
        '--output',
        generated,
        '--review-output',
        reviewGenerated,
        '--codec-output',
        codecGenerated,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(codecDrift.status, 1);
    assert.match(codecDrift.stderr, /E_DASHBOARD_SCHEMA_CODEC_DRIFT/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('public surface assertion runtime is browser-safe JavaScript without import attributes', async () => {
  for (const path of [
    'lib/dashboard/operate-experience-surface-contract.mjs',
    'lib/dashboard/generated/operate-experience-surface-schema-data.mjs',
    'lib/dashboard/generated/operate-review-schema-data.mjs',
    'lib/dashboard/generated/operate-schema-token-codec.mjs',
    'conformance/json-schema-validate.mjs',
  ]) {
    const source = await readFile(join(root, path), 'utf8');
    assert.doesNotMatch(source, /\b(?:with|assert)\s*\{\s*type\s*:/, path);
    assert.doesNotMatch(source, /from\s+["']node:|import\s*\(\s*["']node:/, path);
    assert.doesNotMatch(source, /\b(?:readFile|readFileSync|fetch)\s*\(/, path);
  }
});

test('public dashboard transport assertion accepts every non-subject surface selected from one canonical view', () => {
  for (const [surface, options] of [
    ['today', {}],
    ['cycles', {}],
    ['evidence', {}],
    ['outcomes', {}],
    ['history', {}],
    ['search', { query: 'retention' }],
    ['export', { format: 'json' }],
    ['export', { format: 'html' }],
  ]) {
    const selected = selectOperateExperienceSurface(fixture, {
      surface,
      binding,
      ...options,
    });
    assert.equal(selected.ok, true, surface);
    assert.equal(assertOperateExperienceSurfaceV1(selected), selected, surface);
    assert.deepEqual(validateOperateExperienceSurfaceV1(selected), [], surface);
  }
});

test('Today schema recursively rejects hostile collection values and contradictory status reasons', () => {
  const today = selectOperateExperienceSurface(fixture, {
    surface: 'today',
    binding,
  });
  assert.equal(today.ok, true);
  const hostile = [
    [
      'unknown inbox field',
      (value) => {
        value.data.inbox = [{ itemId: 'item-1', unknown: 'private' }];
      },
    ],
    [
      'unknown metric field',
      (value) => {
        value.data.domainMetrics = [{ metricId: 'metric-1', unknown: 'private' }];
      },
    ],
    [
      'unknown outcome field',
      (value) => {
        value.data.outcomes = [{ outcomeId: 'outcome-1', unknown: 'private' }];
      },
    ],
    [
      'private allowed action argument',
      (value) => {
        value.data.allowedActions = [
          {
            subjectId: 'cycle-1',
            action: {
              tool: 'operate.cycle.get',
              arguments: {
                cycleId: 'cycle-1',
                privatePath: '/private/project',
              },
              label: 'Refresh cycle',
              effect: 'read-only',
            },
          },
        ];
      },
    ],
    [
      'private allowed action body',
      (value) => {
        value.data.allowedActions = [
          {
            subjectId: 'cycle-1',
            action: {
              tool: 'operate.cycle.get',
              arguments: {
                cycleId: 'cycle-1',
                body: { private: true },
              },
              label: 'Refresh cycle',
              effect: 'read-only',
            },
          },
        ];
      },
    ],
    [
      'unknown allowed action field',
      (value) => {
        value.data.allowedActions = [
          {
            subjectId: 'cycle-1',
            action: {
              tool: 'operate.cycle.get',
              arguments: { cycleId: 'cycle-1' },
              label: 'Refresh cycle',
              effect: 'read-only',
              unknown: true,
            },
          },
        ];
      },
    ],
    [
      'ready with offline reason',
      (value) => {
        value.reasonCodes = ['OPERATE_OFFLINE'];
      },
    ],
  ];
  for (const [label, mutate] of hostile) {
    const value = clone(today);
    mutate(value);
    assert.notDeepEqual(validateOperateExperienceSurfaceV1(value), [], label);
    assert.throws(
      () => assertOperateExperienceSurfaceV1(value),
      {
        code: 'E_OPERATE_EXPERIENCE_SURFACE_INVALID',
      },
      label,
    );
  }
});
