import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const PACKED_WORKSPACE_PROOF_KIND = 'openplanr-packed-workspace-proof';
export const PACKED_WORKSPACE_PROOF_SCHEMA_VERSION = '1.2.0';
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_PROOF_BYTES = 4 * 1024 * 1024;

export const PACKED_WORKSPACE_REQUIRED_CHECKS = Object.freeze([
  'baseline.public-surface',
  'cli.alias-parity',
  'diagram.packed-runtime',
  'environment.node',
  'install.cli-only',
  'install.exports-and-assets',
  'install.full',
  'install.optional-boundary',
  'install.protocol-node-browser-workers',
  'operate.cli-owned-runtime',
  'operate.retired-pipeline-absence',
  'pack.archives',
  'pack.generated-skill-portability',
  'pack.payload-purity',
  'pack.protocol-assets',
]);

// Protocol 1.8 host packages own skill prompts. The deterministic pipeline
// tarball intentionally contains none; this exported name remains stable for
// existing proof readers while its value encodes the prompt-free boundary.
export const PACKED_WORKSPACE_GENERATED_SKILL_COUNT = 0;

const diagramGrammarRegistry = readJson(
  new URL('../../registry/v1.6.0/diagram-grammars.json', import.meta.url),
  'E_PACKED_WORKSPACE_DIAGRAM_CATALOG',
  'Diagram grammar catalog',
);

export const PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT = diagramGrammarRegistry.grammars.length;

export const PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS = Object.freeze({
  originalSchemas: 180,
  originalRegistries: 12,
  successorSchemas: 48,
  successorSchemasV15: 13,
  successorSchemasV16: 19,
  successorSchemasV17: 16,
  successorRegistries: 12,
  successorRegistriesV15: 7,
  successorRegistriesV16: 2,
  successorRegistriesV17: 3,
});

export class PackedWorkspaceProofError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PackedWorkspaceProofError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new PackedWorkspaceProofError(code, message);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function packedWorkspaceProofDigest(proof) {
  const { proofDigest: _proofDigest, ...boundProof } = proof ?? {};
  return sha256(JSON.stringify(stable(boundProof)));
}

function readJson(path, code, subject) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(code, `${subject} is not readable JSON.`);
  }
}

