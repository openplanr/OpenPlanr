import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { packOperateV2DevelopmentSnapshot } from '../../scripts/check-operate-runtime-purity.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const node20Executable = process.env.PLANR_NODE20_EXECUTABLE;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

test('complete clean packed surface assertion executes under exact Node 20.0.0', {
  timeout: 180_000,
  skip: node20Executable ? false : 'PLANR_NODE20_EXECUTABLE is not configured',
}, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-surface-node20-'));
  try {
    assert.equal(run(node20Executable, ['--version']).stdout.trim(), 'v20.0.0');
    const packed = packOperateV2DevelopmentSnapshot(join(temporaryRoot, 'pack'), {
      sourceRoot: root,
    });
    const consumer = join(temporaryRoot, 'consumer');
    const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
    mkdirSync(installedPackage, { recursive: true });
    run('tar', ['-xzf', packed.tarballPath, '-C', installedPackage, '--strip-components=1']);
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
      join(consumer, 'verify.mjs'),
      `
          import assert from 'node:assert/strict';
          import { readFileSync } from 'node:fs';
          import { resolve } from 'node:path';
          import {
            assertOperateExperienceSurfaceV1,
            validateOperateExperienceSurfaceV1,
          } from 'planr-pipeline/schemas/v1.2.0/operate-experience-surface.mjs';

          const packageRoot = resolve('node_modules/planr-pipeline');
          const view = JSON.parse(readFileSync(resolve(
            packageRoot,
            'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json',
          ), 'utf8'))['operate-experience-view'];
          const surface = {
            ok: true,
            kind: 'operate-experience-surface',
            schemaVersion: '1.0.0',
            protocolVersion: '2.0.0',
            surface: 'today',
            readOnly: true,
            mutationEnabled: true,
            scopeId: view.scopeId,
            domainId: view.domainId,
            domainVersion: view.domainVersion,
            actorId: view.actorId,
            accessLevel: view.accessLevel,
            generatedAt: view.generatedAt,
            eventHead: view.eventHead,
            viewHash: view.viewHash,
            status: 'ready',
            reasonCodes: [],
            data: {
              attention: view.attention,
              domainMetrics: view.domainMetrics,
              activeCycle: view.cycles[0] ?? null,
              inbox: view.inbox,
              actions: view.actions,
              outcomes: view.outcomes,
              allowedActions: view.allowedActions,
            },
          };
          assert.deepEqual(validateOperateExperienceSurfaceV1(surface), []);
          assert.equal(assertOperateExperienceSurfaceV1(surface), surface);
          const hostile = structuredClone(surface);
          hostile.data.allowedActions = [{
            subjectId: 'cycle-1',
            action: {
              tool: 'operate.cycle.get',
              arguments: { cycleId: 'cycle-1', body: { private: true } },
              label: 'Refresh',
              effect: 'read-only',
            },
          }];
          assert.ok(validateOperateExperienceSurfaceV1(hostile).length > 0);
				`,
    );
    run(node20Executable, ['verify.mjs'], { cwd: consumer });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
