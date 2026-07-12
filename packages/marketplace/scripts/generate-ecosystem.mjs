import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(process.env.OPENPLANR_ECOSYSTEM_ROOT ?? join(repo, '..'));
const check = process.argv.includes('--check');

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Missing ecosystem input: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

const marketplacePackage = readJson(join(repo, 'package.json'));
const current = readJson(join(repo, 'ecosystem.json'));
const generatedAt = check ? current.generatedAt : new Date().toISOString();
const ecosystemPaths = {
  cli: join(workspace, 'OpenPlanr', 'package.json'),
  pipeline: join(workspace, 'planr-pipeline', 'package.json'),
  adapters: join(workspace, 'planr-pipeline', 'registry', 'adapters.json'),
  skills: join(workspace, 'skills', 'package.json'),
};
const hasWorkspace = !check && Object.values(ecosystemPaths).every(existsSync);
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
const resolvedAdapters = adapterRegistry
  ? adapterRegistry.adapters.map((adapter) => ({
      runtime: adapter.id,
      version: adapter.version,
      capabilityLevel: adapter.capabilityLevel,
      pipelineRange: `^${pipelineVersion}`,
    }))
  : current.adapters;

const ecosystem = {
  schemaVersion: '1.0.0',
  generatedAt,
  protocol: { current: protocolVersion, supported: ['1.0.x', '1.1.x'] },
  components: {
    cli: { version: cliVersion, pipelineRange: `^${pipelineVersion}` },
    pipeline: { version: pipelineVersion, cliRange: `^${cliVersion}` },
    skills: { version: skillsVersion, cliRange: `^${cliVersion}` },
    marketplace: { version: marketplacePackage.version },
  },
  adapters: resolvedAdapters,
};

const ecosystemText = `${JSON.stringify(ecosystem, null, 2)}\n`;
const manifestPath = join(repo, '.claude-plugin', 'marketplace.json');
const manifest = readJson(manifestPath);
for (const plugin of manifest.plugins) {
  if (plugin.name === 'planr-pipeline') plugin.version = pipelineVersion;
  if (plugin.name === 'openplanr') plugin.version = skillsVersion;
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
  `| Protocol | ${protocolVersion} | reads v1.0 artifacts; v1.1 capabilities |`,
  '<!-- ecosystem-table:end -->',
].join('\n');
const readmeText = readme.replace(
  /<!-- ecosystem-table:start -->[\s\S]*?<!-- ecosystem-table:end -->/,
  table,
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
