#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  discoverEcosystemRepositories,
  resolveWorkspaceRoot,
} from '../lib/ecosystem/workspace-discovery.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = process.cwd();
const sourceCheckout =
  process.env.OPENPLANR_DOCTOR_PACKAGE_MODE !== '1' &&
  existsSync(join(root, 'input/tech/stack.md'));
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const workspace = resolveWorkspaceRoot({ pipelineRoot: root, argv: rawArgs });
const ecosystem = discoverEcosystemRepositories({
  pipelineRoot: root,
  workspaceRoot: workspace.path,
});

const options = {
  versionsOnly: args.has('--versions-only'),
  strict: args.has('--strict') || process.env.OPENPLANR_STRICT_ECOSYSTEM === '1',
  release: args.has('--release'),
  json: args.has('--json'),
  repairPreview: args.has('--repair-preview'),
  fix: args.has('--fix'),
};

const checks = [];
const repairs = [];

function addCheck({ id, category, status, severity, message, fix = '', strictFail = false }) {
  let finalStatus = status;
  let finalSeverity = severity;
  let finalMessage = message;

  if (options.strict && status === 'warn' && strictFail) {
    finalStatus = 'fail';
    finalSeverity = 'error';
    finalMessage = `${message} (strict mode)`;
  }

  checks.push({
    id,
    category,
    status: finalStatus,
    severity: finalSeverity,
    message: finalMessage,
    ...(fix ? { fix } : {}),
  });
}

function ok(id, category, message, fix = '') {
  addCheck({ id, category, status: 'ok', severity: 'info', message, fix });
}

function warn(id, category, message, fix = '', strictFail = false) {
  addCheck({ id, category, status: 'warn', severity: 'warning', message, fix, strictFail });
}

function fail(id, category, message, fix = '') {
  addCheck({ id, category, status: 'fail', severity: 'error', message, fix });
}

