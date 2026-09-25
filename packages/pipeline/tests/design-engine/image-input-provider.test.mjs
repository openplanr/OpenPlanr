import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test, afterEach } from 'node:test';

const execFileP = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', '..', 'lib', 'design-engine', 'cli.mjs');

const dirs = [];
const tmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); dirs.push(d); return d; };
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

// Run `cli.mjs <args>` with no key resolvable (isolated PLANR_HOME, no OPENAI_API_KEY, empty cwd),
// so no invocation here can reach the network. Resolves with the exit code and both streams.
async function runCli(args, home) {
  const env = { ...process.env, PLANR_HOME: home };
  delete env.OPENAI_API_KEY;
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [CLI, ...args], { env, cwd: home, encoding: 'utf-8' });
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

function fixture() {
  const home = tmp('planr-image-input-home-');
  const sessionDir = tmp('planr-image-input-session-');
  const image = join(home, 'reference.png');
  writeFileSync(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  return { home, sessionDir, image };
}

test('evolve on the default (claude-svg) provider fails naming --provider openai instead of dropping --from', async () => {
  const { home, sessionDir, image } = fixture();
  const r = await runCli(['evolve', '--from', image, '--brief', 'warmer', '--session-dir', sessionDir], home);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--provider openai/);
  assert.equal(r.stdout, '', 'no author contract is printed for a command that could not honour its input');
});

test('generate --from-image on the claude-svg provider (implicit or explicit) fails the same way', async () => {
  const { home, sessionDir, image } = fixture();
  for (const provider of [[], ['--provider', 'claude-svg']]) {
    const r = await runCli(['generate', ...provider, '--from-image', image, '--brief', 'warmer', '--session-dir', sessionDir], home);
    assert.equal(r.code, 1, `provider flags ${JSON.stringify(provider)}`);
    assert.match(r.stderr, /--provider openai/);
    assert.equal(r.stdout, '');
  }
});

test('evolve --provider openai accepts the image and stops at the key gate, never the image gate', async () => {
  const { home, sessionDir, image } = fixture();
  const r = await runCli(['evolve', '--provider', 'openai', '--from', image, '--brief', 'warmer', '--session-dir', sessionDir], home);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /planr-design setup/, 'the missing-key message names setup');
  assert.doesNotMatch(r.stderr, /reference image/, 'the image itself is not the reason');
});

test('generate without an image keeps the $0 claude-svg author contract', async () => {
  const { home, sessionDir } = fixture();
  const r = await runCli(['generate', '--brief', 'warmer', '--session-dir', sessionDir], home);
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.equal(result.provider, 'claude-svg');
  assert.equal(result.action, 'author');
});
