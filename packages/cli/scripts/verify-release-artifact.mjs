#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inventoryTree,
  payloadBytesEqual,
  payloadDigest,
  runInstalledExportProbes,
  validateExportTargets,
  validatePackagedMarkdownLinks,
  verifyPackedSourceParity,
} from './package-contract.mjs';
import { isPathInside, resolvePipelineCandidateSourceRoot } from './release-package-input.mjs';

/**
 * Smoke-tests the PACKED artifact the way a user receives it: pack, install into
 * a clean prefix with a clean HOME, and confirm the CLI starts and configures a
 * project.
 *
 * Scope is deliberately narrow. This runs before every publish, so it must be
 * deterministic on any host — no questionnaire stages, no cycle lifecycle, no
 * runtime detection. The deeper end-to-end journey lives in
 * `verify-release-journey.mjs`, which is run on demand rather than gating a
 * release: driving a full operate cycle depends on host-specific runtime
 * detection, and a flaky blocker is worse than no blocker.
 *
 * Every defect this gate exists to catch shipped through a green suite:
 *
 *   - a pipeline pin that only resolves through `node_modules`, which every test
 *     bypasses by setting OPENPLANR_PIPELINE_ROOT to a source checkout, so
 *     `planr setup` failed on every correctly-installed machine while CI passed
 *   - a release smoke probe calling a removed Operate inspection command
 *   - the Node CLI importing a runtime value from Vite-owned dashboard output
 *
 * The common shape: each part was individually correct and the assembly was not.
 * Unit and contract tests cannot see that. This can, because it installs the
 * tarball into a clean prefix with a clean HOME and then just uses the product.
 *
 * Exit codes
 *   0  the packed artifact installs and starts correctly
 *   1  a smoke assertion failed — do not publish
 *   2  the gate itself could not run (pack/install/network) — never silently 0,
 *      because an unrunnable gate must not read as a passing one
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Thrown to end the journey early after a check has already been recorded. */
class JourneyStop extends Error {}
const failures = [];
const notes = [];

