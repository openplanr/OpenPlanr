import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeOperatingAdapter,
  resolveGuidedOperatingBoard,
  resolveOperatingBoard,
} from './operating-capability.mjs';
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

function capabilityComponentPresent(capability, component) {
  return Boolean(capability) && !(capability.missing ?? []).includes(component);
}

function participantTarget(operation, component, fallback) {
  return operation?.participants?.find((participant) => participant.component === component)
    ?.targetVersion ?? fallback;
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
  skillsPluginManifest: join(
    workspace,
    'skills',
    '.claude-plugin',
    'plugin.json',
  ),
  operateSkill: join(workspace, 'skills', 'skills', 'planr-operate', 'SKILL.md'),
};
const operationPath = join(repo, 'examples', 'ecosystem-operation.json');
const releaseOperation = existsSync(operationPath) ? readJson(operationPath) : null;
const nativeOperationPath = join(repo, 'examples', 'native-operate-operation.json');
const guidedOperationPath = existsSync(nativeOperationPath)
  ? nativeOperationPath
  : join(repo, 'examples', 'guided-operate-operation.json');
const guidedReleaseOperation = existsSync(guidedOperationPath)
  ? readJson(guidedOperationPath)
  : null;
const agenticOperationPath = join(repo, 'examples', 'agent-native-operate-operation.json');
const agenticReleaseOperation = existsSync(agenticOperationPath)
  ? readJson(agenticOperationPath)
  : null;
const requiredWorkspaceInputs = [
  ecosystemPaths.cli,
  ecosystemPaths.pipeline,
  ecosystemPaths.adapters,
  ecosystemPaths.skills,
  ecosystemPaths.skillsPluginManifest,
];
const hasWorkspace =
  requiredWorkspaceInputs.every(existsSync) &&
  (!check || Boolean(process.env.OPENPLANR_ECOSYSTEM_ROOT));
const observedCliVersion = hasWorkspace
  ? readJson(ecosystemPaths.cli).version
  : current.components.cli.version;
const observedPipelineVersion = hasWorkspace
  ? readJson(ecosystemPaths.pipeline).version
  : current.components.pipeline.version;
const observedSkillsVersion = hasWorkspace
  ? readJson(ecosystemPaths.skills).version
  : current.components.skills.version;
if (hasWorkspace) {
  const skillsPluginManifest = readJson(ecosystemPaths.skillsPluginManifest);
  if (
    skillsPluginManifest.name !== 'openplanr' ||
    skillsPluginManifest.version !== observedSkillsVersion
  ) {
    throw new Error(
      `Skills plugin identity drift: expected openplanr@${observedSkillsVersion}, got ${skillsPluginManifest.name}@${skillsPluginManifest.version}`,
    );
  }
}
const adapterRegistry = hasWorkspace ? readJson(ecosystemPaths.adapters) : null;
const protocolVersion = adapterRegistry?.protocolVersion ?? current.protocol.current;
const guidedReleaseVerified = isVerifiedOperation(guidedReleaseOperation);
const candidateCliVersion = participantTarget(
  guidedReleaseOperation,
  'cli',
  observedCliVersion,
);
const candidatePipelineVersion = participantTarget(
  guidedReleaseOperation,
  'pipeline',
  observedPipelineVersion,
);
const candidateSkillsVersion = participantTarget(
  guidedReleaseOperation,
  'skills',
  observedSkillsVersion,
);
const candidateMarketplaceVersion = participantTarget(
  guidedReleaseOperation,
  'marketplace',
  marketplacePackage.version,
);
const agenticCliVersion = participantTarget(agenticReleaseOperation, 'cli', observedCliVersion);
const agenticPipelineVersion = participantTarget(
  agenticReleaseOperation,
  'pipeline',
  observedPipelineVersion,
);
const agenticSkillsVersion = participantTarget(
  agenticReleaseOperation,
  'skills',
  observedSkillsVersion,
);
const agenticMarketplaceVersion = participantTarget(
  agenticReleaseOperation,
  'marketplace',
  marketplacePackage.version,
);
const agenticReleaseVerified = isVerifiedOperation(agenticReleaseOperation);
const agenticReleaseStaged = Boolean(agenticReleaseOperation) && !agenticReleaseVerified;
const releasedProtocolVersion = agenticReleaseStaged
  ? current.protocol.current
  : protocolVersion;
