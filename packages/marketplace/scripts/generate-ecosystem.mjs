import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOperatingBoard } from './operating-capability.mjs';
import { isVerifiedOperation } from './validate-operation.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(repo, '..'));
const check = process.argv.includes('--check');

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Missing ecosystem input: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function supportedProtocolRanges(current) {
  const [major, minor] = current.split('.').map(Number);
  if (major !== 1 || !Number.isInteger(minor)) return [`${major}.x`];
  return Array.from({ length: minor + 1 }, (_, index) => `1.${index}.x`);
}

const marketplacePackage = readJson(join(repo, 'package.json'));
const current = readJson(join(repo, 'ecosystem.json'));
const generatedAt = check ? current.generatedAt : new Date().toISOString();
const ecosystemPaths = {
  cli: join(workspace, 'OpenPlanr', 'package.json'),
  cliCommand: join(workspace, 'OpenPlanr', 'src', 'cli', 'commands', 'operate.ts'),
  pipeline: join(workspace, 'planr-pipeline', 'package.json'),
  adapters: join(workspace, 'planr-pipeline', 'registry', 'adapters.json'),
  operatingRoles: join(workspace, 'planr-pipeline', 'registry', 'operating-roles.json'),
  skills: join(workspace, 'skills', 'package.json'),
  operateSkill: join(workspace, 'skills', 'skills', 'planr-operate', 'SKILL.md'),
};
const operationPath = join(repo, 'examples', 'ecosystem-operation.json');
const releaseOperation = existsSync(operationPath) ? readJson(operationPath) : null;
const requiredWorkspaceInputs = [
  ecosystemPaths.cli,
  ecosystemPaths.pipeline,
  ecosystemPaths.adapters,
  ecosystemPaths.skills,
];
const hasWorkspace =
  requiredWorkspaceInputs.every(existsSync) &&
  (!check || Boolean(process.env.OPENPLANR_ECOSYSTEM_ROOT));
const cliVersion = hasWorkspace
  ? readJson(ecosystemPaths.cli).version
  : current.components.cli.version;
const pipelineVersion = hasWorkspace
  ? readJson(ecosystemPaths.pipeline).version
  : current.components.pipeline.version;
const skillsVersion = hasWorkspace
  ? readJson(ecosystemPaths.skills).version
  : current.components.skills.version;
const adapterRegistry = hasWorkspace ? readJson(ecosystemPaths.adapters) : null;
const protocolVersion = adapterRegistry?.protocolVersion ?? current.protocol.current;
let resolvedAdapters = adapterRegistry
  ? adapterRegistry.adapters.map((adapter) => ({
      runtime: adapter.id,
      version: adapter.version,
      capabilityLevel: adapter.capabilityLevel,
      pipelineRange: `^${pipelineVersion}`,
      operatingBoard: {
        declared: Boolean(
          adapter.capabilities?.operatingBoard && adapter.entrypoints?.operate,
        ),
        available: false,
        entrypoint: adapter.entrypoints?.operate ?? null,
      },
    }))
  : current.adapters;

let operatingBoard;
if (hasWorkspace) {
  operatingBoard = resolveOperatingBoard({
    protocolVersion,
    pipelineVersion,
    cliVersion,
    skillsVersion,
    marketplaceVersion: marketplacePackage.version,
    operatingRolesPresent: existsSync(ecosystemPaths.operatingRoles),
    cliCommandPresent: existsSync(ecosystemPaths.cliCommand),
    operateSkillPresent: existsSync(ecosystemPaths.operateSkill),
    adapters: resolvedAdapters,
    releaseVerified: isVerifiedOperation(releaseOperation),
  });
} else {
  const previousOperatingBoard = current.capabilities?.operatingBoard ?? {
    status: 'unavailable',
    command: 'planr operate',
    protocolRange: '^1.2.0',
    certifiedRuntimes: [],
    missing: ['protocol', 'pipeline', 'cli', 'skills', 'adapters', 'release'],
  };
  operatingBoard = {
    ...previousOperatingBoard,
    components: {
      pipeline: pipelineVersion,
      cli: cliVersion,
      skills: skillsVersion,
      marketplace: marketplacePackage.version,
    },
  };
}

operatingBoard.releaseOperation = releaseOperation
  ? {
      operationId: releaseOperation.operationId,
      operationDigest: releaseOperation.operationDigest,
      state: releaseOperation.state,
      reconciliation: releaseOperation.reconciliation.status,
    }
  : null;

resolvedAdapters = resolvedAdapters.map((adapter) => {
  const declared =
    adapter.operatingBoard?.declared ?? adapter.operatingBoard?.available ?? false;
  return {
    ...adapter,
    operatingBoard: {
      ...adapter.operatingBoard,
      declared,
      available: operatingBoard.status === 'available' && declared,
    },
  };
});

