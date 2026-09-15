/**
 * Path layout for the design-loop engine (v0.19.0).
 *
 * Exploration artifacts live in USER space, never the repo:
 *   ~/.planr/designs/<project>/<target>-<date>/   ← sessions, variants, boards, approved.json
 *   ~/.planr/designs/<project>/taste-profile.json ← per-project taste memory
 *   ~/.planr/credentials.json                     ← provider keys (0600)
 *   ~/.planr/design-daemon/                       ← daemon port + board registry
 *
 * Only APPROVED outputs are copied into the repo by the loop procedures.
 * `PLANR_HOME` overrides `~/.planr` (tests + sandboxes).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export function planrHome(env = process.env) {
  return env.PLANR_HOME && env.PLANR_HOME.trim() ? env.PLANR_HOME : join(homedir(), '.planr');
}

export function credentialsPath(env = process.env) {
  return join(planrHome(env), 'credentials.json');
}

export function designsRoot(env = process.env) {
  return join(planrHome(env), 'designs');
}

export function projectDesignsDir(project, env = process.env) {
  return join(designsRoot(env), project);
}

/** One exploration session dir: <project>/<target>-<yyyy-mm-dd>[-n]. */
export function sessionDirName(target, date = new Date()) {
  return `${target}-${date.toISOString().slice(0, 10)}`;
}

export function tasteProfilePath(project, env = process.env) {
  return join(projectDesignsDir(project, env), 'taste-profile.json');
}

export function daemonDir(env = process.env) {
  return join(planrHome(env), 'design-daemon');
}

/** Scoped .gitignore content for any engine-created artifact dir (hard rule 13). */
export const ARTIFACT_GITIGNORE = `# Written by the planr design-loop engine. Exploration artifacts are regenerable
# and stay out of version control; only APPROVED outputs are copied into the repo.
*
!.gitignore
!approved.json
`;
