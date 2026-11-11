/**
 * Where running local review servers record themselves, under `PLANR_HOME/artifact-daemon`.
 * This module only reads and names files; it never makes a request. Records let another
 * process reuse, inspect, stop, or export a running loopback server.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { planrHome } from './paths.mjs';

const RECORD = /^(?:instance-[A-Za-z0-9_-]{22}|state-(?:default|\d+))\.json$/u;
const AUTHORIZATION_CONTROL_VERSIONS = new Set([1, 2]);

export function reviewStateDir(env = process.env) {
  return join(planrHome(env), 'artifact-daemon');
}

export function artifactReviewStatePath(port = 0, env = process.env) {
  const suffix = port === 0 ? 'default' : String(port);
  return join(reviewStateDir(env), `state-${suffix}.json`);
}

export function reviewStateLockPath(port, env = process.env) {
  const suffix = port === 0 ? 'default' : String(port);
  return join(reviewStateDir(env), `start-${suffix}.lock`);
}

export function reviewInstanceStatePath(instanceId, env = process.env) {
  return join(reviewStateDir(env), `instance-${instanceId}.json`);
}

/** Paths of the saved server records, sorted by name; a missing directory has none. */
export function reviewStateRecordPaths(env = process.env) {
  const directory = reviewStateDir(env);
  let names;
  try {
    names = readdirSync(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((name) => RECORD.test(name))
    .sort()
    .map((name) => join(directory, name));
}

/**
 * Request headers that present a recorded server's control token to its own loopback routes.
 * Callers send them only to `127.0.0.1` on the recorded port.
 */
export function reviewControlHeaders(state, controlHeader) {
  // Servers before version 3 read the control token from the Authorization header.
  return AUTHORIZATION_CONTROL_VERSIONS.has(state.serverVersion)
    ? { authorization: `Bearer ${state.controlToken}` }
    : { [controlHeader]: state.controlToken };
}
