/**
 * Provider auth resolution (hard rule 7 — paid-for lessons encoded):
 *
 *   1. ~/.planr/credentials.json  { "openai_api_key": "sk-…" }
 *   2. OPENAI_API_KEY env var — and if that exact key ALSO appears in the cwd's
 *      .env/.env.local, emit the silent-billing DISCLOSURE warning (generating
 *      inside someone else's project would bill their account) and verify the
 *      .env file is gitignored (warn loudly when it is not).
 *   3. null → the caller offers guided setup or the claude-svg provider.
 *
 * Never returns/echoes the key in any message — only `source` + boolean
 * presence. Pure file reads; no network.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { credentialsPath } from './paths.mjs';

function readEnvFileKeys(dir) {
  const found = [];
  for (const name of ['.env', '.env.local']) {
    const p = join(dir, name);
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, 'utf-8');
      const m = text.match(/^\s*OPENAI_API_KEY\s*=\s*["']?([^"'\n#]+)/m);
      if (m && m[1].trim()) found.push({ file: name, key: m[1].trim() });
    } catch {
      /* unreadable env file — ignore */
    }
  }
  return found;
}

function isGitIgnored(cwd, file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, checkIgnore?: (cwd: string, file: string) => boolean }} [opts]
 * @returns {{ apiKey: string|null, source: 'credentials'|'env'|'none', warnings: string[] }}
 */
export function resolveAuth(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const checkIgnore = opts.checkIgnore ?? isGitIgnored;
  const warnings = [];

  // 1 — stored credentials
  try {
    const credsFile = credentialsPath(env);
    if (existsSync(credsFile)) {
      const creds = JSON.parse(readFileSync(credsFile, 'utf-8'));
      const key = typeof creds.openai_api_key === 'string' ? creds.openai_api_key.trim() : '';
      if (key) return { apiKey: key, source: 'credentials', warnings };
    }
  } catch {
    warnings.push('credentials.json exists but could not be parsed — falling through to env.');
  }

  // 2 — environment, with the cwd-.env silent-billing disclosure
  const envKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  if (envKey) {
    for (const hit of readEnvFileKeys(cwd)) {
      if (hit.key === envKey) {
        warnings.push(
          `DISCLOSURE: the active OPENAI_API_KEY matches the one in this project's ${hit.file}. ` +
            'Image generation here would bill THAT account. Confirm this is intended before generating.',
        );
        if (!checkIgnore(cwd, hit.file)) {
          warnings.push(
            `SECURITY: ${hit.file} holds an API key but is NOT gitignored — add it to .gitignore before committing anything.`,
          );
        }
      }
    }
    return { apiKey: envKey, source: 'env', warnings };
  }

  // 3 — nothing resolves; caller offers setup or the claude-svg provider (never
  // a dead-end). If a cwd .env DOES hold a key, SAY so — the engine deliberately
  // never auto-reads it (that's the silent-billing trap), but leaving the user
  // staring at hasKey:false while their key sits in .env is bad DevEx.
  const dormant = readEnvFileKeys(cwd);
  if (dormant.length > 0) {
    warnings.push(
      `HINT: an OPENAI_API_KEY exists in this project's ${dormant[0].file} but is not active — ` +
        'the engine never auto-reads .env (silent-billing protection). To use it: export it into the ' +
        'environment for this run, or store your own key via `planr-design setup`.',
    );
  }
  return { apiKey: null, source: 'none', warnings };
}
