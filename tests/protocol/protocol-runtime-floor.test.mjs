import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { buildArtifactEnvelopeMetadataSchemas } from '../../packages/protocol/scripts/artifact-envelope-definitions.mjs';
import { ARTIFACT_ENVELOPE_METADATA_SCHEMAS } from '../../packages/protocol/src/generated/artifact-envelope-metadata.mjs';
import { assertArtifactEnvelopeMetadata } from '../../packages/protocol/src/large-object-contracts.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const protocol = join(root, 'packages/protocol');
const metadataPath = 'src/generated/artifact-envelope-metadata.mjs';
const floorNode = process.env.OPENPLANR_PROTOCOL_FLOOR_EXECUTABLE;
// The advertised minimum, as package metadata declares it: ">=<version>".
const floor = JSON.parse(readFileSync(join(protocol, 'package.json'), 'utf8')).engines.node.replace(
  /^>=/u,
  '',
);

test('minimum-runtime CI creates ignored Protocol projections before switching to the floor', () => {
  const workflow = load(
    readFileSync(join(root, '.github/workflows/protocol-runtime-floor.yml'), 'utf8'),
  );
  const steps = workflow.jobs['runtime-floor'].steps;
  const install = steps.findIndex((step) => step.run === 'npm ci');
  const generation = steps.findIndex(
    (step) => step.run === 'node packages/protocol/scripts/generate-protocol-assets.mjs',
  );
  const minimum = steps.findIndex((step) => step.with?.['node-version'] === floor);
  assert.ok(steps.slice(0, install).some((step) => Number(step.with?.['node-version']) === 24));
  assert.ok(install >= 0 && generation > install && minimum > generation);
  assert.ok(
    steps
      .slice(minimum + 1)
      .some(
        (step) =>
          step.env?.OPENPLANR_PROTOCOL_FLOOR_EXECUTABLE === 'node' &&
          step.run === 'node --test tests/protocol/protocol-runtime-floor.test.mjs',
      ),
  );
});

function metadata(shared = false) {
  const artifact = {
    id: 'home',
    kind: 'html',
    title: 'Home',
    sha256: 'a'.repeat(64),
    viewport: { width: 800, height: 600 },
    colorScheme: 'light',
  };
  return shared
    ? {
        schemaVersion: '1.1.0',
        artifacts: [{ ...artifact, sourceId: 'source-home' }],
        sources: [{ id: 'source-home', kind: 'html', sha256: artifact.sha256 }],
        viewer: { mode: 'single', activeArtifactId: 'home' },
      }
    : {
        schemaVersion: '1.0.0',
        artifacts: [artifact],
        viewer: { mode: 'single', activeArtifactId: 'home' },
      };
}

test('generated browser metadata schemas exactly derive from the owned envelope schemas', () => {
  assert.deepEqual(ARTIFACT_ENVELOPE_METADATA_SCHEMAS, buildArtifactEnvelopeMetadataSchemas());
  assert.ok(Object.isFrozen(ARTIFACT_ENVELOPE_METADATA_SCHEMAS));
  for (const shared of [false, true]) {
    const value = metadata(shared);
    assert.equal(assertArtifactEnvelopeMetadata(value), value);
  }
});

test('metadata assertions reject accessors and non-JSON fields before version dispatch', () => {
  let reads = 0;
  const accessor = metadata();
  Object.defineProperty(accessor, 'schemaVersion', {
    enumerable: true,
    get() {
      reads++;
      return '1.0.0';
    },
  });
  assert.throws(() => assertArtifactEnvelopeMetadata(accessor), TypeError);
  assert.equal(reads, 0);
  const hidden = metadata();
  Object.defineProperty(hidden, 'schemaVersion', { value: '1.0.0', enumerable: false });
  assert.throws(() => assertArtifactEnvelopeMetadata(hidden), TypeError);
  const sparse = metadata();
  sparse.artifacts.length = 2;
  assert.throws(() => assertArtifactEnvelopeMetadata(sparse), TypeError);
});

