#!/usr/bin/env node

const expected = {
  pipeline: process.env.PLANR_EXPECT_PIPELINE ?? '0.28.4',
  cli: process.env.PLANR_EXPECT_CLI ?? '1.12.4',
  skills: process.env.PLANR_EXPECT_SKILLS ?? '1.15.0',
};

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

if (process.env.PLANR_CANARY_ROOM_URL) {
  const room = new URL(process.env.PLANR_CANARY_ROOM_URL);
  if (room.origin !== 'https://share.openplanr.dev' || !room.pathname.startsWith('/r/') || !room.hash.includes('k=')) {
    throw new Error('PLANR_CANARY_ROOM_URL is not a complete encrypted room URL');
  }
  const route = await fetch(`${room.origin}${room.pathname}`);
  if (!route.ok) throw new Error(`live room route returned ${route.status}`);
  process.stdout.write('PASS encrypted live room route\n');
}

process.stdout.write('Artifact release canary passed\n');
