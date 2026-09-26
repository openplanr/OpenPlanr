import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { pairedOpenPlanrTools } from '../helpers/paired-openplanr.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { typescript } = pairedOpenPlanrTools();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`,
  );
  return result;
}

test('packed trace and Executive Board declarations reject invalid proof, relation, and mode combinations', {
  timeout: 120_000,
  skip: typescript ? false : 'paired OpenPlanr TypeScript is required for packed declaration proof',
}, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-board-types-pack-'));
  try {
    const packed = run(
      'npm',
      [
        'pack',
        '--ignore-scripts',
        '--json',
        '--cache',
        join(temporaryRoot, 'npm-cache'),
        '--pack-destination',
        temporaryRoot,
      ],
      { cwd: root },
    );
    const [{ filename }] = JSON.parse(packed.stdout);
    const consumerRoot = join(temporaryRoot, 'consumer');
    const installedRoot = join(consumerRoot, 'node_modules', 'planr-pipeline');
    mkdirSync(installedRoot, { recursive: true });
    run('tar', [
      '-xzf',
      join(temporaryRoot, filename),
      '-C',
      installedRoot,
      '--strip-components=1',
    ]);
    writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ type: 'module' }));
    writeFileSync(
      join(consumerRoot, 'index.mts'),
      [
        "import type { OperatingEventV2 } from 'planr-pipeline/protocol';",
        "import type { OperatingTraceEdgeV2, OperatingTraceNodeV2 } from 'planr-pipeline/operate/trace-matrix-v2';",
        "import type { OperatingExecutiveBoardCompatibilityV2, OperatingExecutiveBoardMaterializedV2 } from 'planr-pipeline/operate/executive-board-materialization-v2';",
        "type RequirementProof = Extract<OperatingTraceNodeV2, { locator: { kind: 'requirement' } }>['proofState'];",
        "type DeclaresEdge = Extract<OperatingTraceEdgeV2, { relation: 'declares' }>;",
        "const validProof: RequirementProof = 'pending';",
        "const validFrom: DeclaresEdge['from']['kind'] = 'absence';",
        "const validCompatibilityAuthority: OperatingExecutiveBoardCompatibilityV2['authoritativeForMutation'] = false;",
        "const validMaterializedEvent: OperatingExecutiveBoardMaterializedV2['materializedEventId'] = 'evt_board_00000001';",
        "declare const event: OperatingEventV2<'executive-board.materialized'>;",
        'const eventBoard: OperatingExecutiveBoardMaterializedV2 = event.payload;',
        '// @ts-expect-error a requirement cannot claim accepted proof',
        "const badProof: RequirementProof = 'accepted';",
        '// @ts-expect-error declares must originate from an absence',
        "const badFrom: DeclaresEdge['from']['kind'] = 'claim';",
        '// @ts-expect-error compatibility boards are never mutation-authoritative',
        "const badCompatibilityAuthority: OperatingExecutiveBoardCompatibilityV2['authoritativeForMutation'] = true;",
        '// @ts-expect-error materialized boards require a non-null Event identity',
        "const badMaterializedEvent: OperatingExecutiveBoardMaterializedV2['materializedEventId'] = null;",
        'void validProof; void validFrom; void validCompatibilityAuthority; void validMaterializedEvent; void eventBoard;',
        'void badProof; void badFrom; void badCompatibilityAuthority; void badMaterializedEvent;',
        '',
      ].join('\n'),
    );
    run(
      process.execPath,
      [
        typescript,
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'Node16',
        '--moduleResolution',
        'Node16',
        join(consumerRoot, 'index.mts'),
      ],
      { cwd: consumerRoot },
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