// A staged operation exposes candidate downstream component versions only
// inside the withheld capability. Top-level downstream versions and plugin
// pins remain at the last verified ecosystem until npm, tags, CI, and canaries
// reconcile. The marketplace component itself follows this repository's
// package version so its generated metadata always describes the artifact
// being validated on the release branch.
const cliVersion = agenticReleaseStaged
  ? current.components.cli.version
  : guidedReleaseVerified
    ? observedCliVersion
    : current.components.cli.version;
const pipelineVersion = agenticReleaseStaged
  ? current.components.pipeline.version
  : guidedReleaseVerified
    ? observedPipelineVersion
    : current.components.pipeline.version;
const skillsVersion = agenticReleaseStaged
  ? current.components.skills.version
  : guidedReleaseVerified
    ? observedSkillsVersion
    : current.components.skills.version;
const marketplaceVersion = marketplacePackage.version;
const candidateAdapters = adapterRegistry
  ? adapterRegistry.adapters.map((adapter) =>
      normalizeOperatingAdapter(adapter, candidatePipelineVersion))
  : current.adapters;
// Top-level adapters describe the released ecosystem, so their pipelineRange
// must track the observed (released) pipeline version and stay consistent
// with components.cli.pipelineRange. The guided candidate resolution instead
// stays pinned to its ledger targets via candidateAdapters above.
const releaseAdapters = adapterRegistry
  ? adapterRegistry.adapters.map((adapter) =>
      normalizeOperatingAdapter(adapter, pipelineVersion))
  : current.adapters;
let resolvedAdapters = agenticReleaseStaged
  ? current.adapters
  : guidedReleaseVerified
    ? releaseAdapters
    : current.adapters;

let operatingBoard;
if (hasWorkspace) {
  operatingBoard = resolveOperatingBoard({
    protocolVersion,
    pipelineVersion,
    cliVersion,
    skillsVersion,
    marketplaceVersion,
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
      marketplace: marketplaceVersion,
    },
  };
}

// Once the guided release operation is verified, the stored guided record is
// frozen history pinned to its ledger targets. Re-deriving it from the live
// adapter registry would rewrite that verified record whenever the registry
// evolves (the 0.34.0 registry modernizes advisor-dispatch labels to protocol
// 1.3 values that postdate guided certification), so the stored record is
// carried forward byte-for-byte instead.
const storedGuidedOperatingBoard = current.capabilities?.guidedOperatingBoard ?? null;
const guidedOperatingBoard = guidedReleaseVerified && storedGuidedOperatingBoard
  ? structuredClone(storedGuidedOperatingBoard)
  : hasWorkspace
  ? resolveGuidedOperatingBoard({
      protocolVersion,
      pipelineVersion: candidatePipelineVersion,
      cliVersion: candidateCliVersion,
      skillsVersion: candidateSkillsVersion,
      marketplaceVersion: candidateMarketplaceVersion,
      guidedContractsPresent: existsSync(
        join(workspace, 'planr-pipeline', 'schemas', 'v1.2.0', 'guided-questionnaire.schema.json'),
      ),
      evidenceDiagnosticsPresent: existsSync(
        join(workspace, 'OpenPlanr', 'src', 'services', 'operate', 'evidence-diagnostics.ts'),
      ),
      adapters: candidateAdapters,
      releaseVerified: guidedReleaseVerified,
    })
  : storedGuidedOperatingBoard ?? resolveGuidedOperatingBoard({
      protocolVersion,
      pipelineVersion: candidatePipelineVersion,
      cliVersion: candidateCliVersion,
      skillsVersion: candidateSkillsVersion,
      marketplaceVersion: candidateMarketplaceVersion,
      guidedContractsPresent: capabilityComponentPresent(
        current.capabilities?.guidedOperatingBoard,
        'pipeline',
      ),
      evidenceDiagnosticsPresent: capabilityComponentPresent(
        current.capabilities?.guidedOperatingBoard,
        'cli',
      ),
      adapters: candidateAdapters,
      releaseVerified: guidedReleaseVerified,
    });
