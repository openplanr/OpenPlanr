import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as auditContract from '../../lib/dashboard/operate-experience-audit-display-contract.mjs';
import { selectOperateExperienceSurface } from '../../lib/dashboard/operate-experience-reader.mjs';
import * as auditSchema from '../../schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
import { collectFilePaths } from '../helpers/files.mjs';
import { pairedOpenPlanrTools } from '../helpers/paired-openplanr.mjs';
import { resolveWorkspaceDependencyRoot } from '../helpers/workspace-dependency.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { typescript, vite } = pairedOpenPlanrTools();
const node20Executable = process.env.PLANR_NODE20_EXECUTABLE;
const SCHEMA_SUBPATH = 'planr-pipeline/schemas/v1.2.0/operate-experience-audit-display-surface.mjs';
const CONTRACT_SUBPATH = 'planr-pipeline/dashboard/operate-experience-audit-display-contract';
const SCHEMA_EXPORTS = Object.freeze(
  [
    'OPERATE_EXPERIENCE_AUDIT_DISPLAY_SURFACE_SCHEMA_V1',
    'assertOperateExperienceAuditDisplaySurfaceV1',
    'validateOperateExperienceAuditDisplaySurfaceV1',
  ].sort(),
);
const CONTRACT_EXPORTS = Object.freeze(
  [...SCHEMA_EXPORTS, 'issueOperateExperienceAuditDisplaySurfaceV1'].sort(),
);
const CUSTODY = Object.freeze([
  'lib/dashboard/generated/operate-experience-surface-schema-data.mjs',
  'lib/dashboard/operate-experience-audit-display-contract.d.mts',
  'lib/dashboard/operate-experience-audit-display-contract.mjs',
  'lib/dashboard/operate-experience-reader.d.mts',
  'lib/dashboard/operate-experience-reader.mjs',
  'schemas/v1.2.0/operate-experience-audit-display-surface.d.mts',
  'schemas/v1.2.0/operate-experience-audit-display-surface.mjs',
  'schemas/v1.2.0/operate-experience-audit-display-surface.schema.json',
]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function auditFixture() {
  const view = JSON.parse(
    readFileSync(
      join(root, 'conformance/fixtures/operating-runtime-v2/experience-bridge-valid.json'),
      'utf8',
    ),
  )['operate-experience-view'];
  const ownerBinding = {
    actorId: view.actorId,
    scopeId: view.scopeId,
    domainId: view.domainId,
    domainVersion: view.domainVersion,
  };
  const payload = selectOperateExperienceSurface(view, {
    surface: 'history',
    binding: ownerBinding,
  });
  const binding = {
    ...ownerBinding,
    cycleId: 'cycle-packed',
    subjectId: null,
    surface: 'history',
    query: null,
    format: null,
    generatedAt: view.generatedAt,
    eventHead: view.eventHead,
    viewHash: view.viewHash,
  };
  return {
    binding,
    display: auditContract.issueOperateExperienceAuditDisplaySurfaceV1(payload, binding),
  };
}

function packInstalledConsumer(temporaryRoot) {
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
  const consumer = join(temporaryRoot, 'consumer');
  const installedPackage = join(consumer, 'node_modules', 'planr-pipeline');
  mkdirSync(installedPackage, { recursive: true });
  run('tar', [
    '-xzf',
    join(temporaryRoot, filename),
    '-C',
    installedPackage,
    '--strip-components=1',
  ]);
  cpSync(
    resolveWorkspaceDependencyRoot('@noble/hashes'),
    join(consumer, 'node_modules', '@noble', 'hashes'),
    { recursive: true },
  );
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  return { consumer, installedPackage };
}

test('audit verifier source, packed bytes, public exports, and declarations have exact parity', {
  timeout: 120_000,
  skip: typescript ? false : 'paired OpenPlanr TypeScript is required for declaration parity',
}, async () => {
  assert.deepEqual(Object.keys(auditSchema).sort(), SCHEMA_EXPORTS);
  assert.deepEqual(Object.keys(auditContract).sort(), CONTRACT_EXPORTS);

  const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(metadata.exports['./dashboard/operate-experience-audit-display-contract'], {
    types: './lib/dashboard/operate-experience-audit-display-contract.d.mts',
    import: './lib/dashboard/operate-experience-audit-display-contract.mjs',
  });
  assert.equal(metadata.exports['./schemas/*'], './schemas/*');
  assert.equal(metadata.dependencies['@noble/hashes'], '1.8.0');

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-audit-display-pack-'));
  try {
    const { consumer, installedPackage } = packInstalledConsumer(temporaryRoot);
    for (const relativePath of CUSTODY) {
      assert.deepEqual(
        readFileSync(join(installedPackage, relativePath)),
        readFileSync(join(root, relativePath)),
        relativePath,
      );
    }

    const installedSchema = await import(
      pathToFileURL(
        join(installedPackage, 'schemas/v1.2.0/operate-experience-audit-display-surface.mjs'),
      ).href
    );
    const installedContract = await import(
      pathToFileURL(
        join(installedPackage, 'lib/dashboard/operate-experience-audit-display-contract.mjs'),
      ).href
    );
    assert.deepEqual(Object.keys(installedSchema).sort(), SCHEMA_EXPORTS);
    assert.deepEqual(Object.keys(installedContract).sort(), CONTRACT_EXPORTS);

    const { display, binding } = auditFixture();
    assert.equal(
      installedContract.assertOperateExperienceAuditDisplaySurfaceV1(display, binding).integrity
        .contentHash,
      display.integrity.contentHash,
    );
    run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `Promise.all([import(${JSON.stringify(SCHEMA_SUBPATH)}), import(${JSON.stringify(CONTRACT_SUBPATH)})]);`,
      ],
      { cwd: consumer },
    );

    writeFileSync(
      join(consumer, 'index.mts'),
      [
        `import * as schema from ${JSON.stringify(SCHEMA_SUBPATH)};`,
        `import * as contract from ${JSON.stringify(CONTRACT_SUBPATH)};`,
        `import type { OperateAuditDisplayBindingV1, OperateAuditDisplayIntegrityV1, OperateExperienceAuditDisplaySurfacePayloadV1, OperateExperienceAuditDisplaySurfaceV1 } from ${JSON.stringify(CONTRACT_SUBPATH)};`,
        `const schemaNames = ${JSON.stringify(SCHEMA_EXPORTS)} as const;`,
        `const contractNames = ${JSON.stringify(CONTRACT_EXPORTS)} as const;`,
        'type SchemaMissing = Exclude<(typeof schemaNames)[number], keyof typeof schema>;',
        'type SchemaExtra = Exclude<keyof typeof schema, (typeof schemaNames)[number]>;',
        'type ContractMissing = Exclude<(typeof contractNames)[number], keyof typeof contract>;',
        'type ContractExtra = Exclude<keyof typeof contract, (typeof contractNames)[number]>;',
        'const exact: [SchemaMissing, SchemaExtra, ContractMissing, ContractExtra] extends [never, never, never, never] ? true : never = true;',
        `const binding = ${JSON.stringify(binding)} as OperateAuditDisplayBindingV1;`,
        `const display = ${JSON.stringify(display)} as OperateExperienceAuditDisplaySurfaceV1;`,
        'const payload: OperateExperienceAuditDisplaySurfacePayloadV1 = display.payload;',
        'const integrity: OperateAuditDisplayIntegrityV1 = display.integrity;',
        'void exact; void payload; void integrity;',
        'void schema.validateOperateExperienceAuditDisplaySurfaceV1(display, binding);',
        'void contract.assertOperateExperienceAuditDisplaySurfaceV1(display, binding);',
        'void contract.issueOperateExperienceAuditDisplaySurfaceV1(payload, binding);',
        '',
      ].join('\n'),
    );
    run(
      process.execPath,
      [
        typescript,
        '--noEmit',
        '--target',
        'ES2022',
        '--module',
        'Node16',
        '--moduleResolution',
        'Node16',
        join(consumer, 'index.mts'),
      ],
      { cwd: consumer },
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('packed audit verifier bundles synchronously without Node built-ins', {
  timeout: 120_000,
  skip: vite ? false : 'paired OpenPlanr Vite is required for the browser-bundle proof',
}, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-audit-display-vite-'));
  try {
    const { consumer } = packInstalledConsumer(temporaryRoot);
    const { display, binding } = auditFixture();
    const entry = join(consumer, 'entry.js');
    const config = join(consumer, 'vite.config.mjs');
    const output = join(consumer, 'dist');
    writeFileSync(
      entry,
      [
        `import { assertOperateExperienceAuditDisplaySurfaceV1 } from ${JSON.stringify(SCHEMA_SUBPATH)};`,
        `const display = ${JSON.stringify(display)};`,
        `const binding = ${JSON.stringify(binding)};`,
        'globalThis.__operateAuditDisplay = assertOperateExperienceAuditDisplaySurfaceV1(display, binding);',
        '',
      ].join('\n'),
    );
    writeFileSync(
      config,
      `export default ${JSON.stringify({
        root: consumer,
        build: {
          outDir: output,
          emptyOutDir: true,
          rollupOptions: { input: entry },
        },
      })};\n`,
    );
    run(process.execPath, [vite, 'build', '--config', config], { cwd: consumer });
    const bundle = collectFilePaths(output)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    assert.doesNotMatch(bundle, /node:(?:crypto|fs|path|url)/u);
    assert.doesNotMatch(bundle, /(?:createHash|readFileSync|protocol\/loader)/u);
    assert.match(bundle, /sha-256-jcs/u);
    assert.match(bundle, /operate-experience-audit-display-surface/u);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('packed audit verifier executes under exact Node 20.0.0', {
  timeout: 120_000,
  skip: node20Executable ? false : 'PLANR_NODE20_EXECUTABLE is not configured',
}, () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'planr-audit-display-node20-'));
  try {
    assert.equal(run(node20Executable, ['--version']).stdout.trim(), 'v20.0.0');
    const { consumer } = packInstalledConsumer(temporaryRoot);
    const { display, binding } = auditFixture();
    writeFileSync(
      join(consumer, 'verify.mjs'),
      [
        `import { assertOperateExperienceAuditDisplaySurfaceV1 } from ${JSON.stringify(CONTRACT_SUBPATH)};`,
        `const display = ${JSON.stringify(display)};`,
        `const binding = ${JSON.stringify(binding)};`,
        'assertOperateExperienceAuditDisplaySurfaceV1(display, binding);',
        '',
      ].join('\n'),
    );
    run(node20Executable, ['verify.mjs'], { cwd: consumer });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