function assertPlainObject(value, code, subject) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${subject} must be an object.`);
  }
  return value;
}

function assertExactKeys(value, expected, code, subject) {
  const actual = Object.keys(assertPlainObject(value, code, subject)).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(code, `${subject} has an unsupported shape.`);
  }
}

export function readPackedWorkspaceProof(path) {
  const selected = resolve(path);
  if (!existsSync(selected)) {
    fail('E_PACKED_WORKSPACE_PROOF_MISSING', 'The packed-workspace proof does not exist.');
  }
  const stat = lstatSync(selected);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROOF_BYTES) {
    fail('E_PACKED_WORKSPACE_PROOF_UNSAFE', 'The packed-workspace proof is not a bounded regular file.');
  }
  return readJson(selected, 'E_PACKED_WORKSPACE_PROOF_INVALID', 'The packed-workspace proof');
}

function inventoryTree(root) {
  const lexicalRoot = resolve(root);
  const rootStat = lstatSync(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', 'A packed package root is unsafe.');
  }
  const realRoot = realpathSync(lexicalRoot);
  const entries = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const stat = lstatSync(absolute);
      const path = relative(realRoot, absolute).split(sep).join('/');
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', `Packed package custody contains a symlink at ${path}.`);
      }
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({
          path,
          mode: stat.mode & 0o777,
          bytes: bytes.byteLength,
          sha256: sha256(bytes),
        });
      } else {
        fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', `Packed package custody contains a special entry at ${path}.`);
      }
    }
  };
  visit(realRoot);
  return entries;
}

function npmCommand() {
  if (process.env.npm_execpath) {
    return { command: process.execPath, prefix: [process.env.npm_execpath] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', prefix: [] };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', 'Current workspace package custody could not be reproduced.');
  }
  return result.stdout;
}

/**
 * Parse the single JSON array emitted by `npm pack --json`, tolerating lifecycle
 * output written before npm's machine report. Trailing non-JSON output remains a
 * hard failure so callers never accept an ambiguous or partial report.
 */
export function parseNpmPackJson(output) {
  const raw = String(output);
  for (let offset = raw.indexOf('['); offset >= 0; offset = raw.indexOf('[', offset + 1)) {
    try {
      const candidate = JSON.parse(raw.slice(offset).trim());
      if (Array.isArray(candidate)) return candidate;
    } catch {
      // A lifecycle log may itself contain `[`. Continue to the next candidate.
    }
  }
  return null;
}

function capturePackage(root, destination) {
  mkdirSync(destination, { recursive: true });
  const npm = npmCommand();
  const raw = run(npm.command, [
    ...npm.prefix,
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    destination,
  ], {
    cwd: root,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
    },
  });
  const reports = parseNpmPackJson(raw);
  if (!reports) {
    fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', 'npm pack returned invalid custody metadata.');
  }
  if (!Array.isArray(reports) || reports.length !== 1 || typeof reports[0]?.filename !== 'string') {
    fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', 'npm pack did not return exactly one custody archive.');
  }
  const archive = join(destination, reports[0].filename);
  const extracted = join(destination, 'extracted');
  mkdirSync(extracted, { recursive: true });
  run('tar', ['-xzf', archive, '-C', extracted], { cwd: destination });
  const inventory = inventoryTree(join(extracted, 'package'));
  return {
    archiveSha256: sha256(readFileSync(archive)),
    payloadDigest: sha256(JSON.stringify(stable(inventory))),
  };
}

export function capturePackedWorkspaceCustody(workspaceRoot) {
  const selectedRoot = realpathSync(resolve(workspaceRoot));
  const temp = mkdtempSync(join(tmpdir(), 'openplanr-ecosystem-proof-'));
  try {
    return {
      cli: capturePackage(join(selectedRoot, 'packages/cli'), join(temp, 'cli')),
      pipeline: capturePackage(join(selectedRoot, 'packages/pipeline'), join(temp, 'pipeline')),
      protocol: capturePackage(join(selectedRoot, 'packages/protocol'), join(temp, 'protocol')),
    };
  } finally {
    const selectedTemp = realpathSync(temp);
    const parent = dirname(selectedTemp);
    if (
      parent !== realpathSync(tmpdir())
      || !selectedTemp.startsWith(join(parent, 'openplanr-ecosystem-proof-'))
    ) {
      fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', 'Refused to clean an unsafe proof workspace.');
    }
    rmSync(selectedTemp, { recursive: true, force: true });
  }
}

function assertDigest(value, code, subject) {
  if (!SHA256.test(value ?? '')) fail(code, `${subject} is not a SHA-256 digest.`);
}

function manifestCustody(workspaceRoot) {
  const rootManifestPath = join(workspaceRoot, 'package.json');
  const cliManifestPath = join(workspaceRoot, 'packages/cli/package.json');
  const pipelineManifestPath = join(workspaceRoot, 'packages/pipeline/package.json');
  const protocolManifestPath = join(workspaceRoot, 'packages/protocol/package.json');
  const ecosystemPath = join(workspaceRoot, 'ecosystem.json');
  const rootManifest = readJson(rootManifestPath, 'E_PACKED_WORKSPACE_PROOF_WORKSPACE', 'Root package manifest');
  const cliManifest = readJson(cliManifestPath, 'E_PACKED_WORKSPACE_PROOF_WORKSPACE', 'CLI package manifest');
  const pipelineManifest = readJson(pipelineManifestPath, 'E_PACKED_WORKSPACE_PROOF_WORKSPACE', 'Pipeline package manifest');
  const protocolManifest = readJson(protocolManifestPath, 'E_PACKED_WORKSPACE_PROOF_WORKSPACE', 'Protocol package manifest');
  const ecosystem = readJson(ecosystemPath, 'E_PACKED_WORKSPACE_PROOF_WORKSPACE', 'Generated ecosystem manifest');
  return {
    root: { manifest: rootManifest, digest: sha256(readFileSync(rootManifestPath)) },
    cli: { manifest: cliManifest, digest: sha256(readFileSync(cliManifestPath)) },
    pipeline: { manifest: pipelineManifest, digest: sha256(readFileSync(pipelineManifestPath)) },
    protocol: { manifest: protocolManifest, digest: sha256(readFileSync(protocolManifestPath)) },
    ecosystem,
  };
}

function assertGeneratedEcosystem(custody) {
  const { ecosystem, root, cli, pipeline, protocol } = custody;
  if (
    ecosystem?.kind !== 'openplanr-ecosystem'
    || !['local-snapshot', 'local-candidate'].includes(ecosystem?.releaseState)
    || ecosystem?.workspace?.package !== root.manifest.name
    || ecosystem?.workspace?.version !== root.manifest.version
    || ecosystem?.workspace?.manifestDigest !== root.digest
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_ECOSYSTEM', 'Generated workspace ecosystem custody is stale.');
  }
  for (const [key, expectedPath, selected] of [
    ['cli', 'packages/cli', cli],
    ['pipeline', 'packages/pipeline', pipeline],
    ['protocol', 'packages/protocol', protocol],
  ]) {
    const component = ecosystem.components?.[key];
    if (
      component?.package !== selected.manifest.name
      || component?.version !== selected.manifest.version
      || component?.path !== expectedPath
      || component?.manifestDigest !== selected.digest
    ) {
      fail('E_PACKED_WORKSPACE_PROOF_ECOSYSTEM', `Generated ${key} ecosystem custody is stale.`);
    }
  }
  if (
    ecosystem.compatibility?.cliOptionalPipeline?.package !== pipeline.manifest.name
    || ecosystem.compatibility?.cliOptionalPipeline?.version !== pipeline.manifest.version
    || ecosystem.compatibility?.cliOptionalPipeline?.exact !== true
    || cli.manifest.optionalDependencies?.[pipeline.manifest.name] !== pipeline.manifest.version
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_ECOSYSTEM', 'Generated CLI/pipeline compatibility custody is stale.');
  }
}

function assertPackageProof(proof, custody, packageCustody) {
  const expectedAliases = {
    openplanr: './bin/planr.js',
    opr: './bin/planr.js',
    planr: './bin/planr.js',
  };
  const cli = proof.packages.cli;
  const pipeline = proof.packages.pipeline;
  const protocol = proof.packages.protocol;
  if (protocol?.name !== '@openplanr/protocol' || protocol?.name !== custody.protocol.manifest.name
    || protocol?.version !== custody.protocol.manifest.version || custody.protocol.manifest.private === true) {
    fail('E_PACKED_WORKSPACE_PROOF_IDENTITY', 'Packed Protocol identity does not match the public workspace package.');
  }
  if (
    cli?.name !== custody.cli.manifest.name
    || cli?.version !== custody.cli.manifest.version
    || JSON.stringify(stable(cli?.binAliases)) !== JSON.stringify(stable(expectedAliases))
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_IDENTITY', 'Packed CLI identity does not match the current workspace.');
  }
  if (
    pipeline?.name !== custody.pipeline.manifest.name
    || pipeline?.version !== custody.pipeline.manifest.version
    || pipeline?.exportKeys !== 37
    || pipeline?.generatedSkillPortability?.skills !== PACKED_WORKSPACE_GENERATED_SKILL_COUNT
    || pipeline?.generatedSkillPortability?.violations !== 0
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_IDENTITY', 'Packed pipeline identity does not match the current workspace.');
  }
  for (const [key, selected] of [['cli', cli], ['pipeline', pipeline], ['protocol', protocol]]) {
    assertDigest(selected?.payloadDigest, 'E_PACKED_WORKSPACE_PROOF_INVALID', `${key} payload digest`);
    assertDigest(selected?.archiveSha256, 'E_PACKED_WORKSPACE_PROOF_INVALID', `${key} archive digest`);
    if (
      selected.payloadDigest !== packageCustody[key]?.payloadDigest
      || selected.archiveSha256 !== packageCustody[key]?.archiveSha256
    ) {
      fail('E_PACKED_WORKSPACE_PROOF_CUSTODY', `Packed ${key} proof does not bind the current workspace package bytes.`);
    }
  }
  const protocolAssets = pipeline.protocolAssets;
  if (Object.entries(PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS)
    .some(([key, count]) => protocolAssets?.[key] !== count)) {
    fail('E_PACKED_WORKSPACE_PROOF_IDENTITY', 'Packed protocol asset custody is incomplete.');
  }
}

function assertChecks(proof) {
  if (!Array.isArray(proof.checks)) {
    fail('E_PACKED_WORKSPACE_PROOF_CHECKS', 'Packed-workspace proof checks are missing.');
  }
  const ids = proof.checks.map((entry) => entry?.id).sort();
  if (
    JSON.stringify(ids) !== JSON.stringify(PACKED_WORKSPACE_REQUIRED_CHECKS)
    || proof.checks.some((entry) => entry?.status !== 'pass')
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_CHECKS', 'Packed-workspace proof checks are incomplete or non-passing.');
  }
}

function assertInstalledSurface(proof, custody) {
  const full = proof.installs?.full;
  const cliOnly = proof.installs?.cliOnly;
  if (full?.protocol?.name !== custody.protocol.manifest.name || full?.protocol?.version !== custody.protocol.manifest.version
    || ['node', 'browser', 'workers'].some((host) => full?.protocol?.[host]?.status !== 'passed' || !(full.protocol[host].exports > 0))
    || !(full.protocol.node.typedExports > 0) || !(full.protocol.node.assets > 0) || !(full.protocol.browser.assets > 0)) {
    fail('E_PACKED_WORKSPACE_PROOF_INSTALL', 'Packed Protocol Node/browser/Workers consumer proof is incomplete.');
  }
  if (
    full?.exportKeys !== 37
    || full?.rootSymbols !== 229
    || full?.diagram?.galleryCount !== PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT
    || full?.diagram?.renderValidation !== 'passed'
    || full?.diagram?.checkValidation !== 'passed'
    || full?.retiredPipelineOperate?.absenceContracts !== 80
    || full?.retiredPipelineOperate?.removedPaths !== 34
    || cliOnly?.pipelineInstalled !== false
    || cliOnly?.operateUtility?.status !== 'passed'
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_INSTALL', 'Packed-workspace installed surface proof is incomplete.');
  }
  if (
    custody.ecosystem.publicCompatibility?.pipelineExportKeys !== full.exportKeys
    || custody.ecosystem.publicCompatibility?.pipelineRootSymbols !== full.rootSymbols
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_ECOSYSTEM', 'Generated public compatibility custody differs from the packed proof.');
  }
}

export function assertPackedWorkspaceProof({
  proof,
  workspaceRoot,
  packageCustody = null,
}) {
  assertExactKeys(
    proof,
    ['checks', 'environment', 'installs', 'kind', 'ok', 'packages', 'proofDigest', 'schemaVersion'],
    'E_PACKED_WORKSPACE_PROOF_INVALID',
    'Packed-workspace proof',
  );
  if (
    proof.kind !== PACKED_WORKSPACE_PROOF_KIND
    || proof.schemaVersion !== PACKED_WORKSPACE_PROOF_SCHEMA_VERSION
    || proof.ok !== true
  ) {
    fail('E_PACKED_WORKSPACE_PROOF_INVALID', 'Packed-workspace proof identity or result is invalid.');
  }
  assertDigest(proof.proofDigest, 'E_PACKED_WORKSPACE_PROOF_INVALID', 'Packed-workspace proof digest');
  if (packedWorkspaceProofDigest(proof) !== proof.proofDigest) {
    fail('E_PACKED_WORKSPACE_PROOF_DIGEST', 'Packed-workspace proof digest does not bind its result.');
  }
  assertChecks(proof);

  const selectedRoot = realpathSync(resolve(workspaceRoot));
  const custody = manifestCustody(selectedRoot);
  assertGeneratedEcosystem(custody);
  const currentPackages = packageCustody ?? capturePackedWorkspaceCustody(selectedRoot);
  assertPackageProof(proof, custody, currentPackages);
  assertInstalledSurface(proof, custody);
  return Object.freeze({
    proofDigest: proof.proofDigest,
    cliPayloadDigest: proof.packages.cli.payloadDigest,
    pipelinePayloadDigest: proof.packages.pipeline.payloadDigest,
    protocolPayloadDigest: proof.packages.protocol.payloadDigest,
  });
}
