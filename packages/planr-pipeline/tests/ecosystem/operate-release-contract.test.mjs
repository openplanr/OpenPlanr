import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATING_RELEASE_ORDER,
  assertOperatingReleaseManifest,
  verifyInstalledOperateCli,
  verifyOperatingRelease,
} from '../../scripts/operate-release-canary.mjs';

function manifest() {
  return {
    protocol: { current: '1.2.0' },
    components: {
      pipeline: { version: '0.30.0' },
      cli: { version: '1.14.0' },
      skills: { version: '1.16.0' },
      marketplace: { version: '1.1.0' },
    },
    adapters: ['claude-code', 'codex', 'cursor'].map((runtime) => ({
      runtime,
      operatingBoard: { available: true },
    })),
    capabilities: {
      operatingBoard: {
        status: 'available',
        certifiedRuntimes: ['claude-code', 'codex', 'cursor'],
        components: {
          pipeline: '0.30.0',
          cli: '1.14.0',
          skills: '1.16.0',
          marketplace: '1.1.0',
        },
      },
    },
    releaseTransaction: { participantOrder: [...OPERATING_RELEASE_ORDER] },
  };
}

test('accepts only the binding verified release order and resolved versions', () => {
  assert.deepEqual(
    assertOperatingReleaseManifest(manifest(), {
      pipeline: '0.30.0',
      cli: '1.14.0',
      skills: '1.16.0',
      marketplace: '1.1.0',
    }),
    {
      pipeline: '0.30.0',
      cli: '1.14.0',
      skills: '1.16.0',
      marketplace: '1.1.0',
    },
  );
});

test('rejects unavailable capability and reordered promotion', () => {
  const unavailable = manifest();
  unavailable.capabilities.operatingBoard.status = 'unavailable';
  assert.throws(
    () => assertOperatingReleaseManifest(unavailable),
    /has not exposed Operating Board/,
  );

  const reordered = manifest();
  reordered.releaseTransaction.participantOrder = [
    'pipeline',
    'skills',
    'cli',
    'marketplace',
  ];
  assert.throws(() => assertOperatingReleaseManifest(reordered), /release order/);
});

test('verifies exact npm artifacts and final skills release', async () => {
  const responses = new Map([
    ['manifest', manifest()],
    [
      'https://registry.npmjs.org/planr-pipeline/0.30.0',
      { version: '0.30.0', dist: { integrity: 'sha512-pipeline' } },
    ],
    [
      'https://registry.npmjs.org/openplanr/1.14.0',
      { version: '1.14.0', dist: { integrity: 'sha512-cli' } },
    ],
    [
      'https://api.github.com/repos/openplanr/skills/releases/tags/v1.16.0',
      { tag_name: 'v1.16.0', draft: false, prerelease: false },
    ],
  ]);
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    const value = responses.get(url);
    return {
      ok: Boolean(value),
      status: value ? 200 : 404,
      async json() {
        return value;
      },
    };
  };
  const result = await verifyOperatingRelease({
    fetchImpl,
    manifestUrl: 'manifest',
  });
  assert.equal(result.versions.cli, '1.14.0');
  assert.deepEqual(requested, [...responses.keys()]);
});

test('requires a one-line Protocol v1.2 inspection from the installed CLI', () => {
  const value = verifyInstalledOperateCli({
    command: 'planr',
    spawn(command, args) {
      assert.equal(command, 'planr');
      assert.deepEqual(args, ['operate', 'inspect', '--json']);
      return {
        status: 0,
        stdout:
          '{"schemaVersion":"1.0.0","protocolVersion":"1.2.0","ok":true,"action":"inspect"}\n',
        stderr: '',
      };
    },
  });
  assert.equal(value.action, 'inspect');
});
