import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { reviewSchema } from './design-protocol-contracts.mjs';

// design.mjs:1519-1524
function planrHome(env = process.env) {
  return env.PLANR_HOME ?? join(homedir(), '.planr');
}

// design.mjs:2333
export function run(program, args, env) {
  return execFileSync(program, args, { env, encoding: 'utf8' });
}

export { planrHome, reviewSchema };
