#!/usr/bin/env node

// Manual legacy-consumer audit retained until registry/marketplace migration.
// Hosted operational monitoring belongs to the private web repository.
// This probe reads public endpoints and never receives share capabilities.

const marketplaceManifestUrl =
  'https://raw.githubusercontent.com/openplanr/marketplace/main/ecosystem.json';

async function json(url) {
  let lastStatus = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.ok) return response.json();
    lastStatus = response.status;
    if (response.status < 500 || attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw new Error(`${url} returned ${lastStatus}`);
}

async function requireVersion(name, version) {
  const metadata = await json(`https://registry.npmjs.org/${name}/latest`);
  if (metadata.version !== version) throw new Error(`${name}: expected ${version}, received ${metadata.version}`);
  process.stdout.write(`PASS npm ${name}@${version}\n`);
}

// The marketplace manifest is the resolved, published compatibility contract.
// Read it rather than pinning each release in this scheduled canary; explicit
// environment variables remain available for release-candidate verification.
const ecosystem = await json(marketplaceManifestUrl);
const expected = {
  pipeline: process.env.PLANR_EXPECT_PIPELINE ?? ecosystem.components?.pipeline?.version,
  cli: process.env.PLANR_EXPECT_CLI ?? ecosystem.components?.cli?.version,
  skills: process.env.PLANR_EXPECT_SKILLS ?? ecosystem.components?.skills?.version,
};

for (const [component, version] of Object.entries(expected)) {
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Marketplace compatibility manifest has no ${component} version`);
  }
}

await requireVersion('planr-pipeline', expected.pipeline);
await requireVersion('openplanr', expected.cli);

const skillsRelease = await json(`https://api.github.com/repos/openplanr/skills/releases/tags/v${expected.skills}`);
if (skillsRelease.draft || skillsRelease.prerelease) throw new Error(`skills v${expected.skills} is not a final release`);
process.stdout.write(`PASS skills v${expected.skills}\n`);

const share = await fetch('https://share.openplanr.dev/');
if (!share.ok) throw new Error(`share host returned ${share.status}`);
const html = await share.text();
if (!html.includes('OpenPlanr') || !html.includes('hosted-bootstrap.js')) throw new Error('share host viewer assets are incomplete');
if (!/no-store/i.test(share.headers.get('cache-control') ?? '')) throw new Error('share host must be no-store');

const robots = await fetch('https://share.openplanr.dev/robots.txt');
if (!robots.ok || !(await robots.text()).includes('Disallow: /')) throw new Error('share host must disallow indexing');
process.stdout.write('PASS share host privacy headers and assets\n');

const roomRoute = await fetch('https://share.openplanr.dev/r/canary_route_probe');
if (!roomRoute.ok) throw new Error(`live room route returned ${roomRoute.status}`);
if (!/no-store/i.test(roomRoute.headers.get('cache-control') ?? '')) {
  throw new Error('live room route must be no-store');
}
process.stdout.write('PASS capability-free live room route\n');

process.stdout.write('Artifact release canary passed\n');
