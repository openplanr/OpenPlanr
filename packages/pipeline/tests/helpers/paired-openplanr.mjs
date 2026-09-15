import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveWorkspaceDependencyRoot } from './workspace-dependency.mjs';

const canonicalCliRoot = fileURLToPath(new URL('../../../cli', import.meta.url));

export function pairedOpenPlanrTools(env = process.env) {
  const configured = resolve(env.PLANR_OPENPLANR_ROOT ?? canonicalCliRoot);
  const root = existsSync(configured) ? realpathSync(configured) : null;
  if (!root) return Object.freeze({ root: null, typescript: null, vite: null });
  const from = join(root, 'package.json');
  const typescript = join(resolveWorkspaceDependencyRoot('typescript', { from }), 'bin/tsc');
  const vite = join(resolveWorkspaceDependencyRoot('vite', { from }), 'bin/vite.js');
  return Object.freeze({
    root,
    typescript: existsSync(typescript) ? typescript : null,
    vite: existsSync(vite) ? vite : null,
  });
}