guidedOperatingBoard.releaseOperation = guidedReleaseOperation
  ? {
      operationId: guidedReleaseOperation.operationId,
      operationDigest: guidedReleaseOperation.operationDigest,
      state: guidedReleaseOperation.state,
      reconciliation: guidedReleaseOperation.reconciliation.status,
    }
  : null;

const agenticAdapters = adapterRegistry
  ? adapterRegistry.adapters.map((adapter) =>
      normalizeOperatingAdapter(adapter, agenticPipelineVersion))
  : Object.entries(
      current.capabilities?.agenticOperatingBoard?.advisorDispatch ?? {},
    ).map(([runtime, operatingAdvisorDispatch]) => ({
      runtime,
      operatingAdvisorDispatch,
    }));
const agenticOperatingBoard = {
  status: agenticReleaseVerified ? 'available' : 'unavailable',
  command: 'planr operate',
  protocolRange: '^1.4.0',
  components: {
    pipeline: agenticPipelineVersion,
    cli: agenticCliVersion,
    skills: agenticSkillsVersion,
    marketplace: agenticMarketplaceVersion,
  },
  certifiedRuntimes: agenticReleaseVerified
    ? agenticAdapters
        .filter(({ operatingAdvisorDispatch }) =>
          ['native-agent', 'sequential-native'].includes(operatingAdvisorDispatch))
        .map(({ runtime }) => runtime)
    : [],
  advisorDispatch: Object.fromEntries(
    agenticAdapters.map(({ runtime, operatingAdvisorDispatch }) => [
      runtime,
      operatingAdvisorDispatch,
    ]),
  ),
  missing: agenticReleaseVerified ? [] : ['release'],
  releaseOperation: agenticReleaseOperation
    ? {
        operationId: agenticReleaseOperation.operationId,
        operationDigest: agenticReleaseOperation.operationDigest,
        state: agenticReleaseOperation.state,
        reconciliation: agenticReleaseOperation.reconciliation.status,
      }
    : null,
};

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
    current: releasedProtocolVersion,
    supported: supportedProtocolRanges(releasedProtocolVersion),
  },
  components: {
    cli: { version: cliVersion, pipelineRange: `^${pipelineVersion}` },
    pipeline: { version: pipelineVersion, cliRange: `^${cliVersion}` },
    skills: { version: skillsVersion, cliRange: `^${cliVersion}` },
    marketplace: { version: marketplaceVersion },
  },
  adapters: resolvedAdapters,
  capabilities: {
    ...(current.capabilities ?? {}),
    operatingBoard,
    guidedOperatingBoard,
    agenticOperatingBoard,
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
const guidedCapability = [
  '<!-- guided-operating-capability:start -->',
  `**Resolved status:** \`${guidedOperatingBoard.status}\``,
  '',
  guidedOperatingBoard.status === 'available'
    ? `Guided Operating Board is certified for ${guidedOperatingBoard.certifiedRuntimes.join(', ')} through \`${guidedOperatingBoard.command}\`.`
    : `Guided Operating Board remains withheld. Missing release gates: ${guidedOperatingBoard.missing.join(', ')}.`,
  '',
  `Candidate component versions: pipeline ${guidedOperatingBoard.components.pipeline}, CLI ${guidedOperatingBoard.components.cli}, skills ${guidedOperatingBoard.components.skills}, marketplace ${guidedOperatingBoard.components.marketplace}.`,
  '<!-- guided-operating-capability:end -->',
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
const finalReadmeText = readmeText.replace(
  /<!-- guided-operating-capability:start -->[\s\S]*?<!-- guided-operating-capability:end -->/,
  guidedCapability,
);

const outputs = [
  [join(repo, 'ecosystem.json'), ecosystemText],
  [manifestPath, manifestText],
  [readmePath, finalReadmeText],
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
