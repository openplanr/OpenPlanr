import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const spec = `${packageJson.name}@${packageJson.version}`;

function isPublished() {
  try {
    return (
      execFileSync('npm', ['view', spec, 'version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() === packageJson.version
    );
  } catch {
    return false;
  }
}

if (isPublished()) {
  console.log(`${spec} is already published; skipping.`);
  process.exit(0);
}

const publish = spawnSync('npm', ['publish'], { stdio: 'inherit' });
if (publish.status === 0) process.exit(0);

// npm can report a late registry error after accepting a package and its
// provenance statement. Confirm registry state before failing the release.
for (let attempt = 0; attempt < 5; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  if (isPublished()) {
    console.log(`${spec} is present in npm despite the publish command error.`);
    process.exit(0);
  }
}

process.exit(publish.status ?? 1);
