import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const canary = readFileSync(resolve(root, 'scripts/artifact-release-canary.mjs'), 'utf8');

test('release canary never accepts or logs a capability-bearing room URL', () => {
  assert.doesNotMatch(canary, /room_url|CANARY_ROOM_URL|inputs\.[A-Za-z_]*room/iu);
  assert.doesNotMatch(canary, /CANARY_ROOM_URL|\.hash|#k=|[?&](?:w|o|m)=/u);
  assert.match(canary, /\/r\/canary_route_probe/u);
  assert.match(canary, /no-store/u);
});
