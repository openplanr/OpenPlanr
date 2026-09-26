#!/usr/bin/env node

import * as childProcess from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInstalledExportProbePlan } from '../packages/cli/scripts/package-contract.mjs';
import {
  PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT,
  PACKED_WORKSPACE_GENERATED_SKILL_COUNT,
  PACKED_WORKSPACE_PROOF_KIND,
  PACKED_WORKSPACE_PROOF_SCHEMA_VERSION,
  PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS,
  packedWorkspaceProofDigest,
  parseNpmPackJson,
} from '../packages/pipeline/lib/ecosystem/packed-workspace-proof.mjs';
import { browserExecutable } from '../tests/support/browser-launcher.mjs';

// Public CLI/pipeline projections remain self-contained during this migration.
// Protocol is now public, but a new dependency on it is not authorized here.
const PROJECTED_PACKAGE_NAMES = new Set([
  '@openplanr/artifact',
  '@openplanr/dashboard-app',
  '@openplanr/design',
  '@openplanr/integrations',
  '@openplanr/operate',
  '@openplanr/protocol',
  '@openplanr/skill-runtime',
]);
const SOURCE_FALLBACK_ENVIRONMENT_KEYS = [
  'OPENPLANR_ECOSYSTEM_SOURCE',
  'OPENPLANR_PIPELINE_ROOT',
  'OPENPLANR_PIPELINE_TARBALL',
  'OPENPLANR_VERIFIER_SOURCE_ROOT',
  'PLANR_PIPELINE_ROOT',
  'PLANR_PIPELINE_VERIFIER_SOURCE_ROOT',
];
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundledDependencies',
  'bundleDependencies',
];
const RUNTIME_TEXT_PATH = /^(?:bin|conformance|dist|lib|scripts|src)\//u;
const RUNTIME_TEXT_EXTENSION = /\.(?:[cm]?js|[cm]?ts|json)$/u;
const UNSAFE_DEPENDENCY_SPECIFIER =
  /^(?:file:|link:|workspace:|\/|\\|[A-Za-z]:[\\/]|\.\.?(?:[\\/]|$))/u;
const NON_PROTOCOL_ROOT_REGISTRIES = new Set(['registry/generated-skill-assets.json']);
const PIPELINE_OPTIONAL_DEPENDENCIES = Object.freeze({
  '@expo-google-fonts/inter': '0.4.2',
  '@resvg/resvg-js': '2.6.2',
});

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pipelineSourceRoot = path.join(repositoryRoot, 'packages', 'pipeline');
const cliSourceRoot = path.join(repositoryRoot, 'packages', 'cli');
const protocolSourceRoot = path.join(repositoryRoot, 'packages', 'protocol');
const packedSurfaceBaselinePath = path.join(
  repositoryRoot,
  'conformance',
  'packed-surface-baseline.json',
);

class ProofFailure extends Error {
  constructor(code, message, detail = undefined) {
    super(message);
    this.name = 'ProofFailure';
    this.code = code;
    this.detail = detail;
  }
}

function sha256(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableJson(nested)]),
    );
  }
  return value;
}

