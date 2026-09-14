import { execFile } from 'node:child_process';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { OperateLegacyReplayProof } from './storage-layout.js';

const executeFile = promisify(execFile);

/**
 * Executes the checked-in, commit-pinned pre-change verifier in an isolated
 * temporary directory. Its JSON is still treated as untrusted by the caller.
 */
export async function runPinnedLegacyReplayVerifier(
  projectDir: string,
): Promise<OperateLegacyReplayProof> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const script = path.join(packageRoot, 'scripts', 'create-pinned-legacy-operate-replay-proof.mjs');
  const scriptMetadata = await lstat(script).catch((cause) => {
    throw Object.assign(
      new Error(
        `The pinned legacy replay verifier is unavailable at ${script}: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
      { code: 'OPERATE_PINNED_VERIFIER_UNAVAILABLE' },
    );
  });
  if (scriptMetadata.isSymbolicLink() || !scriptMetadata.isFile()) {
    throw Object.assign(
      new Error('The pinned legacy replay verifier is not one real packaged file.'),
      {
        code: 'OPERATE_PINNED_VERIFIER_UNAVAILABLE',
      },
    );
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'openplanr-pinned-operate-proof-'));
  const output = path.join(temporary, 'proof.json');
  try {
    await executeFile(
      process.execPath,
      [script, '--project-dir', path.resolve(projectDir), '--output', output],
      {
        cwd: packageRoot,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    return JSON.parse(await readFile(output, 'utf8')) as OperateLegacyReplayProof;
  } catch (cause) {
    throw Object.assign(
      new Error(
        `Pinned legacy Operate replay verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
      { code: 'OPERATE_STORE_INCOMPATIBLE' },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