function readText(relPath) {
  return readFileSync(join(root, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function run(command, argsList, cwd = root) {
  return spawnSync(command, argsList, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function commandExists(command) {
  const result = run(command, ['--version']);
  return result.status === 0;
}

function parseSemver(version) {
  const match = String(version).match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

function satisfiesNodeEngine(current, range) {
  const match = String(range || '').trim().match(/^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!match) return true;

  const minimum = [
    Number.parseInt(match[1], 10),
    Number.parseInt(match[2] || '0', 10),
    Number.parseInt(match[3] || '0', 10),
  ];
  const actual = parseSemver(current);
  if (!actual) return false;

  return compareVersions(actual, minimum) >= 0;
}

function listMarkdown(dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name));
}

function gitIgnored(absPath, base = root) {
  const relPath = relative(base, absPath);
  const result = run('git', ['check-ignore', '-q', relPath], base);
  return result.status === 0;
}

function checkLocalhostHealth(id, label, dirName) {
  const stateDir = join(process.env.PLANR_HOME || join(homedir(), '.planr'), dirName);
  const portFile = join(stateDir, 'port');
  if (!existsSync(portFile)) {
    ok(`${id}.state`, 'Daemons', `${label} daemon state file is absent; no running daemon detected`);
    return;
  }

  const port = readFileSync(portFile, 'utf8').trim();
  if (!/^\d+$/.test(port)) {
    handleStaleDaemon(id, label, stateDir, `${label} daemon port file is invalid`);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 750);

  pendingHealthChecks.push(
    fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal })
      .then(async (response) => {
        clearTimeout(timeout);
        if (!response.ok) {
          handleStaleDaemon(id, label, stateDir, `${label} daemon health returned HTTP ${response.status}`);
          return;
        }

        const body = await response.json().catch(() => ({}));
        if (body?.ok === true) {
          ok(`${id}.health`, 'Daemons', `${label} daemon is healthy on localhost:${port}`);
        } else {
          handleStaleDaemon(id, label, stateDir, `${label} daemon health response is not ok`);
        }
      })
      .catch(() => {
        clearTimeout(timeout);
        handleStaleDaemon(id, label, stateDir, `${label} daemon state exists but localhost:${port} is unreachable`);
      }),
  );
}

function handleStaleDaemon(id, label, stateDir, message) {
  const repair = { id: `${id}.state`, operation: 'remove', target: stateDir };
  if (options.fix) {
    rmSync(stateDir, { recursive: true, force: true });
    repairs.push({ ...repair, applied: true });
    ok(`${id}.health`, 'Daemons', `Removed stale ${label.toLowerCase()} daemon state under ${stateDir}`);
    return;
  }
  if (options.repairPreview) repairs.push({ ...repair, applied: false });
  warn(`${id}.health`, 'Daemons', message, 'Run `planr doctor --fix` to preview and remove this Planr-owned stale state.');
}

function readGithubRelease(cwd, tag) {
  if (!commandExists('gh')) {
    return { available: false, ok: false };
  }

  const result = run('gh', ['release', 'view', tag, '--json', 'tagName', '--jq', '.tagName'], cwd);
  return { available: true, ok: result.status === 0 };
}

function remoteTagExists(cwd, tag) {
  const result = run('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], cwd);
  return result.status === 0;
}

function checkRelease(id, label, cwd, version) {
  const tag = `v${version}`;

  if (remoteTagExists(cwd, tag)) {
    ok(`${id}.tag`, 'Releases', `${label} tag ${tag} exists on origin`);
  } else {
    warn(`${id}.tag`, 'Releases', `${label} tag ${tag} is missing on origin`, `Create and push tag ${tag}.`, true);
  }

  const release = readGithubRelease(cwd, tag);
  if (!release.available) {
    warn(`${id}.release`, 'Releases', '`gh` is not available; GitHub release check skipped', 'Install GitHub CLI or verify releases manually.', true);
  } else if (release.ok) {
    ok(`${id}.release`, 'Releases', `${label} GitHub release ${tag} exists`);
  } else {
    warn(`${id}.release`, 'Releases', `${label} GitHub release ${tag} is missing`, `Create GitHub release ${tag}.`, true);
  }
}

const pendingHealthChecks = [];

function runEnvironmentChecks(pkg) {
  const nodeRange = pkg.engines?.node;
  if (!nodeRange) {
    warn('environment.node-engine', 'Environment', 'package.json has no engines.node requirement', 'Declare the supported Node range.');
    return;
  }

  if (satisfiesNodeEngine(process.versions.node, nodeRange)) {
    ok('environment.node-engine', 'Environment', `Node ${process.versions.node} satisfies engines.node ${nodeRange}`);
  } else {
    fail('environment.node-engine', 'Environment', `Node ${process.versions.node} does not satisfy engines.node ${nodeRange}`, 'Use Node 20 or newer.');
  }
}

function runVersionAndProtocolChecks(pkg) {
  const version = pkg.version;
  const plugin = readJson('.claude-plugin/plugin.json');

  if (plugin.version === version) {
    ok('versions.package-plugin', 'Versions', `package.json and .claude-plugin/plugin.json agree on ${version}`);
  } else {
    fail('versions.package-plugin', 'Versions', `.claude-plugin/plugin.json is ${plugin.version}, expected ${version}`, 'Update both files together.');
  }

  if (sourceCheckout) {
    const stack = readText('input/tech/stack.md');
    const stackVersion = stack.match(/^Version:\s*"([^"]+)"/m)?.[1];
    if (stackVersion === version) {
      ok('versions.stack', 'Versions', `input/tech/stack.md Version matches ${version}`);
    } else {
      fail('versions.stack', 'Versions', `input/tech/stack.md Version is ${stackVersion || '(missing)'}, expected ${version}`, 'Update input/tech/stack.md release metadata.');
    }
  } else {
    ok('versions.package-mode', 'Versions', 'installed package health mode does not require repository-only release metadata');
  }

  const protocol = readText('docs/protocol/README.md');
  if (protocol.includes(`planr-pipeline v${version}`)) {
    ok('versions.protocol-readme', 'Versions', `protocol README names planr-pipeline v${version}`);
  } else {
    fail('versions.protocol-readme', 'Versions', `protocol README does not name planr-pipeline v${version}`, 'Update docs/protocol/README.md.');
  }

  if (sourceCheckout) {
    const matrix = readText('docs/compatibility-matrix.md');
    if (matrix.includes(`planr-pipeline v${version}`)) {
      ok('versions.compatibility-matrix', 'Versions', `compatibility matrix names planr-pipeline v${version}`);
    } else {
      fail('versions.compatibility-matrix', 'Versions', `compatibility matrix does not name planr-pipeline v${version}`, 'Update docs/compatibility-matrix.md.');
    }
  }

  if (protocol.includes('schemas/v1.0.0/')) {
    ok('protocol.schema-reference', 'Protocol', 'protocol README points to schemas/v1.0.0 as canonical');
  } else {
    fail('protocol.schema-reference', 'Protocol', 'protocol README does not point to schemas/v1.0.0', 'Keep schema ownership explicit in docs/protocol/README.md.');
  }

  const schemaDir = join(root, 'schemas/v1.0.0');
  const requiredSchemas = [
    'graph.schema.json',
    'pipeline-shipped.schema.json',
    'spec.schema.json',
    'stack.schema.json',
    'story.schema.json',
    'task.schema.json',
  ];
  const missingSchemas = requiredSchemas.filter((name) => !existsSync(join(schemaDir, name)));
  if (missingSchemas.length === 0) {
    ok('protocol.schemas-present', 'Protocol', 'schemas/v1.0.0 contains the required protocol schemas');
  } else {
    fail('protocol.schemas-present', 'Protocol', `schemas/v1.0.0 is missing ${missingSchemas.join(', ')}`, 'Restore the canonical schema files.');
  }

  const sync = readText('commands/sync.md');
  if (/qa_gate_status:\s*PASS\b/.test(sync)) {
    fail('protocol.qa-gate-uppercase', 'Protocol', 'sync docs use uppercase qa_gate_status PASS', 'Use passed, failed, or skipped.');
  } else if (/qa_gate_status:\s*passed\b/.test(sync)) {
    ok('protocol.qa-gate-values', 'Protocol', 'qa_gate_status docs use schema value passed');
  } else {
    fail('protocol.qa-gate-values', 'Protocol', 'sync docs do not show qa_gate_status: passed', 'Document the schema enum values.');
  }

  const markerSchema = readJson('schemas/v1.0.0/pipeline-shipped.schema.json');
  const qaEnum = markerSchema.properties?.qa_gate_status?.enum || [];
  if (JSON.stringify(qaEnum) === JSON.stringify(['passed', 'failed', 'skipped'])) {
    ok('protocol.qa-gate-schema', 'Protocol', 'pipeline-shipped schema keeps qa_gate_status values passed, failed, skipped');
  } else {
    fail('protocol.qa-gate-schema', 'Protocol', `pipeline-shipped schema qa_gate_status enum is ${qaEnum.join(', ')}`, 'Restore passed, failed, skipped.');
  }

  if (!sourceCheckout) {
    // ADRs remain source-owned release evidence and are intentionally absent
    // from the portable runtime package.
  } else if (existsSync(join(root, 'docs/adrs/ADR-001-protocol-ownership.md'))) {
    ok('protocol.ownership-adr', 'Protocol', 'protocol ownership ADR exists');
  } else {
    fail('protocol.ownership-adr', 'Protocol', 'protocol ownership ADR is missing', 'Restore docs/adrs/ADR-001-protocol-ownership.md.');
  }

  const staleActiveDocs = [
    'README.md',
    'docs/protocol/README.md',
    'docs/compatibility-matrix.md',
    'docs/protocol/spec-artifacts.md',
    'input/tech/stack.md',
    'commands/sync.md',
    'schemas/v1.0.0/pipeline-shipped.schema.json',
  ].filter((file) => existsSync(join(root, file)));
  const stalePatterns = [
    { label: 'planr-pipeline v0.6.0', regex: /planr-pipeline v0\.6\.0/ },
    { label: 'planr-pipeline v0.13.0', regex: /planr-pipeline v0\.13\.0/ },
    { label: 'pinned model v0.10.0 note', regex: /v0\.10\.0/ },
    { label: 'stack/schema example 0.7.3', regex: /\b0\.7\.3\b/ },
    { label: 'uppercase qa_gate_status PASS', regex: /qa_gate_status:\s*PASS\b/ },
  ];
  const staleHits = [];
  for (const file of staleActiveDocs) {
    const text = readText(file);
    for (const { label, regex } of stalePatterns) {
      if (regex.test(text)) staleHits.push(`${file}: ${label}`);
    }
  }
  if (staleHits.length === 0) {
    ok('versions.no-stale-active-docs', 'Versions', 'active docs have no stale version or shipped-marker claims');
  } else {
    fail('versions.no-stale-active-docs', 'Versions', `stale active docs found: ${staleHits.join('; ')}`, 'Update active docs or move historical claims to changelog only.');
  }

  const modelContextFiles = ['README.md', ...listMarkdown('agents')];
  const contextHits = [];
  for (const file of modelContextFiles) {
    if (/claude-[a-z0-9-]+\[[^\]]+\]/i.test(readText(file))) contextHits.push(file);
  }
  if (contextHits.length === 0) {
    ok('versions.no-model-context-suffix', 'Versions', 'Claude model strings rely on default context window');
  } else {
    fail('versions.no-model-context-suffix', 'Versions', `explicit Claude context-window suffix found in ${contextHits.join(', ')}`, 'Remove [context] suffixes from active model strings.');
  }
}

function runEcosystemChecks(pkg) {
  const version = pkg.version;
  ok(
    'ecosystem.workspace-root',
    'Ecosystem',
    `ecosystem workspace resolved from ${workspace.source}: ${ecosystem.workspaceRoot}`,
  );

  const marketplaceRoot = ecosystem.repositories.marketplace?.path;
  const skillsRoot = ecosystem.repositories.skills?.path;
  const openPlanrRoot = ecosystem.repositories.cli?.path;
  const marketplaceManifest = marketplaceRoot
    ? join(marketplaceRoot, '.claude-plugin/marketplace.json')
    : null;
  const skillsManifest = skillsRoot
    ? join(skillsRoot, '.claude-plugin/marketplace.json')
    : null;
  const openPlanrPackage = openPlanrRoot ? join(openPlanrRoot, 'package.json') : null;

  let marketplace = null;
  if (marketplaceManifest && existsSync(marketplaceManifest)) {
    marketplace = readJsonFile(marketplaceManifest);
    const pipelinePlugin = (marketplace.plugins || []).find((entry) => entry.name === 'planr-pipeline');
    if (pipelinePlugin?.version === version) {
      ok('ecosystem.marketplace-pipeline-version', 'Ecosystem', `marketplace planr-pipeline version matches ${version}`);
    } else {
      warn('ecosystem.marketplace-pipeline-version', 'Ecosystem', `marketplace planr-pipeline version is ${pipelinePlugin?.version || '(missing)'}, expected ${version}`, 'Update marketplace/.claude-plugin/marketplace.json.', true);
    }

    const readmePath = join(marketplaceRoot, 'README.md');
    if (existsSync(readmePath)) {
      const readme = readFileSync(readmePath, 'utf8');
      const errors = [];
      for (const plugin of marketplace.plugins || []) {
        const row = readme.split('\n').find((line) => line.includes(`[\`${plugin.name}\`]`));
        if (!row) errors.push(`missing README row for ${plugin.name}`);
        else if (!row.includes(`| ${plugin.version} |`)) errors.push(`${plugin.name} README row does not match ${plugin.version}`);
      }
      if (!readme.includes('Versions in this README mirror `.claude-plugin/marketplace.json`')) {
        errors.push('manifest mirror note missing');
      }
      if (errors.length === 0) {
        ok('ecosystem.marketplace-readme', 'Ecosystem', 'marketplace README matches marketplace manifest');
      } else {
        warn('ecosystem.marketplace-readme', 'Ecosystem', `marketplace README mismatch: ${errors.join('; ')}`, 'Run npm run check in the marketplace repo and update README.', true);
      }
    } else {
      warn('ecosystem.marketplace-readme', 'Ecosystem', 'marketplace README.md is missing', 'Restore marketplace/README.md.', true);
    }
  } else {
    warn('ecosystem.marketplace-present', 'Ecosystem', 'marketplace repo not found', 'Use --workspace-root or OPENPLANR_ECOSYSTEM_ROOT to point at sibling OpenPlanr repos.', true);
  }

  if (skillsManifest && existsSync(skillsManifest)) {
    const skills = readJsonFile(skillsManifest);
    const skillVersion = skills.metadata?.version;
    if (skillVersion) {
      ok('ecosystem.skills-version-present', 'Ecosystem', `skills manifest reports version ${skillVersion}`);
    } else {
      warn('ecosystem.skills-version-present', 'Ecosystem', 'skills manifest has no metadata.version', 'Add metadata.version to skills/.claude-plugin/marketplace.json.', true);
    }

    const marketplaceSkill = (marketplace?.plugins || []).find((entry) => entry.name === 'openplanr');
    if (marketplace && skillVersion && marketplaceSkill?.version === skillVersion) {
      ok('ecosystem.marketplace-skills-version', 'Ecosystem', `marketplace openplanr version matches skills ${skillVersion}`);
    } else if (marketplace && skillVersion) {
      warn('ecosystem.marketplace-skills-version', 'Ecosystem', `marketplace openplanr version is ${marketplaceSkill?.version || '(missing)'}, expected ${skillVersion}`, 'Update marketplace/.claude-plugin/marketplace.json.', true);
    }
  } else {
    warn('ecosystem.skills-present', 'Ecosystem', 'skills repo not found', 'Use --workspace-root or OPENPLANR_ECOSYSTEM_ROOT to point at sibling OpenPlanr repos.', true);
  }

  if (openPlanrPackage && existsSync(openPlanrPackage)) {
    const openPlanr = readJsonFile(openPlanrPackage);
    if (openPlanr.version) {
      ok('ecosystem.openplanr-version-present', 'Ecosystem', `OpenPlanr package version is ${openPlanr.version}`);
    } else {
      warn('ecosystem.openplanr-version-present', 'Ecosystem', 'OpenPlanr package.json has no version', 'Restore package.json version.', true);
    }
  } else {
    warn('ecosystem.openplanr-present', 'Ecosystem', 'OpenPlanr CLI repo not found', 'Use --workspace-root or OPENPLANR_ECOSYSTEM_ROOT to point at sibling OpenPlanr repos.', true);
  }
}

function runDaemonChecks() {
  checkLocalhostHealth('daemon.design', 'Design board', 'design-daemon');
  checkLocalhostHealth('daemon.dashboard', 'Dashboard', 'dashboard-daemon');
}

function runCredentialChecks() {
  const envFiles = ['.env', '.env.local'];
  let found = false;

  for (const file of envFiles) {
    const absPath = join(projectRoot, file);
    if (!existsSync(absPath)) continue;
    const text = readFileSync(absPath, 'utf8');
    if (!/^\s*OPENAI_API_KEY\s*=/m.test(text)) continue;
    found = true;

    if (gitIgnored(absPath, projectRoot)) {
      ok(`credentials.${file}`, 'Credentials', `${file} contains OPENAI_API_KEY and is gitignored`);
    } else {
      warn(`credentials.${file}`, 'Credentials', `${file} contains OPENAI_API_KEY and is not gitignored`, `Add ${file} to .gitignore or move the key to user-level credentials.`);
    }
  }

  if (!found) {
    ok('credentials.project-env', 'Credentials', 'project .env files do not contain OPENAI_API_KEY');
  }
}

async function runArtifactChecks() {
  const required = [
    'adapters/codex/skills/planr-artifact/SKILL.md',
    'bin/planr-pipeline.mjs',
    'conformance/verify-artifact-review.mjs',
    'docs/artifact-review.md',
    'lib/artifact/bundle.mjs',
    'lib/artifact/codec.mjs',
    'lib/artifact/crypto.mjs',
    'lib/artifact/import.mjs',
    'lib/artifact/merge.mjs',
    'lib/artifact/review-server.mjs',
    'lib/artifact/share-client.mjs',
    'lib/artifact/ui/generated/artifact-shell-assets.json',
    'lib/design-engine/artifact-adapter.mjs',
    'lib/design-engine/board-adapter.mjs',
    'lib/pipeline/index.mjs',
    'registry/artifact-theme.json',
    'schemas/v1.1.0/artifact-envelope.schema.json',
    'schemas/v1.1.0/artifact-paste.schema.json',
    'schemas/v1.1.0/artifact-review.schema.json',
    'schemas/v1.1.0/artifact-theme.schema.json',
    'templates/artifact-review-shell.html',
    'templates/artifact-review-stage.js',
    'templates/design/design-board-adapter.js',
  ];
  const missing = required.filter((path) => !existsSync(join(root, path)));
  if (missing.length === 0) {
    ok('artifact.assets-present', 'Artifact review', 'portable artifact schemas, engine, shell, skill, and conformance assets are present');
  } else {
    fail('artifact.assets-present', 'Artifact review', `portable artifact assets are missing: ${missing.join(', ')}`, 'Restore the package allowlist and regenerate artifact assets.');
    return;
  }

  try {
    for (const name of ['artifact-envelope', 'artifact-paste', 'artifact-review', 'artifact-theme']) {
      readJson(`schemas/v1.1.0/${name}.schema.json`);
    }
    ok('artifact.schemas-readable', 'Artifact review', 'Protocol v1.1 artifact schemas parse as JSON');
  } catch {
    fail('artifact.schemas-readable', 'Artifact review', 'one or more Protocol v1.1 artifact schemas are invalid JSON', 'Regenerate or restore the artifact schemas.');
  }

  const manifest = readJson('lib/artifact/ui/generated/artifact-shell-assets.json');
  const drift = [];
  for (const asset of manifest.assets ?? []) {
    const path = join(root, asset.path);
    if (!existsSync(path)) {
      drift.push(`${asset.path} is missing`);
      continue;
    }
    const bytes = readFileSync(path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== asset.bytes || digest !== asset.sha256) {
      drift.push(`${asset.path} does not match its generated manifest`);
    }
  }
  if (drift.length === 0 && (manifest.assets?.length ?? 0) >= 5) {
    ok('artifact.generated-assets', 'Artifact review', 'generated shell, theme, stage, and design adapter match their manifest');
  } else {
    fail('artifact.generated-assets', 'Artifact review', drift.join('; ') || 'artifact shell manifest is incomplete', 'Run `npm run generate:artifact-shell` and commit every generated output.');
  }

  const publicIndex = readText('lib/pipeline/index.mjs');
  const names = [
    'bundleArtifact', 'createArtifactEnvelope', 'encodeArtifactFragment',
    'decodeArtifactFragment', 'encryptArtifactPayload', 'decryptArtifactPayload',
    'startArtifactReview', 'createReviewLink', 'importArtifactReview',
    'mergeArtifactFeedback', 'ARTIFACT_ERROR_CODES',
  ];
  if (names.every((name) => new RegExp(`\\b${name}\\b`).test(publicIndex))) {
    ok('artifact.public-exports', 'Artifact review', 'package root declares the stable artifact API and named errors');
  } else {
    fail('artifact.public-exports', 'Artifact review', 'package root artifact exports are incomplete', 'Export the complete stable artifact API from lib/pipeline/index.mjs.');
  }

  const skill = readText('adapters/codex/skills/planr-artifact/SKILL.md');
  if (/\bplanr artifact\b/.test(skill)
    && !/CLAUDE_PLUGIN_ROOT|\b(?:Sonnet|Opus)\b|\bplanr-pipeline\s+artifact\b/.test(skill)) {
    ok('artifact.portable-skill', 'Artifact review', 'Codex artifact skill uses only the public planr route');
  } else {
    fail('artifact.portable-skill', 'Artifact review', 'Codex artifact skill contains a non-portable invocation', 'Use only `planr artifact` in portable runtime assets.');
  }

  if (readText('bin/planr-pipeline.mjs').startsWith('#!/usr/bin/env node')) {
    ok('artifact.package-bin', 'Artifact review', 'package executable has a portable Node shebang');
  } else {
    fail('artifact.package-bin', 'Artifact review', 'package executable is missing its portable Node shebang', 'Restore bin/planr-pipeline.mjs and its package.json bin entry.');
  }
}

function runReleaseChecks(pkg) {
  checkRelease('release.pipeline', 'planr-pipeline', root, pkg.version);

  const skillsRoot = ecosystem.repositories.skills?.path;
  const skillsManifest = skillsRoot
    ? join(skillsRoot, '.claude-plugin/marketplace.json')
    : null;
  if (skillsManifest && existsSync(skillsManifest)) {
    const skills = readJsonFile(skillsManifest);
    if (skills.metadata?.version) {
      checkRelease('release.skills', 'skills', skillsRoot, skills.metadata.version);
    }
  } else {
    warn('release.skills-present', 'Releases', 'skills repo not found; release check skipped', 'Use --workspace-root or OPENPLANR_ECOSYSTEM_ROOT before the final release audit.', true);
  }

  const openPlanrRoot = ecosystem.repositories.cli?.path;
  const openPlanrPackage = openPlanrRoot ? join(openPlanrRoot, 'package.json') : null;
  if (openPlanrPackage && existsSync(openPlanrPackage)) {
    const openPlanr = readJsonFile(openPlanrPackage);
    if (openPlanr.version) {
      checkRelease('release.openplanr', 'OpenPlanr', openPlanrRoot, openPlanr.version);
    }
  } else {
    warn('release.openplanr-present', 'Releases', 'OpenPlanr CLI repo not found; release check skipped', 'Use --workspace-root or OPENPLANR_ECOSYSTEM_ROOT before the final release audit.', true);
  }
}

function printHumanSummary(summary) {
  const title = options.versionsOnly ? 'OpenPlanr doctor (versions only)' : 'OpenPlanr doctor';
  console.log(`${title}: ${summary.ok ? 'ok' : 'failed'} (${summary.failures} failure(s), ${summary.warnings} warning(s))`);

  const order = ['Environment', 'Versions', 'Protocol', 'Artifact review', 'Ecosystem', 'Daemons', 'Credentials', 'Releases'];
  for (const category of order) {
    const categoryChecks = checks.filter((check) => check.category === category);
    if (categoryChecks.length === 0) continue;

    console.log(`\n${category}`);
    for (const check of categoryChecks) {
      console.log(`  [${check.status}] ${check.message}`);
      if (check.fix && check.status !== 'ok') console.log(`        fix: ${check.fix}`);
    }
  }
}

const pkg = readJson('package.json');

runEnvironmentChecks(pkg);
runVersionAndProtocolChecks(pkg);
await runArtifactChecks();
if (sourceCheckout) {
  runEcosystemChecks(pkg);
} else {
  ok('ecosystem.package-mode', 'Ecosystem', 'installed package health does not require sibling source repositories');
}

if (!options.versionsOnly) {
  runDaemonChecks();
  runCredentialChecks();
}

if (options.release && sourceCheckout) {
  runReleaseChecks(pkg);
} else if (options.release) {
  fail('release.source-required', 'Releases', 'release audit requires a source checkout', 'Run the release audit from the planr-pipeline repository.');
}

await Promise.all(pendingHealthChecks);

const summary = {
  ok: checks.every((check) => check.status !== 'fail'),
  failures: checks.filter((check) => check.status === 'fail').length,
  warnings: checks.filter((check) => check.status === 'warn').length,
  checks: checks.map(({ category, ...check }) => check),
  repairs,
};

if (options.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  printHumanSummary(summary);
}

process.exit(summary.ok ? 0 : 1);
