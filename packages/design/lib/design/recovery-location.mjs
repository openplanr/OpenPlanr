import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { planrHome } from '@openplanr/artifact/internal/planr-home.mjs';

/**
 * A new recovery file path in `PLANR_HOME/design-recovery`, where the owner keys already live.
 * The directory is created or tightened to 0700; the export writes the file 0600.
 */
export function defaultDesignRecoveryOutput(env = process.env, now = Date.now()) {
  const directory = join(planrHome(env), 'design-recovery');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return join(directory, `openplanr-design-recovery-${now}.json`);
}
