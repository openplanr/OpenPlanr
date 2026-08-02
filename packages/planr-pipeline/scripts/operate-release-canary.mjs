#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const OPERATING_RELEASE_ORDER = Object.freeze([
  'pipeline',
  'cli',
  'skills',
  'marketplace',
]);

const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/openplanr/marketplace/main/ecosystem.json';

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

export function assertOperatingReleaseManifest(manifest, expected = {}) {
  if (manifest?.protocol?.current !== '1.4.0') {
    throw new Error('Marketplace must resolve Protocol 1.4.0');
  }
  const order = manifest?.releaseTransaction?.participantOrder;
  if (JSON.stringify(order) !== JSON.stringify(OPERATING_RELEASE_ORDER)) {
    throw new Error(
      `Operating release order must be ${OPERATING_RELEASE_ORDER.join(' -> ')}`,
    );
  }
  const capability = manifest?.capabilities?.operatingBoard;
  if (capability?.status !== 'available') {
    throw new Error('Marketplace has not exposed Operating Board as available');
  }
  if (!Array.isArray(capability.certifiedRuntimes) || capability.certifiedRuntimes.length === 0) {
    throw new Error('Operating Board has no certified runtime');
  }
  if (!Array.isArray(manifest.adapters) || manifest.adapters.some((adapter) => !adapter.operatingBoard?.available)) {
    throw new Error('Every published adapter must expose Operating Board');
  }

  const versions = {
    pipeline: requiredString(manifest.components?.pipeline?.version, 'pipeline version'),
    cli: requiredString(manifest.components?.cli?.version, 'CLI version'),
    skills: requiredString(manifest.components?.skills?.version, 'skills version'),
    marketplace: requiredString(
      manifest.components?.marketplace?.version,
      'marketplace version',
    ),
  };
  for (const [component, version] of Object.entries(expected)) {
    if (version && versions[component] !== version) {
      throw new Error(
        `${component}: expected ${version}, received ${versions[component]}`,
      );
    }
  }
  for (const [component, version] of Object.entries(capability.components ?? {})) {
    if (versions[component] !== version) {
      throw new Error(
        `${component}: capability resolves ${version}, manifest resolves ${versions[component]}`,
      );
    }
  }
  return versions;
}

async function fetchJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json', 'user-agent': 'openplanr-operate-canary' },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

export async function verifyOperatingRelease({
  fetchImpl = fetch,
  manifestUrl = DEFAULT_MANIFEST_URL,
  expected = {},
} = {}) {
  const manifest = await fetchJson(fetchImpl, manifestUrl);
  const versions = assertOperatingReleaseManifest(manifest, expected);

  for (const [packageName, version] of [
    ['planr-pipeline', versions.pipeline],
    ['openplanr', versions.cli],
  ]) {
    const metadata = await fetchJson(
      fetchImpl,
      `https://registry.npmjs.org/${packageName}/${version}`,
    );
    if (metadata.version !== version) {
      throw new Error(`${packageName}: registry returned ${metadata.version}`);
    }
    requiredString(metadata.dist?.integrity, `${packageName}@${version} integrity`);
  }

  const skillsRelease = await fetchJson(
    fetchImpl,
    `https://api.github.com/repos/openplanr/skills/releases/tags/v${versions.skills}`,
  );
  if (skillsRelease.draft || skillsRelease.prerelease) {
    throw new Error(`skills v${versions.skills} is not a final release`);
  }
  if (skillsRelease.tag_name !== `v${versions.skills}`) {
    throw new Error(`skills release tag does not match v${versions.skills}`);
  }
  return { manifest, versions };
}

export function verifyInstalledOperateCli({
  command = process.platform === 'win32' ? 'planr.cmd' : 'planr',
  spawn = spawnSync,
} = {}) {
  const result = spawn(command, ['operate', 'inspect', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Installed planr failed the Operating Board inspection canary');
  }
  const lines = result.stdout.trim().split(/\r?\n/);
  if (lines.length !== 1) {
    throw new Error('Operating Board inspection must emit exactly one JSON line');
  }
  const value = JSON.parse(lines[0]);
  if (
    value.ok !== true ||
    value.action !== 'inspect' ||
    value.protocolVersion !== '1.2.0'
  ) {
    throw new Error('Installed planr does not expose the Protocol v1.2 inspect contract');
  }
  return value;
}

async function main() {
  const expected = {
    pipeline: process.env.PLANR_EXPECT_PIPELINE,
    cli: process.env.PLANR_EXPECT_CLI,
    skills: process.env.PLANR_EXPECT_SKILLS,
    marketplace: process.env.PLANR_EXPECT_MARKETPLACE,
  };
  const { versions } = await verifyOperatingRelease({
    manifestUrl: process.env.PLANR_MARKETPLACE_MANIFEST_URL ?? DEFAULT_MANIFEST_URL,
    expected,
  });
  process.stdout.write(`PASS planr-pipeline@${versions.pipeline}\n`);
  process.stdout.write(`PASS openplanr@${versions.cli}\n`);
  process.stdout.write(`PASS skills v${versions.skills}\n`);
  process.stdout.write(`PASS marketplace v${versions.marketplace}\n`);
  verifyInstalledOperateCli();
  process.stdout.write('PASS installed planr operate inspect\n');
  process.stdout.write('Operating Board release canary passed\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