function check(description, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${description}`);
  } else {
    console.log(`  ✗ ${description}${detail ? ` — ${detail}` : ''}`);
    failures.push(description);
  }
}

function must(description, condition, detail = '') {
  check(description, condition, detail);
  if (!condition) throw new JourneyStop(description);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function sha256File(path) {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function packCandidate(destination, environment, sourceRoot = repositoryRoot) {
  mkdirSync(destination, { recursive: true });
  const output = JSON.parse(
    run(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', destination],
      { cwd: sourceRoot, env: environment },
    ),
  );
  const report = Array.isArray(output) ? output[0] : undefined;
  const filename = report?.filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('npm pack did not report one candidate filename');
  }
  const tarball = join(destination, filename);
  if (!existsSync(tarball) || !lstatSync(tarball).isFile()) {
    throw new Error('npm pack did not create the reported candidate tarball');
  }
  return { ...report, filename, tarball };
}

function extractPackage(tarball, destination) {
  mkdirSync(destination, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', destination]);
  const packageRoot = join(destination, 'package');
  if (
    !existsSync(packageRoot)
    || !lstatSync(packageRoot).isDirectory()
    || lstatSync(packageRoot).isSymbolicLink()
  ) {
    throw new Error('packed archive does not contain one real package root');
  }
  return packageRoot;
}

function inventoryOrStop(root, description) {
  try {
    return inventoryTree(root);
  } catch (error) {
    must(description, false, error instanceof Error ? error.message : String(error));
  }
}

function cleanEnvironment(home) {
  const environment = { ...process.env, HOME: home, USERPROFILE: home };
  for (const key of [
    'OPENPLANR_PIPELINE_ROOT',
    'OPENPLANR_ECOSYSTEM_SOURCE',
    'OPENPLANR_PIPELINE_TARBALL',
    'OPENPLANR_VERIFIER_SOURCE_ROOT',
    'PLANR_PIPELINE_ROOT',
    'PLANR_PIPELINE_VERIFIER_SOURCE_ROOT',
  ]) {
    delete environment[key];
  }
  // Strip provider credentials so the deterministic install probe observes the
  // same clean-machine environment locally and in CI.
  for (const key of Object.keys(environment)) {
    if (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE|AZURE_OPENAI|OPENPLANR)_.*(KEY|TOKEN|SECRET)$/i.test(key)) {
      delete environment[key];
    }
  }
  return environment;
}

function installedPackageRoot(prefix, name) {
  const lexicalRoot = join(prefix, 'node_modules', name);
  must(
    `${name} is installed as a real directory`,
    existsSync(lexicalRoot)
      && lstatSync(lexicalRoot).isDirectory()
      && !lstatSync(lexicalRoot).isSymbolicLink(),
  );
  const installedRoot = realpathSync(lexicalRoot);
  const expectedRoot = join(realpathSync(join(prefix, 'node_modules')), name);
  must(
    `${name} resolves inside the disposable package prefix`,
    isPathInside(prefix, installedRoot) && installedRoot === expectedRoot,
    `resolved ${installedRoot}`,
  );
  return installedRoot;
}

let workspace;
try {
  const pipelineCandidate = resolvePipelineCandidateSourceRoot({ openPlanrRoot: repositoryRoot });
  workspace = mkdtempSync(join(tmpdir(), 'openplanr-release-artifact-'));
  const prefix = join(workspace, 'prefix');
  const home = join(workspace, 'home');
  const project = join(workspace, 'project');
  for (const directory of [prefix, home, project]) mkdirSync(directory, { recursive: true });

  const environment = cleanEnvironment(home);
  must(
    'source-checkout fallback environment is absent',
    environment.OPENPLANR_PIPELINE_ROOT === undefined
      && environment.OPENPLANR_ECOSYSTEM_SOURCE === undefined
      && environment.OPENPLANR_PIPELINE_TARBALL === undefined
      && environment.OPENPLANR_VERIFIER_SOURCE_ROOT === undefined
      && environment.PLANR_PIPELINE_ROOT === undefined
      && environment.PLANR_PIPELINE_VERIFIER_SOURCE_ROOT === undefined,
  );

  console.log('Building the complete OpenPlanr candidate…');
  run('npm', ['run', 'build'], { cwd: repositoryRoot, env: environment });

  console.log('Packing the frozen artifact twice…');
  const first = packCandidate(join(workspace, 'pack-one'), environment);
  const second = packCandidate(join(workspace, 'pack-two'), environment);
  const firstPackageRoot = extractPackage(first.tarball, join(workspace, 'extract-one'));
  const secondPackageRoot = extractPackage(second.tarball, join(workspace, 'extract-two'));
  const firstInventory = inventoryOrStop(
    firstPackageRoot,
    'first packed OpenPlanr payload contains no symbolic links',
  );
  const secondInventory = inventoryOrStop(
    secondPackageRoot,
    'second packed OpenPlanr payload contains no symbolic links',
  );
  const firstDigest = payloadDigest(firstInventory);
  const secondDigest = payloadDigest(secondInventory);
  must(
    'two packs from one frozen build have an exact payload inventory and digest',
    JSON.stringify(firstInventory) === JSON.stringify(secondInventory)
      && firstDigest === secondDigest,
    `${firstDigest} != ${secondDigest}`,
  );
  must(
    'two packs from one frozen build are byte-for-byte deterministic archives',
    sha256File(first.tarball) === sha256File(second.tarball),
  );

  console.log('Packing the repository-bound pipeline candidate twice…');
  const pipelineFirst = packCandidate(
    join(workspace, 'pipeline-pack-one'),
    environment,
    pipelineCandidate.root,
  );
  const pipelineSecond = packCandidate(
    join(workspace, 'pipeline-pack-two'),
    environment,
    pipelineCandidate.root,
  );
  const pipelinePackageRoot = extractPackage(
    pipelineFirst.tarball,
    join(workspace, 'extract-pipeline-one'),
  );
  const pipelineSecondRoot = extractPackage(
    pipelineSecond.tarball,
    join(workspace, 'extract-pipeline-two'),
  );
  const pipelineInventory = inventoryOrStop(
    pipelinePackageRoot,
    'repository-bound pipeline candidate payload contains no symbolic links',
  );
  const pipelineSecondInventory = inventoryOrStop(
    pipelineSecondRoot,
    'second pipeline candidate payload contains no symbolic links',
  );
  must(
    'repository-bound pipeline packs have an exact payload inventory and digest',
    JSON.stringify(pipelineInventory) === JSON.stringify(pipelineSecondInventory)
      && payloadDigest(pipelineInventory) === payloadDigest(pipelineSecondInventory),
  );
  must(
    'repository-bound pipeline packs are byte-for-byte deterministic archives',
    sha256File(pipelineFirst.tarball) === sha256File(pipelineSecond.tarball),
  );
  const pipelinePackedPaths = pipelineFirst.files.map(({ path }) => path);
  const pipelineSourceProof = verifyPackedSourceParity(
    pipelineCandidate.root,
    pipelinePackageRoot,
    pipelinePackedPaths,
  );
  must(
    'pipeline archive payload is digest-bound to its repository candidate bytes',
    pipelineSourceProof.count === pipelineInventory.length,
    pipelineSourceProof.digest,
  );

  const packedManifest = JSON.parse(
    readFileSync(join(firstPackageRoot, 'package.json'), 'utf8'),
  );
  const packedPaths = firstInventory.map((entry) => entry.path);
  const exportReport = validateExportTargets(packedManifest.exports, packedPaths);
  must('packed artifact declares at least one public export', exportReport.targets.length > 0);
  must(
    'every public package export target exists in the packed artifact',
    exportReport.violations.length === 0,
    exportReport.violations.join('; '),
  );
  const documentationReport = validatePackagedMarkdownLinks(firstPackageRoot, packedPaths);
  must(
    'packaged Markdown inventory includes README, contribution, and reference documentation',
    documentationReport.documents.includes('README.md')
      && documentationReport.documents.includes('CONTRIBUTING.md')
      && documentationReport.documents.some((path) => path.startsWith('docs/')),
    documentationReport.documents.join(', '),
  );
  must(
    'every packaged local Markdown link resolves inside the artifact',
    documentationReport.violations.length === 0,
    documentationReport.violations.join('; '),
  );

  const pipelineManifest = JSON.parse(
    readFileSync(join(pipelinePackageRoot, 'package.json'), 'utf8'),
  );
  must('repository-bound pipeline candidate is planr-pipeline', pipelineManifest.name === 'planr-pipeline');
  must(
    'packed pipeline identity matches the selected repository candidate',
    pipelineManifest.version === pipelineCandidate.manifest.version,
  );
  must(
    'OpenPlanr declares the exact packed pipeline candidate version',
    packedManifest.optionalDependencies?.['planr-pipeline'] === pipelineManifest.version,
    [
      `expected ${String(packedManifest.optionalDependencies?.['planr-pipeline'])}`,
      `candidate ${String(pipelineManifest.version)}`,
    ].join(', '),
  );

  console.log(`Installing ${first.filename} with the exact repository-bound pipeline candidate…`);
  writeFileSync(join(prefix, 'package.json'), '{"name":"release-gate","private":true}\n');
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      first.tarball,
      pipelineFirst.tarball,
    ],
    { cwd: prefix, env: environment, stdio: 'pipe' },
  );

  const cli = join(prefix, 'node_modules', '.bin', 'planr');

  const cliOutput = (args, options = {}) =>
    run(cli, args, { cwd: project, env: environment, ...options });

  console.log('\nJourney:');

  // Read manifests directly from the two package roots whose custody was
  // established above; consumer resolution is checked separately below.
  const readManifest = (...segments) =>
    JSON.parse(readFileSync(join(prefix, 'node_modules', ...segments, 'package.json'), 'utf8'));
  const installedOpenPlanr = readManifest('openplanr');
  const installedPipeline = readManifest('planr-pipeline');
  const installedOpenPlanrRoot = installedPackageRoot(prefix, 'openplanr');
  const installedPipelineRoot = installedPackageRoot(prefix, 'planr-pipeline');
  must('installed OpenPlanr manifest names openplanr', installedOpenPlanr.name === 'openplanr');
  must(
    'installed OpenPlanr bytes exactly match the packed candidate',
    payloadBytesEqual(firstInventory, inventoryOrStop(
      installedOpenPlanrRoot,
      'installed OpenPlanr payload contains no symbolic links',
    )),
  );
  must(
    'installed pipeline bytes exactly match the explicit packed candidate',
    payloadBytesEqual(pipelineInventory, inventoryOrStop(
      installedPipelineRoot,
      'installed pipeline payload contains no symbolic links',
    )),
  );
  console.log(`  · installed pipeline ${installedPipeline.version}`);
  console.log(`  · OPENPLANR_PIPELINE_ROOT cleared: ${environment.OPENPLANR_PIPELINE_ROOT === undefined}`);

  const installedOpenPlanrExports = runInstalledExportProbes({
    packageName: installedOpenPlanr.name,
    exportsField: installedOpenPlanr.exports,
    packedPaths,
    installedPackageRoot: installedOpenPlanrRoot,
    consumerRoot: prefix,
    environment,
  });
  must(
    'every installed OpenPlanr runtime export and condition loads from consumer-owned bytes',
    installedOpenPlanrExports.runtime > 0
      && installedOpenPlanrExports.count === installedOpenPlanrExports.results.length,
    installedOpenPlanrExports.digest,
  );
  const installedPipelineExports = runInstalledExportProbes({
    packageName: installedPipeline.name,
    exportsField: installedPipeline.exports,
    packedPaths: pipelinePackedPaths,
    installedPackageRoot: installedPipelineRoot,
    consumerRoot: prefix,
    environment,
  });
  must(
    'every installed pipeline runtime export and condition loads from consumer-owned bytes',
    installedPipelineExports.runtime > 0
      && installedPipelineExports.typeOnly > 0
      && installedPipelineExports.json > 0
      && installedPipelineExports.count === installedPipelineExports.results.length,
    installedPipelineExports.digest,
  );

  const consumer = join(prefix, 'consumer.mjs');
  writeFileSync(
    consumer,
    [
      "import { readFileSync } from 'node:fs';",
      "import { createRequire } from 'node:module';",
      "import { pathToFileURL } from 'node:url';",
      'const require = createRequire(import.meta.url);',
      "const dashboardPath = require.resolve('openplanr/dashboard');",
      "const verifierPath = require.resolve('openplanr/dashboard-verifier');",
      "const openPlanrRequire = createRequire(require.resolve('openplanr/package.json'));",
      "const pipelinePath = openPlanrRequire.resolve('planr-pipeline/package.json');",
      'const verifier = await import(pathToFileURL(verifierPath).href);',
      'const report = verifier.verifyDashboardAssets();',
      "const manifest = JSON.parse(readFileSync(dashboardPath, 'utf8'));",
      'process.stdout.write(JSON.stringify({ dashboardPath, verifierPath, pipelinePath, report, manifest }));',
      '',
    ].join('\n'),
  );
  const consumerResult = JSON.parse(
    run(process.execPath, [consumer], { cwd: prefix, env: environment }),
  );
  must(
    'clean consumer resolves ./dashboard from installed OpenPlanr bytes',
    isPathInside(installedOpenPlanrRoot, consumerResult.dashboardPath)
      && !lstatSync(consumerResult.dashboardPath).isSymbolicLink()
      && consumerResult.manifest?.kind === 'openplanr-dashboard-build',
  );
  must(
    'clean consumer resolves ./dashboard-verifier from installed OpenPlanr bytes',
    isPathInside(installedOpenPlanrRoot, consumerResult.verifierPath)
      && !lstatSync(consumerResult.verifierPath).isSymbolicLink(),
  );
  must(
    'installed OpenPlanr resolves the exact installed pipeline candidate',
    realpathSync(consumerResult.pipelinePath)
      === realpathSync(join(installedPipelineRoot, 'package.json')),
  );
  must(
    'installed dashboard manifest and assets pass installed-byte verification',
    consumerResult.report?.ok === true
      && consumerResult.report?.buildId === consumerResult.manifest?.buildId,
    JSON.stringify(consumerResult.report),
  );

  writeFileSync(join(project, 'package.json'), '{"name":"gate-project","version":"1.0.0"}\n');
  // Citations are anchored to a revision, so the fixture has to be a real
  // repository with a real commit — the same thing a user's project is.
  run('git', ['init', '-q'], { cwd: project });
  run('git', ['add', '-A'], { cwd: project });
  run(
    'git',
    ['-c', 'user.email=gate@example.invalid', '-c', 'user.name=Release Gate', 'commit', '-qm', 'fixture'],
    { cwd: project },
  );

  const inspection = JSON.parse(cliOutput(['operate', 'recovery', 'inspect', '--json']));
  check(
    'operate recovery inspect succeeds on a fresh project',
    inspection.ok === true && inspection.operation === 'operate.recovery.inspect',
  );
  check(
    'recovery inspection returns the current Operate empty-store contract',
    inspection.data?.status === 'empty' &&
      inspection.data?.allowedRecovery === 'none' &&
      inspection.data?.integrityBoundary?.model === 'project-local-integrity',
    `reported ${JSON.stringify(inspection.data)}`,
  );

  // `setup` is the front door; it broke for every user once while CI stayed green.
  let setupExit = 0;
  try {
    cliOutput(['setup', '--yes', '--runtime', 'codex'], { stdio: 'pipe' });
  } catch (error) {
    setupExit = error.status ?? 1;
    notes.push(`setup stderr: ${String(error.stderr ?? '').slice(0, 400)}`);
  }
  check('planr setup completes on a clean machine', setupExit === 0);

  const skills = (() => {
    try {
      return readdirSync(join(home, '.codex', 'skills'));
    } catch {
      return [];
    }
  })();
  check('setup installed the runtime skills it reported', skills.length > 0, `found ${skills.length}`);
  console.log('');
} catch (error) {
  if (!(error instanceof JourneyStop)) {
    console.error(`\nRelease-artifact gate could not run: ${error.message}`);
    if (workspace) rmSync(workspace, { recursive: true, force: true });
    process.exit(2);
  }
}

if (workspace) rmSync(workspace, { recursive: true, force: true });
for (const note of notes) console.log(note);

if (failures.length) {
  console.error(`\n${failures.length} smoke assertion(s) failed against the packed artifact.`);
  console.error('Do not publish: the tests may pass, but the shipped artifact does not start.');
  process.exit(1);
}
console.log('The packed artifact installs and starts correctly.');