test('Protocol root and browser exports import and validate on the advertised Node floor', {
  skip:
    !floorNode && `Set OPENPLANR_PROTOCOL_FLOOR_EXECUTABLE to the actual Node ${floor} executable.`,
}, () => {
  const proof = execFileSync(
    floorNode,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    assert.equal(process.version, 'v${floor}', 'The minimum-runtime proof requires actual Node ${floor}.');
    const root = await import('@openplanr/protocol');
    const browser = await import('@openplanr/protocol/browser-contracts');
    const resources = await import('@openplanr/protocol/large-object-contracts');
    const contracts = await import('@openplanr/protocol/contracts');
    const value = ${JSON.stringify(metadata(true))};
    assert.equal(resources.assertArtifactEnvelopeMetadata(value), value);
    const preview = {schemaVersion:'1.0.0',channel:'A'.repeat(43),type:'ready',viewId:'home'};
    assert.equal(root.assertSharingSecurityContract(preview, 'preview-bridge-message'), preview);
    assert.deepEqual(contracts.validateProtocolArtifact('preview-bridge-message', preview, {protocolVersion:'1.17.0'}), []);
    assert.ok(browser.protocolAssetUrl('preview-bridge-message', {protocolVersion:'1.17.0'}).href.endsWith('/v1.17.0/preview-bridge-message.schema.json'));
    console.log(process.version + ' root/browser/package exports PASS');
  `,
    ],
    { cwd: protocol, encoding: 'utf8' },
  );
  assert.ok(proof.includes(`v${floor} root/browser/package exports PASS`), proof);
  const output = execFileSync(floorNode, ['scripts/generate-protocol-assets.mjs', '--check'], {
    cwd: protocol,
    encoding: 'utf8',
  });
  assert.match(output, /Checked \d+ Protocol assets/);
});

test('clean generation bootstraps metadata without ambient generated inputs or executing drift', () => {
  const directory = mkdtempSync(join(tmpdir(), 'planr-protocol-schema-bootstrap-'));
  try {
    const copy = join(directory, 'packages/protocol');
    cpSync(protocol, copy, {
      recursive: true,
      filter: (path) => !['node_modules', '.git', 'projections'].includes(basename(path)),
    });
    cpSync(join(root, 'skills'), join(directory, 'skills'), { recursive: true });
    // The additive command registry binds these exact CLI-owned source bytes.
    // Keep the production generator fail-closed on missing prerequisites.
    const commandDirectory = 'packages/cli/src/cli/commands';
    mkdirSync(join(directory, commandDirectory), { recursive: true });
    for (const filename of ['server.ts', 'artifact.ts'])
      cpSync(join(root, commandDirectory, filename), join(directory, commandDirectory, filename));
    const generated = join(copy, metadataPath);
    const expected = readFileSync(join(protocol, metadataPath));
    rmSync(generated);
    const executable = floorNode || process.execPath;
    execFileSync(executable, ['scripts/generate-protocol-assets.mjs'], { cwd: copy });
    assert.deepEqual(readFileSync(generated), expected);
    const commandRegistry = 'registry/v1.17.0/commands.json';
    assert.deepEqual(
      readFileSync(join(copy, commandRegistry)),
      readFileSync(join(protocol, commandRegistry)),
      'cold generation retains the exact CLI source identities',
    );
    const poison = "throw new Error('UNTRUSTED_GENERATED_MODULE_EXECUTED');\n";
    writeFileSync(generated, poison);
    const check = spawnSync(executable, ['scripts/generate-protocol-assets.mjs', '--check'], {
      cwd: copy,
      encoding: 'utf8',
    });
    assert.equal(check.status, 1);
    assert.match(check.stderr, /Generated Protocol assets drifted/);
    assert.doesNotMatch(check.stderr, /UNTRUSTED_GENERATED_MODULE_EXECUTED/);
    assert.equal(readFileSync(generated, 'utf8'), poison);
    execFileSync(executable, ['scripts/generate-protocol-assets.mjs'], { cwd: copy });
    assert.deepEqual(readFileSync(generated), expected);
    execFileSync(executable, ['scripts/generate-protocol-assets.mjs', '--check'], { cwd: copy });
    rmSync(join(directory, commandDirectory, 'server.ts'));
    const missingSource = spawnSync(
      executable,
      ['scripts/generate-protocol-assets.mjs', '--check'],
      {
        cwd: copy,
        encoding: 'utf8',
      },
    );
    assert.equal(missingSource.status, 1);
    assert.match(missingSource.stderr, /ENOENT/);
    assert.match(missingSource.stderr, /commands\/server\.ts/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
