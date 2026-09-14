import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** @param {string} root */
export function snapshotRelativePaths(root) {
  /** @type {string[]} */
  const out = [];

  const walk = (abs) => {
    for (const name of readdirSync(abs)) {
      const p = join(abs, name);
      const st = statSync(p);
      const rel = relative(root, p);
      if (st.isDirectory()) walk(p);
      else out.push(rel.split('\\').join('/'));
    }
  };

  walk(root);
  out.sort();
  return out;
}