function digestJson(value) {
  return sha256(JSON.stringify(stableJson(value)));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizedPath(file) {
  return file.split(path.sep).join('/');
}

function isInside(parent, candidate) {
  const relative = path.relative(fs.realpathSync(parent), fs.realpathSync(candidate));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function sanitize(message, workspace) {
  let sanitized = String(message).replaceAll(repositoryRoot, '<repository>');
  if (workspace) sanitized = sanitized.replaceAll(workspace, '<workspace>');
  return sanitized.replaceAll('\\', '/');
}

function commandResult(executable, args, options = {}) {
  const result = childProcess.spawnSync(executable, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 4 * 60 * 1000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw new ProofFailure(
      'E_PROOF_COMMAND_START',
      `Could not start ${path.basename(executable)}.`,
      result.error.message,
    );
  }
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function successfulCommand(executable, args, options = {}) {
  const result = commandResult(executable, args, options);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${String(result.status)}`)
      .trim()
      .slice(-4_000);
    throw new ProofFailure(
      'E_PROOF_COMMAND_FAILED',
      `${path.basename(executable)} ${args[0] ?? ''} failed.`,
      detail,
    );
  }
  return result.stdout;
}

function inventoryTree(root) {
  const lexicalRoot = path.resolve(root);
  const rootStat = fs.lstatSync(lexicalRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new ProofFailure('E_PACK_ROOT_UNSAFE', 'Packed package root is not a real directory.');
  }
  const realRoot = fs.realpathSync(lexicalRoot);
  const entries = [];
  const visit = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      const relative = normalizedPath(path.relative(realRoot, absolute));
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        throw new ProofFailure('E_PACK_SYMLINK', `Packed payload contains a symlink: ${relative}`);
      }
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) {
        throw new ProofFailure(
          'E_PACK_ENTRY_UNSAFE',
          `Packed payload contains a special entry: ${relative}`,
        );
      }
      const bytes = fs.readFileSync(absolute);
      entries.push({
        path: relative,
        mode: stat.mode & 0o777,
        bytes: bytes.byteLength,
        sha256: sha256(bytes),
      });
    }
  };
  visit(realRoot);
  return entries;
}

function assertEquivalentInventory(expected, actual, subject) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new ProofFailure(
      'E_INSTALLED_PAYLOAD_DRIFT',
      `${subject} installed bytes differ from its packed payload.`,
      `${digestJson(expected)} != ${digestJson(actual)}`,
    );
  }
}

function safeRemoveWorkspace(workspace) {
  if (!workspace) return;
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  const resolved = path.resolve(workspace);
  const parent = fs.realpathSync(path.dirname(resolved));
  if (parent !== temporaryRoot || !path.basename(resolved).startsWith('openplanr-packed-proof-')) {
    throw new ProofFailure(
      'E_PROOF_CLEANUP_REFUSED',
      'Refused to clean an untrusted proof directory.',
    );
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function cleanEnvironment(home) {
  const environment = {
    ...process.env,
    CI: '1',
    // The isolated home hides Playwright's browser cache, so the proof pins the binary here.
    OPENPLANR_PROOF_CHROMIUM_EXECUTABLE: browserExecutable('chromium'),
    FORCE_COLOR: '0',
    HOME: home,
    // Host-runtime deprecation warnings can embed a different process ID for
    // each binary alias. They are not CLI output and would make byte-parity
    // nondeterministic on otherwise identical invocations.
    NODE_NO_WARNINGS: '1',
    NO_COLOR: '1',
    USERPROFILE: home,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_ignore_scripts: 'true',
    npm_config_update_notifier: 'false',
  };
  for (const key of SOURCE_FALLBACK_ENVIRONMENT_KEYS) delete environment[key];
  for (const key of Object.keys(environment)) {
    if (
      /^(?:ANTHROPIC|AZURE_OPENAI|GEMINI|GOOGLE|OPENAI|OPENPLANR)_.*(?:KEY|SECRET|TOKEN)$/iu.test(
        key,
      )
    ) {
      delete environment[key];
    }
  }
  if (process.env.OPENPLANR_NPM_CACHE) {
    environment.npm_config_cache = path.resolve(process.env.OPENPLANR_NPM_CACHE);
  }
  return environment;
}

function packPackage({ npmExecutable, sourceRoot, destination, environment }) {
  fs.mkdirSync(destination, { recursive: true });
  const raw = successfulCommand(
    npmExecutable,
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
    { cwd: sourceRoot, env: environment },
  );
  const parsed = parseNpmPackJson(raw);
  if (!parsed) {
    throw new ProofFailure('E_PACK_REPORT_INVALID', 'npm pack did not emit one JSON report.');
  }
  const report = Array.isArray(parsed) ? parsed[0] : undefined;
  if (!report || typeof report.filename !== 'string' || parsed.length !== 1) {
    throw new ProofFailure('E_PACK_REPORT_INVALID', 'npm pack did not report exactly one archive.');
  }
  const tarball = path.join(destination, report.filename);
  if (!fs.existsSync(tarball) || !fs.lstatSync(tarball).isFile()) {
    throw new ProofFailure(
      'E_PACK_ARCHIVE_MISSING',
      'npm pack did not create its reported archive.',
    );
  }
  return { report, tarball };
}

function extractPackage({ tarball, destination, environment }) {
  fs.mkdirSync(destination, { recursive: true });
  successfulCommand('tar', ['-xzf', tarball, '-C', destination], { env: environment });
  const packageRoot = path.join(destination, 'package');
  if (!fs.existsSync(packageRoot)) {
    throw new ProofFailure('E_PACK_ROOT_MISSING', 'Packed archive has no package root.');
  }
  inventoryTree(packageRoot);
  return packageRoot;
}

function dependencyViolations(manifest) {
  const violations = [];
  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (!dependencies) continue;
    if (Array.isArray(dependencies)) {
      for (const name of dependencies) {
        if (PROJECTED_PACKAGE_NAMES.has(name)) violations.push(`${field}:${name}`);
      }
      continue;
    }
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (PROJECTED_PACKAGE_NAMES.has(name)) violations.push(`${field}:${name}`);
      if (typeof specifier === 'string' && UNSAFE_DEPENDENCY_SPECIFIER.test(specifier)) {
        violations.push(`${field}:${name}:${specifier}`);
      }
    }
  }
  return violations.sort();
}

function runtimeSourceViolations(packageRoot, inventory) {
  const privateImport = new RegExp(
    String.raw`(?:from\s*|import\s*\(|require\s*\()\s*['"](${[...PROJECTED_PACKAGE_NAMES]
      .map((name) => name.replace('/', '\\/'))
      .join('|')})(?:[/"'])`,
    'u',
  );
  const violations = [];
  for (const entry of inventory) {
    if (
      entry.path !== 'package.json' &&
      (!RUNTIME_TEXT_PATH.test(entry.path) || !RUNTIME_TEXT_EXTENSION.test(entry.path))
    )
      continue;
    if (entry.bytes > 8 * 1024 * 1024) continue;
    const source = fs.readFileSync(path.join(packageRoot, entry.path), 'utf8');
    if (source.includes(repositoryRoot)) violations.push(`${entry.path}:source-root`);
    const match = source.match(privateImport);
    if (match) violations.push(`${entry.path}:private-import:${match[1]}`);
  }
  return violations.sort();
}

function generatedSkillPortability(packageRoot, inventory) {
  const privatePackage = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9._-])(${[...PROJECTED_PACKAGE_NAMES].map((name) => name.replace('/', '\\/')).join('|')})(?=$|[\s/'"\x60])`,
    'u',
  );
  const violations = [];
  for (const entry of inventory) {
    if (
      !/^(?:skills|adapters|agents)\//u.test(entry.path) ||
      !/\.(?:json|md|mdc)$/u.test(entry.path)
    )
      continue;
    const source = fs.readFileSync(path.join(packageRoot, entry.path), 'utf8');
    if (source.includes(repositoryRoot)) violations.push(`${entry.path}:source-root`);
    if (source.includes('workspace:')) violations.push(`${entry.path}:workspace-specifier`);
    const match = source.match(privatePackage);
    if (match) violations.push(`${entry.path}:private-package:${match[1]}`);
  }
  return violations.sort();
}

function packageProof(packageRoot, inventory, expectedName) {
  const manifest = readJson(path.join(packageRoot, 'package.json'));
  if (manifest.name !== expectedName) {
    throw new ProofFailure(
      'E_PACK_IDENTITY_INVALID',
      `Expected ${expectedName}, received ${String(manifest.name)}.`,
    );
  }
  const dependencyDrift = dependencyViolations(manifest);
  const sourceDrift = runtimeSourceViolations(packageRoot, inventory);
  if (dependencyDrift.length > 0 || sourceDrift.length > 0) {
    throw new ProofFailure(
      'E_PACK_PRIVATE_DEPENDENCY',
      `${expectedName} depends on private workspace or source-root state.`,
      [...dependencyDrift, ...sourceDrift].join(', '),
    );
  }
  if (inventory.some((entry) => entry.path.startsWith('node_modules/'))) {
    throw new ProofFailure('E_PACK_NODE_MODULES', `${expectedName} embeds node_modules.`);
  }
  const probes = createInstalledExportProbePlan(
    expectedName,
    manifest.exports,
    inventory.map((entry) => entry.path),
  );
  const declarations = inventory.filter((entry) => /\.d\.[cm]?ts$/u.test(entry.path));
  return {
    manifest,
    probes,
    summary: {
      declarations: declarations.length,
      dependencyViolations: 0,
      exportProbeTargets: probes.length,
      files: inventory.length,
      payloadBytes: inventory.reduce((total, entry) => total + entry.bytes, 0),
      payloadDigest: digestJson(inventory),
      runtimeSourceViolations: 0,
      version: manifest.version,
    },
  };
}

function installTarballs({ npmExecutable, project, tarballs, environment, omitOptional = false }) {
  fs.mkdirSync(project, { recursive: true });
  writeJson(path.join(project, 'package.json'), {
    name: 'openplanr-packed-proof-consumer',
    private: true,
    version: '0.0.0',
  });
  const args = [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-save',
    '--install-links=true',
    ...(omitOptional ? ['--omit=optional'] : []),
    ...tarballs,
  ];
  successfulCommand(npmExecutable, args, {
    cwd: project,
    env: environment,
    timeout: 8 * 60 * 1000,
  });
}

function installedPackageRoot(project, packageName) {
  const lexical = path.join(project, 'node_modules', ...packageName.split('/'));
  if (!fs.existsSync(lexical)) {
    throw new ProofFailure('E_INSTALLED_PACKAGE_MISSING', `${packageName} was not installed.`);
  }
  const stat = fs.lstatSync(lexical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isInside(project, lexical)) {
    throw new ProofFailure(
      'E_INSTALLED_PACKAGE_UNSAFE',
      `${packageName} is not a consumer-owned directory.`,
    );
  }
  return fs.realpathSync(lexical);
}

function canonicalCommandOutput(output, redactedRoots) {
  let canonical = output;
  const variants = new Set();
  for (const root of redactedRoots) {
    variants.add(path.resolve(root));
    if (fs.existsSync(root)) variants.add(fs.realpathSync(root));
  }
  for (const root of [...variants].sort((left, right) => right.length - left.length)) {
    canonical = canonical.replaceAll(root, '<consumer>');
  }
  return canonical;
}

function commandDigest(result, redactedRoots = []) {
  const stdout = canonicalCommandOutput(result.stdout, redactedRoots);
  const stderr = canonicalCommandOutput(result.stderr, redactedRoots);
  return {
    exitCode: result.status,
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: sha256(stderr),
    stdoutBytes: Buffer.byteLength(stdout),
    stdoutSha256: sha256(stdout),
  };
}

function runCli(nodeExecutable, cliRoot, args, options) {
  return commandResult(nodeExecutable, [path.join(cliRoot, 'bin', 'planr.js'), ...args], options);
}

function installedAliasEntrypoint({ consumerRoot, cliRoot, manifest, alias }) {
  const lexical = path.join(consumerRoot, 'node_modules', '.bin', alias);
  if (!fs.existsSync(lexical)) {
    throw new ProofFailure('E_CLI_BIN_ALIAS_MISSING', `Installed ${alias} alias is missing.`);
  }
  const selected = fs.realpathSync(lexical);
  const expected = fs.realpathSync(path.join(cliRoot, manifest.bin[alias]));
  if (selected !== expected || !isInside(cliRoot, selected)) {
    throw new ProofFailure(
      'E_CLI_BIN_ALIAS_TARGET',
      `Installed ${alias} alias escaped CLI custody.`,
    );
  }
  return lexical;
}

function assertJsonOutput(result, subject) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new ProofFailure('E_CLI_JSON_INVALID', `${subject} did not emit valid JSON.`);
  }
}

function verifyCliAliases({
  nodeExecutable,
  consumerRoot,
  cliRoot,
  manifest,
  project,
  environment,
}) {
  const expectedBins = {
    openplanr: './bin/planr.js',
    opr: './bin/planr.js',
    planr: './bin/planr.js',
  };
  if (JSON.stringify(stableJson(manifest.bin)) !== JSON.stringify(stableJson(expectedBins))) {
    throw new ProofFailure(
      'E_CLI_BIN_ALIAS_DRIFT',
      'CLI aliases do not share the exact parser target.',
    );
  }
  const cases = [
    { id: 'version', args: ['--version'], expectedExit: 0, output: 'text' },
    { id: 'help', args: ['--help'], expectedExit: 0, output: 'text' },
    {
      id: 'json-success',
      args: ['operate', 'recovery', 'inspect', '--json'],
      expectedExit: 0,
      output: 'json',
    },
    { id: 'diagnostics', args: ['doctor', '--json'], output: 'json' },
    { id: 'failure', args: ['__openplanr_unknown__', '--json'], expectedExit: 1, output: 'json' },
  ];
  const entrypoints = Object.fromEntries(
    Object.keys(expectedBins).map((alias) => [
      alias,
      installedAliasEntrypoint({ consumerRoot, cliRoot, manifest, alias }),
    ]),
  );
  const reports = [];
  for (const testCase of cases) {
    const baseline = commandResult(nodeExecutable, [entrypoints.planr, ...testCase.args], {
      cwd: project,
      env: environment,
      timeout: testCase.id === 'diagnostics' ? 2 * 60 * 1000 : undefined,
    });
    if (testCase.expectedExit !== undefined && baseline.status !== testCase.expectedExit) {
      throw new ProofFailure(
        'E_CLI_ALIAS_CASE_FAILED',
        `planr alias case ${testCase.id} exited ${String(baseline.status)}.`,
      );
    }
    if (testCase.output === 'json') assertJsonOutput(baseline, testCase.id);
    for (const alias of ['openplanr', 'opr']) {
      const candidate = commandResult(nodeExecutable, [entrypoints[alias], ...testCase.args], {
        cwd: project,
        env: environment,
        timeout: testCase.id === 'diagnostics' ? 2 * 60 * 1000 : undefined,
      });
      if (
        candidate.status !== baseline.status ||
        candidate.stdout !== baseline.stdout ||
        candidate.stderr !== baseline.stderr
      ) {
        throw new ProofFailure(
          'E_CLI_ALIAS_PARITY',
          `${alias} differs from planr for ${testCase.id}.`,
        );
      }
    }
    reports.push({ id: testCase.id, ...commandDigest(baseline, [consumerRoot, project]) });
  }
  return reports;
}

function exportProbeRunnerSource() {
  return String.raw`import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [, , inputPath, outputPath] = process.argv;
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const require = createRequire(import.meta.url);
const inside = (root, candidate) => {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(candidate));
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const results = [];
const originalArgv = process.argv;
process.argv = [process.execPath, 'openplanr-packed-export-proof', '--help'];
try {
  for (const packagePlan of input.packages) {
    const packageRoot = fs.realpathSync(packagePlan.packageRoot);
    for (const probe of packagePlan.probes) {
      const lexicalTarget = path.join(packageRoot, ...probe.target.split('/'));
      const stat = fs.lstatSync(lexicalTarget);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe export target: ' + probe.specifier);
      const target = fs.realpathSync(lexicalTarget);
      if (!inside(packageRoot, target)) throw new Error('export escaped package: ' + probe.specifier);
      if (probe.kind === 'type-only') {
        if (fs.readFileSync(target).byteLength === 0) throw new Error('empty declaration: ' + probe.specifier);
      } else if (probe.kind === 'asset') {
        const selected = fs.realpathSync(fileURLToPath(import.meta.resolve(probe.specifier)));
        if (selected !== target || !inside(packageRoot, selected) || fs.readFileSync(selected).byteLength === 0) throw new Error('invalid asset export: ' + probe.specifier);
      } else if (probe.kind === 'json') {
        const resolved = fs.realpathSync(require.resolve(probe.specifier));
        if (resolved !== target || !inside(packageRoot, resolved)) throw new Error('JSON export escaped: ' + probe.specifier);
        JSON.parse(fs.readFileSync(resolved, 'utf8'));
      } else if (probe.kind === 'require') {
        const resolved = fs.realpathSync(require.resolve(probe.specifier));
        if (resolved !== target || !inside(packageRoot, resolved)) throw new Error('require export escaped: ' + probe.specifier);
        require(probe.specifier);
      } else {
        await import(pathToFileURL(target).href);
        const selected = fs.realpathSync(fileURLToPath(import.meta.resolve(probe.specifier)));
        if (!inside(packageRoot, selected)) throw new Error('import export escaped: ' + probe.specifier);
        if (selected === target) await import(probe.specifier);
      }
      results.push({
        package: packagePlan.name,
        subpath: probe.subpath,
        conditions: probe.conditions,
        kind: probe.kind,
        status: probe.kind === 'type-only' || probe.kind === 'asset' ? 'validated' : 'loaded',
      });
    }
  }

  const pipeline = await import('planr-pipeline');
  const rootSymbols = Object.keys(pipeline).sort();
  const { readProfessionalSkillsCatalog } = await import('planr-pipeline/professional-skills');
  const skillCatalog = readProfessionalSkillsCatalog();
  if (!skillCatalog.skills.length) throw new Error('Installed professional skill compatibility catalog is empty');
  const authoring = await import('planr-pipeline/diagram-authoring');
  const contracts = await import('@openplanr/protocol/diagram-authoring-contracts');
  const meta = kind => ({ kind, schemaVersion: '1.0.0', protocolVersion: '1.13.0' });
  const document = {
    ...meta('planr-diagram'), diagramId: 'packed-diagram', title: 'Packed consumer', summary: '', audience: 'engineer',
    grammar: { id: 'flowchart', version: '1.0.0' }, nodes: [], relations: [], groups: [], lanes: [],
    events: [], series: [], axes: [], sets: [], annotations: [], emphasis: [], laneOrder: [],
    accessibility: { title: 'Packed consumer', description: 'One authored step.', readingOrder: [] }, documentDigest: '',
  };
  document.documentDigest = contracts.diagramDocumentDigest(document);
  const presentation = {
    ...meta('diagram-presentation'), diagramId: document.diagramId, semanticDigest: document.documentDigest,
    coordinateSystem: 'global-canvas', layout: { direction: 'left-right', detailTier: 'balanced' },
    theme: { themeId: 'paper', mode: 'light' }, elements: [], presentationDigest: '',
  };
  presentation.presentationDigest = contracts.diagramPresentationDigest(presentation);
  const authored = {
    ...meta('diagram-authoring-bundle'), diagramId: document.diagramId, document, presentation,
    originalSource: null, sourceMap: null, bundleDigest: '',
  };
  authored.bundleDigest = contracts.diagramAuthoringBundleDigest(authored);
  const original = JSON.stringify(authored);
  const created = authoring.compileDiagramCommand(authored, {
    type: 'create',
    elements: [{ collection: 'nodes', value: { id: 'step-one', label: 'Ready', kind: 'process', description: null } }],
    presentation: [{
      elementId: 'step-one', bounds: { x: 20, y: 30, width: 120, height: 60 }, route: null, label: null, zIndex: 0,
      appearance: { shape: 'rectangle', fill: 'surface', stroke: 'default', strokeWidth: 1, strokeStyle: 'solid', fontSize: 14, textAlign: 'center' },
      locks: { position: false, size: false, route: false },
    }],
  }, { transactionId: 'packed-create' });
  if (!created.ok || !created.transaction || created.bundle.document.nodes[0]?.id !== 'step-one') {
    throw new Error('Packed authoring command failed: ' + JSON.stringify(created));
  }
  const inverse = authoring.createConditionalInverse(created.bundle, created.inverse, { transactionId: 'packed-undo' });
  if (!inverse.ok) throw new Error('Packed authoring inverse failed: ' + JSON.stringify(inverse));
  const undone = authoring.previewDiagramTransaction(created.bundle, inverse.transaction);
  if (!undone.ok || undone.bundle.bundleDigest !== authored.bundleDigest || JSON.stringify(authored) !== original) {
    throw new Error('Packed authoring undo did not restore the unchanged input snapshot');
  }


  const { createDiagramAuthoringStore, previewLegacyDiagramDocument } = await import('planr-pipeline/diagram-authoring-store');
  const { exportAuthoredDiagram, verifyAuthoredDiagramExports } = await import('planr-pipeline/diagram-authoring-export');
  if (typeof previewLegacyDiagramDocument !== 'function') throw new Error('Packed migration export is missing');
  const authoredRoot = fs.realpathSync(fs.mkdtempSync(path.join(path.dirname(inputPath), 'authored-consumer-')));
  try {
    const options = { root: authoredRoot, slug: authored.diagramId };
    const store = createDiagramAuthoringStore(options);
    if (!(await store.initialize(authored, { transactionId: 'packed-initialize' })).ok) throw new Error('Packed bundle initialization failed');
    const saved = await store.commit(created.transaction);
    if (!saved.ok || saved.status !== 'saved') throw new Error('Packed durable save failed');
    const restarted = createDiagramAuthoringStore(options);
    const reopened = await restarted.read();
    if (reopened.status !== 'ready' || reopened.bundle.bundleDigest !== created.bundle.bundleDigest) throw new Error('Packed durable restart failed');
    const retry = await restarted.commit(created.transaction);
    if (!retry.ok || !retry.replayed || retry.receipt.sequence !== saved.receipt.sequence) throw new Error('Packed durable retry duplicated a transaction');
    const rendered = authoring.renderAuthoredDiagramSvg(reopened.bundle);
    if (!rendered.ok || rendered.scene.boxes[0]?.bounds.x !== 20 || !rendered.svg.includes('Ready')) throw new Error('Packed authored geometry did not survive save');
    const exported = await exportAuthoredDiagram(reopened.bundle, options);
    if (!exported.ok || !(await verifyAuthoredDiagramExports(reopened.bundle, options)).ok) throw new Error('Packed authored export failed: ' + JSON.stringify(exported));
    if (fs.readFileSync(path.join(exported.directory, 'diagram.png')).byteLength < 32) throw new Error('Packed PNG was not rasterized');
    const editorApi = await import('planr-pipeline/diagram-editor');
    if (typeof editorApi.mountDiagramSourcePanel !== 'function') throw new Error('Packed source-panel export is missing');
    const editor = await editorApi.openDiagramEditorSession({ transport: restarted });
    if (typeof editor.adoptInitialCopy !== 'function') throw new Error('Packed initial-copy adoption is missing');
    const edited = editor.submit({ type: 'rename', id: 'step-one', label: 'Edited from installed package' });
    if (!edited.ok || !(await editor.save()).ok || editor.getState().saveState !== 'saved') throw new Error('Packed editor save failed');
    const editorRead = await editorApi.openDiagramEditorSession({ transport: restarted });
    if (editorRead.getState().bundle.document.nodes[0].label !== 'Edited from installed package') throw new Error('Packed editor reopen failed');
    if (!editorRead.query({ x: 50, y: 50 }).hits.some(hit => hit.id === 'step-one')) throw new Error('Packed indexed editor hit failed');
    const { startDiagramOwner } = await import('planr-pipeline/diagram-owner');
    const owner = await startDiagramOwner(options);
    try {
      const response = await fetch(owner.apiBase + 'read', { headers: owner.headers });
      const state = await response.json();
      if (response.status !== 200 || state.bundle.bundleDigest !== editorRead.getState().bundle.bundleDigest) throw new Error('Packed owner read failed');
    } finally { await owner.close(); editor.dispose(); editorRead.dispose(); }

  } finally { fs.rmSync(authoredRoot, { recursive: true, force: true }); }

  const dashboardPath = fs.realpathSync(require.resolve('openplanr/dashboard'));
  const verifierPath = fs.realpathSync(require.resolve('openplanr/dashboard-verifier'));
  const openplanrRoot = fs.realpathSync(input.openplanrRoot);
  const pipelineRoot = fs.realpathSync(input.pipelineRoot);
  if (!inside(openplanrRoot, dashboardPath) || !inside(openplanrRoot, verifierPath)) {
    throw new Error('dashboard exports escaped installed OpenPlanr');
  }
  const verifier = await import(pathToFileURL(verifierPath).href);
  const dashboard = verifier.verifyDashboardAssets();
  const dashboardManifest = JSON.parse(fs.readFileSync(dashboardPath, 'utf8'));
  const packageRequire = createRequire(require.resolve('openplanr/package.json'));
  const pipelineManifestPath = fs.realpathSync(packageRequire.resolve('planr-pipeline/package.json'));
  if (!inside(pipelineRoot, pipelineManifestPath)) throw new Error('OpenPlanr resolved pipeline outside installed custody');

  const wildcardAssets = [
    'planr-pipeline/schemas/v1.0.0/task.schema.json',
    'planr-pipeline/schemas/v1.5.0/role-registry.schema.json',
    'planr-pipeline/schemas/v2.0.0/operating-runtime-state.schema.json',
    'planr-pipeline/registry/roles.json',
    'planr-pipeline/registry/v1.5.0/roles.json',
  ].map((specifier) => {
    const resolved = fs.realpathSync(require.resolve(specifier));
    if (!inside(pipelineRoot, resolved)) throw new Error('wildcard asset escaped: ' + specifier);
    JSON.parse(fs.readFileSync(resolved, 'utf8'));
    return specifier;
  });

  fs.writeFileSync(outputPath, JSON.stringify({
    dashboard: {
      buildId: dashboard.buildId,
      kind: dashboardManifest.kind,
      ok: dashboard.ok,
    },
    probes: results,
    rootSymbols,
    wildcardAssets,
  }));
} finally {
  process.argv = originalArgv;
}
`;
}

function runExportProof({
  nodeExecutable,
  project,
  cliRoot,
  pipelineRoot,
  cliProbes,
  pipelineProbes,
  environment,
}) {
  const inputPath = path.join(project, 'packed-export-proof-input.json');
  const outputPath = path.join(project, 'packed-export-proof-output.json');
  const runnerPath = path.join(project, 'packed-export-proof-runner.mjs');
  writeJson(inputPath, {
    openplanrRoot: cliRoot,
    packages: [
      { name: 'openplanr', packageRoot: cliRoot, probes: cliProbes },
      { name: 'planr-pipeline', packageRoot: pipelineRoot, probes: pipelineProbes },
    ],
    pipelineRoot,
  });
  fs.writeFileSync(runnerPath, exportProbeRunnerSource());
  successfulCommand(nodeExecutable, [runnerPath, inputPath, outputPath], {
    cwd: project,
    env: environment,
    timeout: 4 * 60 * 1000,
  });
  const typesPath = path.join(project, 'diagram-authoring-types.mts');
  fs.writeFileSync(
    typesPath,
    `import {
  compileDiagramCommand, createConditionalInverse, previewDiagramTransaction, diffDiagramBundles,
  resolveDiagramScene, renderAuthoredDiagramSvg, previewAutomaticLayout, previewResetRoute,
  type DiagramAuthoringBundle, type DiagramCommand, type DiagramEditPreview,
} from 'planr-pipeline/diagram-authoring';
import { createDiagramAuthoringStore, previewLegacyDiagramMigration } from 'planr-pipeline/diagram-authoring-store';
import { exportAuthoredDiagram, verifyAuthoredDiagramExports } from 'planr-pipeline/diagram-authoring-export';
import { createDiagramEditorSession, openDiagramEditorSession, createDiagramEditorDraft, createDiagramEditorRecovery, copyDiagramSelection, pasteDiagramSelection, createDiagramLocalOwnerTransport, mountDiagramSourcePanel, type DiagramSourcePanelController, type DiagramSourcePanelOptions } from 'planr-pipeline/diagram-editor';
declare const bundle: DiagramAuthoringBundle;
declare const root: HTMLElement;
const move: DiagramCommand = { type: 'move', ids: ['step-one'], dx: 20, dy: 0 };
const result = compileDiagramCommand(bundle, move, { transactionId: 'consumer-move' });
if (result.ok && result.transaction) {
  const preview: DiagramEditPreview = result;
  const inverse = createConditionalInverse(preview.bundle, preview.inverse, { transactionId: 'consumer-undo' });
  if (inverse.ok) previewDiagramTransaction(preview.bundle, inverse.transaction);
  const diff = diffDiagramBundles(bundle, preview.bundle);
  if (diff.ok) diff.presentation.map(change => change.path);
} else if (!result.ok) result.diagnostics.map(diagnostic => diagnostic.rule);
compileDiagramCommand(bundle, { type: 'cancel' });

const scene = resolveDiagramScene(bundle);
if (scene.ok) scene.scene.boxes.map(box => box.bounds?.x);
const rendered = renderAuthoredDiagramSvg(bundle);
if (rendered.ok) rendered.theme.fontSize.toFixed();
previewAutomaticLayout(bundle, { targetIds: ['step-one'], transactionId: 'layout' });
previewResetRoute(bundle, { targetIds: ['edge-one'], transactionId: 'route' });
const storageOptions = { root: '/workspace', slug: bundle.diagramId };
const store = createDiagramAuthoringStore(storageOptions);
await store.initialize(bundle, { transactionId: 'initial' });
const loaded = await store.read();
if (loaded.status === 'ready') loaded.bundle.document.nodes.map(node => node.id);
if (result.ok && result.transaction) await store.commit(result.transaction);
const outputs = await exportAuthoredDiagram(bundle, storageOptions);
if (outputs.ok) outputs.scene.boxes.map(box => box.bounds?.x);
await verifyAuthoredDiagramExports(bundle, storageOptions);
await previewLegacyDiagramMigration(storageOptions);
const editor = createDiagramEditorSession({ bundle, transport: store });
await openDiagramEditorSession({ transport: store });
editor.submit(move); editor.beginGesture(); editor.previewGesture(move); editor.completeGesture();
editor.setView({ camera: { x: 0, y: 0, scale: 1, fit: null }, selection: ['step-one'] });
const hits = editor.query({ x: 40, y: 50 });
if (hits.ok) hits.hits.map(hit => hit.id);
const draft = createDiagramEditorDraft({ diagramId: 'new-diagram', title: 'Draft' });
if (draft.ok) {
  const initialEditor = createDiagramEditorSession({ bundle: draft.bundle });
  initialEditor.adoptInitialCopy(draft.bundle);
  const sourcePanelOptions: DiagramSourcePanelOptions = { root, session: initialEditor, initialTab: 'import' };
  const sourcePanel: DiagramSourcePanelController = mountDiagramSourcePanel(sourcePanelOptions);
  sourcePanel.selectTab('export');
  editor.refresh(draft.bundle);
}
const clipboard = copyDiagramSelection(bundle, ['step-one']);
if (clipboard.ok) pasteDiagramSelection(bundle, clipboard.value, { idMap: { 'step-one': 'step-two' }, transactionId: 'paste-copy' });
createDiagramEditorRecovery({ scope: { sessionId: 'verified-owner', diagramId: bundle.diagramId } });
const ownerTransport = createDiagramLocalOwnerTransport({ apiBase: 'http://127.0.0.1:3000/o/id/token/api/' });
const ownerRead = await ownerTransport.read();
if (ownerRead.ok) createDiagramEditorRecovery({ scope: { sessionId: ownerRead.recoveryScope, diagramId: ownerRead.diagramId } });
// @ts-expect-error Arbitrary camera dimensions are not document content or editor state.
editor.setView({ camera: { z: 30 } });
// @ts-expect-error Editor commands retain the typed kernel vocabulary.
editor.submit({ type: 'execute', script: 'arbitrary' });

// @ts-expect-error Unsupported commands must not become an open record API.
compileDiagramCommand(bundle, { type: 'evaluate', script: 'arbitrary' }, { transactionId: 'bad-command' });
// @ts-expect-error Movement takes numeric world-coordinate deltas.
compileDiagramCommand(bundle, { type: 'move', ids: ['step-one'], dx: '20', dy: 0 }, { transactionId: 'bad-delta' });
`,
  );
  const typeConfig = path.join(project, 'diagram-authoring-tsconfig.json');
  writeJson(typeConfig, {
    compilerOptions: {
      noEmit: true,
      strict: true,
      target: 'ES2022',
      lib: ['ES2022', 'DOM'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      types: [],
    },
    files: [typesPath],
  });
  successfulCommand(
    nodeExecutable,
    [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '--project', typeConfig],
    {
      cwd: project,
      env: environment,
    },
  );
  return readJson(outputPath);
}

// This reviewed baseline is intentionally static. Generation must never derive
// the compatibility floor from the implementation it is intended to verify.
export function readPackedSurfaceBaseline() {
  const baseline = readJson(packedSurfaceBaselinePath);
  const distinctStrings = (values, count) =>
    Array.isArray(values) &&
    values.length === count &&
    values.every((value) => typeof value === 'string' && value.length > 0) &&
    new Set(values).size === count;
  if (
    baseline.kind !== 'openplanr-packed-surface-baseline' ||
    baseline.schemaVersion !== '1.0.0' ||
    baseline.package !== 'planr-pipeline' ||
    !distinctStrings(baseline.baselineExportKeys, 37) ||
    !distinctStrings(baseline.baselineRootSymbols, 229) ||
    !distinctStrings(baseline.protocolAssets?.originalRegistryPaths, 12) ||
    !distinctStrings(baseline.protocolAssets?.successorRegistryPaths, 12) ||
    !distinctStrings(baseline.protocolAssets?.successorSchemaPaths, 48)
  ) {
    throw new ProofFailure(
      'E_PACKED_SURFACE_BASELINE_INVALID',
      'The reviewed public package compatibility baseline is invalid.',
    );
  }
  return baseline;
}

export function assertPackedSurfaceCompatibility(baseline, { exportKeys, rootSymbols }) {
  if (baseline.baselineExportKeys.some((key) => !exportKeys.includes(key))) {
    throw new ProofFailure(
      'E_PIPELINE_EXPORT_BASELINE_MISSING',
      'Packed pipeline removed a supported export key.',
    );
  }
  if (
    rootSymbols &&
    JSON.stringify([...rootSymbols].sort()) !==
      JSON.stringify([...baseline.baselineRootSymbols].sort())
  ) {
    throw new ProofFailure(
      'E_PIPELINE_ROOT_SYMBOL_DRIFT',
      'Packed pipeline root symbols differ from the supported baseline.',
    );
  }
}

export function countProtocolAssets(inventory, baseline) {
  const paths = new Set(inventory.map((entry) => entry.path));
  const originalRegistryPaths = new Set(baseline.protocolAssets.originalRegistryPaths);
  const successorRegistryPaths = new Set(baseline.protocolAssets.successorRegistryPaths);
  const successorSchemaPaths = new Set(baseline.protocolAssets.successorSchemaPaths);
  const unclassifiedRootRegistries = [...paths]
    .filter((entry) => /^registry\/[^/]+\.json$/u.test(entry))
    .filter(
      (entry) => !originalRegistryPaths.has(entry) && !NON_PROTOCOL_ROOT_REGISTRIES.has(entry),
    );
  if (unclassifiedRootRegistries.length > 0) {
    throw new ProofFailure(
      'E_PACK_PROTOCOL_ASSET_DRIFT',
      'Packed registry custody contains an unclassified root asset.',
      JSON.stringify(unclassifiedRootRegistries.sort()),
    );
  }
  return {
    originalRegistries: [...originalRegistryPaths].filter((entry) => paths.has(entry)).length,
    originalSchemas: inventory.filter((entry) =>
      /^schemas\/v(?:1\.[0-4]\.0|2\.0\.0)\/[^/]+\.schema\.json$/u.test(entry.path),
    ).length,
    successorRegistries: [...successorRegistryPaths].filter((entry) => paths.has(entry)).length,
    successorRegistriesV15: [...successorRegistryPaths].filter(
      (entry) => entry.startsWith('registry/v1.5.0/') && paths.has(entry),
    ).length,
    successorRegistriesV16: [...successorRegistryPaths].filter(
      (entry) => entry.startsWith('registry/v1.6.0/') && paths.has(entry),
    ).length,
    successorRegistriesV17: [...successorRegistryPaths].filter(
      (entry) => entry.startsWith('registry/v1.7.0/') && paths.has(entry),
    ).length,
    successorSchemas: [...successorSchemaPaths].filter((entry) => paths.has(entry)).length,
    successorSchemasV15: [...successorSchemaPaths].filter(
      (entry) => entry.startsWith('schemas/v1.5.0/') && paths.has(entry),
    ).length,
    successorSchemasV16: [...successorSchemaPaths].filter(
      (entry) => entry.startsWith('schemas/v1.6.0/') && paths.has(entry),
    ).length,
    successorSchemasV17: [...successorSchemaPaths].filter(
      (entry) => entry.startsWith('schemas/v1.7.0/') && paths.has(entry),
    ).length,
  };
}

function verifyRetiredPipelineOperate({ nodeExecutable, pipelineRoot, project, environment }) {
  const binary = commandResult(
    nodeExecutable,
    [path.join(pipelineRoot, 'bin', 'planr-pipeline.mjs'), 'operate', '--json'],
    { cwd: project, env: environment },
  );
  const error = assertJsonOutput(
    { ...binary, stdout: binary.stderr || binary.stdout },
    'pipeline operate',
  );
  if (binary.status !== 1 || error.code !== 'E_COMMAND_UNKNOWN') {
    throw new ProofFailure(
      'E_RETIRED_PIPELINE_OPERATE_PRESENT',
      'planr-pipeline still accepts the retired operate command.',
    );
  }
  const absence = commandResult(
    nodeExecutable,
    [path.join(pipelineRoot, 'conformance', 'verify-operate-v2-absence.mjs')],
    { cwd: project, env: environment },
  );
  if (absence.status !== 0) {
    throw new ProofFailure(
      'E_RETIRED_PIPELINE_ASSET_PRESENT',
      'Packed pipeline Operate absence conformance failed.',
      absence.stderr || absence.stdout,
    );
  }
  const absenceReport = assertJsonOutput(absence, 'pipeline Operate absence conformance');
  if (absenceReport.ok !== true || absenceReport.removedPaths !== 34) {
    throw new ProofFailure(
      'E_RETIRED_PIPELINE_ASSET_PRESENT',
      'Packed pipeline absence report drifted.',
    );
  }
  return {
    absenceContracts: absenceReport.contracts,
    rejectedCommand: commandDigest(binary, [project]),
    removedPaths: absenceReport.removedPaths,
  };
}

function verifyFullInstall({
  nodeExecutable,
  npmExecutable,
  project,
  cliArchive,
  pipelineArchive,
  protocolArchive,
  protocolPack,
  cliPack,
  pipelinePack,
  expectedExportKeys,
  expectedRootSymbols,
  environment,
}) {
  installTarballs({
    npmExecutable,
    project,
    tarballs: [cliArchive, pipelineArchive, protocolArchive],
    environment,
  });
  const cliRoot = installedPackageRoot(project, 'openplanr');
  const pipelineRoot = installedPackageRoot(project, 'planr-pipeline');
  assertEquivalentInventory(cliPack.inventory, inventoryTree(cliRoot), 'openplanr');
  assertEquivalentInventory(pipelinePack.inventory, inventoryTree(pipelineRoot), 'planr-pipeline');
  const protocolRoot = installedPackageRoot(project, '@openplanr/protocol');
  assertEquivalentInventory(
    protocolPack.inventory,
    inventoryTree(protocolRoot),
    '@openplanr/protocol',
  );
  const protocolReport = path.join(project, 'protocol-consumer-proof.json');
  successfulCommand(
    nodeExecutable,
    [path.join(protocolSourceRoot, 'scripts/verify-packed-consumers.mjs'), project, protocolReport],
    { cwd: project, env: environment },
  );
  const protocolConsumers = readJson(protocolReport);

  const exportProof = runExportProof({
    nodeExecutable,
    project,
    cliRoot,
    pipelineRoot,
    cliProbes: cliPack.proof.probes,
    pipelineProbes: pipelinePack.proof.probes,
    environment,
  });
  const installedExportKeys = Object.keys(
    readJson(path.join(pipelineRoot, 'package.json')).exports,
  ).sort();
  if (JSON.stringify(installedExportKeys) !== JSON.stringify(expectedExportKeys)) {
    throw new ProofFailure('E_PIPELINE_EXPORT_KEY_DRIFT', 'Packed pipeline export keys drifted.');
  }
  assertPackedSurfaceCompatibility(
    { baselineExportKeys: expectedExportKeys, baselineRootSymbols: expectedRootSymbols },
    { exportKeys: installedExportKeys, rootSymbols: exportProof.rootSymbols },
  );
  if (
    exportProof.dashboard.ok !== true ||
    exportProof.dashboard.kind !== 'openplanr-dashboard-build' ||
    typeof exportProof.dashboard.buildId !== 'string'
  ) {
    throw new ProofFailure('E_DASHBOARD_PACK_INVALID', 'Packed CLI dashboard did not verify.');
  }

  const operateProject = path.join(project, 'operate-project');
  fs.mkdirSync(operateProject, { recursive: true });
  writeJson(path.join(operateProject, 'package.json'), {
    name: 'openplanr-operate-proof',
    private: true,
    version: '0.0.0',
  });
  const inspection = runCli(nodeExecutable, cliRoot, ['operate', 'recovery', 'inspect', '--json'], {
    cwd: operateProject,
    env: environment,
  });
  const inspectionReport = assertJsonOutput(inspection, 'planr operate recovery inspect');
  if (
    inspection.status !== 0 ||
    inspectionReport.ok !== true ||
    inspectionReport.operation !== 'operate.recovery.inspect' ||
    inspectionReport.data?.status !== 'empty' ||
    inspectionReport.data?.allowedRecovery !== 'none' ||
    inspectionReport.data?.integrityBoundary?.model !== 'project-local-integrity'
  ) {
    throw new ProofFailure('E_CLI_OPERATE_FAILED', 'Packed planr operate is not functional.');
  }

  const aliases = verifyCliAliases({
    nodeExecutable,
    consumerRoot: project,
    cliRoot,
    manifest: readJson(path.join(cliRoot, 'package.json')),
    project: operateProject,
    environment,
  });
  const retiredOperate = verifyRetiredPipelineOperate({
    nodeExecutable,
    pipelineRoot,
    project: operateProject,
    environment,
  });
  const diagramProject = path.join(project, 'diagram-project');
  fs.mkdirSync(diagramProject, { recursive: true });
  const diagramInput = path.join(
    pipelineRoot,
    'fixtures',
    'diagram',
    'grammars',
    'flowchart.planr-diagram.json',
  );
  const galleryResult = runCli(nodeExecutable, cliRoot, ['diagram', 'gallery', '--json'], {
    cwd: diagramProject,
    env: environment,
  });
  const gallery = assertJsonOutput(galleryResult, 'planr diagram gallery');
  if (
    galleryResult.status !== 0 ||
    gallery.ok !== true ||
    gallery.count !== PACKED_WORKSPACE_DIAGRAM_GRAMMAR_COUNT
  ) {
    throw new ProofFailure(
      'E_CLI_DIAGRAM_GALLERY_FAILED',
      'Packed planr diagram gallery is incomplete.',
    );
  }
  const renderResult = runCli(
    nodeExecutable,
    cliRoot,
    ['diagram', 'render', diagramInput, '--output', '.', '--json'],
    { cwd: diagramProject, env: environment },
  );
  const rendered = assertJsonOutput(renderResult, 'planr diagram render');
  if (
    renderResult.status !== 0 ||
    rendered.ok !== true ||
    rendered.validation?.status !== 'passed' ||
    typeof rendered.manifest?.path !== 'string'
  ) {
    throw new ProofFailure('E_CLI_DIAGRAM_RENDER_FAILED', 'Packed planr diagram render failed.');
  }
  const checkResult = runCli(
    nodeExecutable,
    cliRoot,
    ['diagram', 'check', rendered.manifest.path, '--json'],
    { cwd: diagramProject, env: environment },
  );
  const checked = assertJsonOutput(checkResult, 'planr diagram check');
  if (checkResult.status !== 0 || checked.ok !== true || checked.validation?.status !== 'passed') {
    throw new ProofFailure('E_CLI_DIAGRAM_CHECK_FAILED', 'Packed planr diagram check failed.');
  }
  return {
    protocol: protocolConsumers,
    aliasCases: aliases,
    dashboard: exportProof.dashboard,
    diagram: {
      artifacts: rendered.artifacts.length,
      checkValidation: checked.validation.status,
      diagramId: rendered.diagramId,
      galleryCount: gallery.count,
      renderValidation: rendered.validation.status,
    },
    exportKeys: installedExportKeys.length,
    exportProbeDigest: digestJson(exportProof.probes),
    exportProbeTargets: exportProof.probes.length,
    operateInspection: commandDigest(inspection, [project, operateProject]),
    retiredPipelineOperate: retiredOperate,
    rootSymbols: exportProof.rootSymbols.length,
    rootSymbolsDigest: digestJson(exportProof.rootSymbols),
    wildcardAssets: exportProof.wildcardAssets,
  };
}

function verifyCliOnlyInstall({
  nodeExecutable,
  npmExecutable,
  project,
  cliArchive,
  cliPack,
  environment,
}) {
  installTarballs({
    npmExecutable,
    project,
    tarballs: [cliArchive],
    environment,
    omitOptional: true,
  });
  const cliRoot = installedPackageRoot(project, 'openplanr');
  assertEquivalentInventory(cliPack.inventory, inventoryTree(cliRoot), 'CLI-only openplanr');
  if (fs.existsSync(path.join(project, 'node_modules', 'planr-pipeline'))) {
    throw new ProofFailure(
      'E_OPTIONAL_PIPELINE_INSTALLED',
      'CLI-only install unexpectedly contains planr-pipeline.',
    );
  }
  const version = runCli(nodeExecutable, cliRoot, ['--version'], {
    cwd: project,
    env: environment,
  });
  const help = runCli(nodeExecutable, cliRoot, ['operate', '--help'], {
    cwd: project,
    env: environment,
  });
  if (
    version.status !== 0 ||
    help.status !== 0 ||
    !help.stdout.includes('Run and resume the durable OpenPlanr Operate lifecycle')
  ) {
    throw new ProofFailure(
      'E_CLI_ONLY_START_FAILED',
      'CLI-only package does not start or expose Operate help.',
      JSON.stringify({
        version: {
          status: version.status,
          stdout: version.stdout,
          stderr: version.stderr,
        },
        help: {
          status: help.status,
          stdout: help.stdout,
          stderr: help.stderr,
        },
      }),
    );
  }
  const inspection = runCli(
    nodeExecutable,
    cliRoot,
    ['operate', 'recovery', 'storage-status', '--json'],
    { cwd: project, env: environment },
  );
  const inspectionReport = assertJsonOutput(inspection, 'CLI-only Operate storage inspection');
  if (
    inspection.status !== 0 ||
    inspectionReport.kind !== 'operate-storage-status' ||
    inspectionReport.status !== 'empty' ||
    inspectionReport.pinnedVerifierRequired !== false ||
    inspectionReport.nextAction !== 'none'
  ) {
    throw new ProofFailure(
      'E_CLI_ONLY_OPTIONAL_BOUNDARY',
      'CLI-only Operate inspection crossed the optional-package boundary.',
      JSON.stringify({ status: inspection.status, inspection: inspectionReport }),
    );
  }
  return {
    operateHelp: commandDigest(help, [project]),
    operateUtility: {
      status: 'passed',
      ...commandDigest(inspection, [project]),
    },
    pipelineInstalled: false,
    version: commandDigest(version, [project]),
  };
}

function createReport() {
  return {
    kind: PACKED_WORKSPACE_PROOF_KIND,
    schemaVersion: PACKED_WORKSPACE_PROOF_SCHEMA_VERSION,
    ok: false,
    checks: [],
  };
}

function pass(report, id, detail = undefined) {
  report.checks.push({ id, status: 'pass', ...(detail === undefined ? {} : { detail }) });
}

function fail(report, id, detail = undefined) {
  report.checks.push({ id, status: 'fail', ...(detail === undefined ? {} : { detail }) });
}

function main() {
  const report = createReport();
  let workspace;
  try {
    const nodeExecutable = process.env.OPENPLANR_NODE_EXECUTABLE || process.execPath;
    const npmExecutable = process.env.OPENPLANR_NPM_EXECUTABLE || 'npm';
    const nodeVersion = successfulCommand(nodeExecutable, ['--version']).trim();
    const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/u, '').split('.')[0], 10);
    if (!Number.isInteger(nodeMajor) || nodeMajor < 20) {
      throw new ProofFailure(
        'E_NODE_VERSION_UNSUPPORTED',
        'Packed proof requires Node.js 20 or newer.',
      );
    }
    const npmVersion = successfulCommand(npmExecutable, ['--version']).trim();
    report.environment = {
      nodeExecutableConfigured: Boolean(process.env.OPENPLANR_NODE_EXECUTABLE),
      nodeVersion,
      npmCacheOverride: Boolean(process.env.OPENPLANR_NPM_CACHE),
      npmExecutableConfigured: Boolean(process.env.OPENPLANR_NPM_EXECUTABLE),
      npmVersion,
    };
    pass(report, 'environment.node');

    const packedSurfaceBaseline = readPackedSurfaceBaseline();
    const expectedRootSymbols = [...packedSurfaceBaseline.baselineRootSymbols].sort();
    pass(report, 'baseline.public-surface', { exportKeys: 37, rootSymbols: 229 });

    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'openplanr-packed-proof-'));
    const home = path.join(workspace, 'home');
    fs.mkdirSync(home, { recursive: true });
    const environment = cleanEnvironment(home);
    const cliArchive = packPackage({
      npmExecutable,
      sourceRoot: cliSourceRoot,
      destination: path.join(workspace, 'archives', 'cli'),
      environment,
    });
    const pipelineArchive = packPackage({
      npmExecutable,
      sourceRoot: pipelineSourceRoot,
      destination: path.join(workspace, 'archives', 'pipeline'),
      environment,
    });
    const protocolArchive = packPackage({
      npmExecutable,
      sourceRoot: protocolSourceRoot,
      destination: path.join(workspace, 'archives', 'protocol'),
      environment,
    });
    pass(report, 'pack.archives');

    const cliPackageRoot = extractPackage({
      tarball: cliArchive.tarball,
      destination: path.join(workspace, 'payloads', 'cli'),
      environment,
    });
    const pipelinePackageRoot = extractPackage({
      tarball: pipelineArchive.tarball,
      destination: path.join(workspace, 'payloads', 'pipeline'),
      environment,
    });
    const protocolPackageRoot = extractPackage({
      tarball: protocolArchive.tarball,
      destination: path.join(workspace, 'payloads', 'protocol'),
      environment,
    });
    const protocolInventory = inventoryTree(protocolPackageRoot);
    const protocolProof = packageProof(
      protocolPackageRoot,
      protocolInventory,
      '@openplanr/protocol',
    );
    const cliInventory = inventoryTree(cliPackageRoot);
    const pipelineInventory = inventoryTree(pipelinePackageRoot);
    const cliProof = packageProof(cliPackageRoot, cliInventory, 'openplanr');
    const pipelineProof = packageProof(pipelinePackageRoot, pipelineInventory, 'planr-pipeline');
    const expectedExportKeys = Object.keys(pipelineProof.manifest.exports ?? {}).sort();
    assertPackedSurfaceCompatibility(packedSurfaceBaseline, { exportKeys: expectedExportKeys });
    const protocolAssets = countProtocolAssets(pipelineInventory, packedSurfaceBaseline);
    if (
      Object.entries(PACKED_WORKSPACE_PROTOCOL_ASSET_COUNTS).some(
        ([key, count]) => protocolAssets[key] !== count,
      )
    ) {
      throw new ProofFailure(
        'E_PACK_PROTOCOL_ASSET_DRIFT',
        'Packed schema or registry inventory drifted.',
        JSON.stringify(protocolAssets),
      );
    }
    if (
      JSON.stringify(stableJson(pipelineProof.manifest.optionalDependencies ?? {})) !==
        JSON.stringify(stableJson(PIPELINE_OPTIONAL_DEPENDENCIES)) ||
      pipelineProof.manifest.peerDependencies
    ) {
      throw new ProofFailure(
        'E_PIPELINE_EXTERNAL_WORKSPACE_DEPENDENCY',
        'Pipeline package optional runtime dependencies drifted.',
      );
    }
    if (
      cliProof.manifest.optionalDependencies?.['planr-pipeline'] !==
        pipelineProof.manifest.version ||
      !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(
        cliProof.manifest.optionalDependencies['planr-pipeline'],
      )
    ) {
      throw new ProofFailure(
        'E_CLI_PIPELINE_PIN_DRIFT',
        'CLI pipeline dependency is not one exact captured version.',
      );
    }
    if (cliProof.summary.declarations < 1 || pipelineProof.summary.declarations < 1) {
      throw new ProofFailure(
        'E_PACK_DECLARATIONS_MISSING',
        'Public package declarations are missing.',
      );
    }
    pass(report, 'pack.payload-purity');
    pass(report, 'pack.protocol-assets', protocolAssets);

    const generatedSkillDrift = generatedSkillPortability(pipelinePackageRoot, pipelineInventory);
    const packagedPromptPaths = pipelineInventory
      .filter((entry) => /^(?:adapters|commands|skills)\//u.test(entry.path))
      .map((entry) => entry.path);
    if (generatedSkillDrift.length > 0) {
      throw new ProofFailure(
        'E_PACK_GENERATED_SKILL_IMPURE',
        'Packed generated skills reference private workspace or source-root state.',
        generatedSkillDrift.join(', '),
      );
    }
    if (packagedPromptPaths.length > 0) {
      throw new ProofFailure(
        'E_PACK_GENERATED_SKILL_IMPURE',
        'Packed pipeline contains host prompts or adapter assets owned by host-native plugins.',
        packagedPromptPaths.join(', '),
      );
    }
    const packedSkillCount = pipelineInventory.filter((entry) =>
      /^skills\/[^/]+\/SKILL\.md$/u.test(entry.path),
    ).length;
    if (packedSkillCount !== PACKED_WORKSPACE_GENERATED_SKILL_COUNT) {
      throw new ProofFailure(
        'E_PACK_GENERATED_SKILL_INCOMPLETE',
        'Packed pipeline prompt inventory drifted.',
        JSON.stringify({
          expected: PACKED_WORKSPACE_GENERATED_SKILL_COUNT,
          actual: packedSkillCount,
        }),
      );
    }
    pass(report, 'pack.generated-skill-portability', {
      skills: packedSkillCount,
      promptFree: true,
    });

    report.packages = {
      protocol: {
        ...protocolProof.summary,
        archiveSha256: sha256(fs.readFileSync(protocolArchive.tarball)),
        name: protocolProof.manifest.name,
      },
      cli: {
        ...cliProof.summary,
        archiveSha256: sha256(fs.readFileSync(cliArchive.tarball)),
        binAliases: stableJson(cliProof.manifest.bin),
        name: cliProof.manifest.name,
      },
      pipeline: {
        ...pipelineProof.summary,
        archiveSha256: sha256(fs.readFileSync(pipelineArchive.tarball)),
        exportKeys: Object.keys(pipelineProof.manifest.exports).length,
        generatedSkillPortability: {
          skills: packedSkillCount,
          violations: generatedSkillDrift.length,
        },
        name: pipelineProof.manifest.name,
        protocolAssets,
      },
    };

    const full = verifyFullInstall({
      nodeExecutable,
      npmExecutable,
      project: path.join(workspace, 'consumers', 'full'),
      cliArchive: cliArchive.tarball,
      pipelineArchive: pipelineArchive.tarball,
      protocolArchive: protocolArchive.tarball,
      protocolPack: { inventory: protocolInventory, proof: protocolProof },
      cliPack: { inventory: cliInventory, proof: cliProof },
      pipelinePack: { inventory: pipelineInventory, proof: pipelineProof },
      expectedExportKeys,
      expectedRootSymbols,
      environment,
    });
    pass(report, 'install.full');
    pass(report, 'install.exports-and-assets');
    pass(report, 'install.protocol-node-browser-workers', full.protocol);
    pass(report, 'cli.alias-parity');
    pass(report, 'diagram.packed-runtime');
    pass(report, 'operate.cli-owned-runtime');
    pass(report, 'operate.retired-pipeline-absence');

    const cliOnly = verifyCliOnlyInstall({
      nodeExecutable,
      npmExecutable,
      project: path.join(workspace, 'consumers', 'cli-only'),
      cliArchive: cliArchive.tarball,
      cliPack: { inventory: cliInventory, proof: cliProof },
      environment,
    });
    pass(report, 'install.cli-only');
    pass(report, 'install.optional-boundary');

    report.installs = { cliOnly, full };
    report.ok = true;
    report.proofDigest = packedWorkspaceProofDigest(report);
  } catch (error) {
    const failure =
      error instanceof ProofFailure
        ? error
        : new ProofFailure(
            'E_PACKED_PROOF_UNEXPECTED',
            error instanceof Error ? error.message : String(error),
          );
    fail(report, failure.code, failure.detail ? sanitize(failure.detail, workspace) : undefined);
    report.error = {
      code: failure.code,
      message: sanitize(failure.message, workspace),
    };
  } finally {
    try {
      safeRemoveWorkspace(workspace);
    } catch (cleanupError) {
      const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      if (report.ok) {
        report.ok = false;
        report.error = { code: 'E_PROOF_CLEANUP_FAILED', message: sanitize(detail, workspace) };
        fail(report, 'cleanup.workspace');
      }
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) main();