const ecosystem = {
  schemaVersion: '1.1.0',
  generatedAt,
  protocol: {
    current: protocolVersion,
    supported: supportedProtocolRanges(protocolVersion),
  },
  components: {
    cli: { version: cliVersion, pipelineRange: `^${pipelineVersion}` },
    pipeline: { version: pipelineVersion, cliRange: `^${cliVersion}` },
    skills: { version: skillsVersion, cliRange: `^${cliVersion}` },
    marketplace: { version: marketplacePackage.version },
  },
  adapters: resolvedAdapters,
  capabilities: {
    ...(current.capabilities ?? {}),
    operatingBoard,
  },
  releaseTransaction: {
    model: 'coordinated-saga',
    atomicity: 'participant-local',
    ledger: {
      kind: 'marketplace-draft-pr',
      repository: 'openplanr/marketplace',
      schema: 'schemas/ecosystem-operation.schema.json',
    },
    participantOrder: ['pipeline', 'cli', 'skills', 'marketplace'],
    closeout: {
      model: 'two-step-marketplace-finalization',
      sequence: [
        'merge-unavailable-ledger',
        'tag-and-verify-marketplace',
        'record-finalization-and-expose',
      ],
      availabilityGate: 'verified-operation-after-ledger-merge-and-marketplace-tag',
    },
    recovery: 'reconcile-and-resume',
    publishedCompensation: 'forward-fix',
  },
};

const ecosystemText = `${JSON.stringify(ecosystem, null, 2)}\n`;
const manifestPath = join(repo, '.claude-plugin', 'marketplace.json');
const manifest = readJson(manifestPath);
for (const plugin of manifest.plugins) {
  if (plugin.name === 'planr-pipeline') {
    plugin.version = pipelineVersion;
    plugin.description =
      operatingBoard.status === 'available'
        ? 'Complete PO → Design → Review → DEV → QA workflow with feature-local planning, Protocol operating contracts, universal HTML artifact review, private sharing, boards, sync, dashboard, and native Claude Code enforcement.'
        : 'Complete PO → Design → Review → DEV → QA workflow with feature-local planning, universal HTML artifact review, private sharing, boards, sync, dashboard, and native Claude Code enforcement.';
  }
  if (plugin.name === 'openplanr') {
    plugin.version = skillsVersion;
    plugin.description =
      operatingBoard.status === 'available'
        ? 'Reusable operating, planning, artifact review, PLAN, Design, SHIP, dashboard, sync, and doctor skills with truthful product and runtime routing.'
        : 'Reusable planning, artifact review, PLAN, Design, SHIP, dashboard, sync, and doctor skills with truthful product and runtime routing.';
  }
}
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

const readmePath = join(repo, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const table = [
  '<!-- ecosystem-table:start -->',
  '| Component | Version | Compatibility |',
  '|---|---:|---|',
  `| OpenPlanr CLI | ${cliVersion} | pipeline ${ecosystem.components.cli.pipelineRange} |`,
  `| Pipeline package/plugin | ${pipelineVersion} | CLI ${ecosystem.components.pipeline.cliRange} |`,
  `| Runtime skills | ${skillsVersion} | CLI ${ecosystem.components.skills.cliRange} |`,
  `| Protocol | ${protocolVersion} | reads v1.0 artifacts; additive capabilities through v${protocolVersion} |`,
  '<!-- ecosystem-table:end -->',
].join('\n');
const operatingCapability = [
  '<!-- operating-capability:start -->',
  `**Resolved status:** \`${operatingBoard.status}\``,
  '',
  operatingBoard.status === 'available'
    ? `OpenPlanr Operating Board is certified for ${operatingBoard.certifiedRuntimes.join(', ')} through \`${operatingBoard.command}\`.`
    : `Operating Board is not advertised by this manifest. Missing release gates: ${operatingBoard.missing.join(', ')}.`,
  '',
  `Resolved component versions: pipeline ${operatingBoard.components.pipeline}, CLI ${operatingBoard.components.cli}, skills ${operatingBoard.components.skills}, marketplace ${operatingBoard.components.marketplace}.`,
  '<!-- operating-capability:end -->',
].join('\n');
const pluginTable = [
  '<!-- plugin-table:start -->',
  '| Plugin | Version | Description |',
  '|---|---|---|',
  `| [\`planr-pipeline\`](https://github.com/openplanr/planr-pipeline) | ${pipelineVersion} | Complete PO, Design, Review, DEV, and QA workflow with universal HTML artifact review and private sharing. |`,
  `| [\`openplanr\`](https://github.com/openplanr/skills) | ${skillsVersion} | ${operatingBoard.status === 'available' ? 'Unified operating, planning, artifact review, and delivery workflow skills' : 'Unified planning, artifact review, and delivery workflow skills'} for the certified runtimes. |`,
  '<!-- plugin-table:end -->',
].join('\n');
const readmeText = readme
  .replace(/<!-- ecosystem-table:start -->[\s\S]*?<!-- ecosystem-table:end -->/, table)
  .replace(/<!-- plugin-table:start -->[\s\S]*?<!-- plugin-table:end -->/, pluginTable)
  .replace(
    /<!-- operating-capability:start -->[\s\S]*?<!-- operating-capability:end -->/,
    operatingCapability,
  );

const outputs = [
  [join(repo, 'ecosystem.json'), ecosystemText],
  [manifestPath, manifestText],
  [readmePath, readmeText],
];
if (check) {
  const drift = outputs.filter(([path, expected]) => readFileSync(path, 'utf8') !== expected);
  if (drift.length) {
    for (const [path] of drift) process.stderr.write(`DRIFT ${path}\n`);
    process.exit(1);
  }
  process.stdout.write('Marketplace and ecosystem manifest are synchronized\n');
} else {
  for (const [path, content] of outputs) writeFileSync(path, content);
  process.stdout.write('Generated marketplace ecosystem metadata\n');
}
