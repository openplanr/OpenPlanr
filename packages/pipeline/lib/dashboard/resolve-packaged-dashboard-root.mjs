/**
 * Resolve the unified product dashboard build that the loopback server serves.
 *
 * Resolution order:
 *   1. OPENPLANR_DASHBOARD_ROOT — explicit absolute dist/dashboard override
 *   2. installed consumer package dist/dashboard (when present)
 *
 * Every candidate must contain a valid dashboard-manifest.json for the unified
 * React build. Legacy standalone assets are intentionally unsupported.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function isUnifiedDashboardRoot(candidate) {
  try {
    const manifestPath = join(candidate, 'dashboard-manifest.json');
    if (!existsSync(manifestPath)) return false;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return (
      manifest.kind === 'openplanr-dashboard-build' &&
      manifest.schemaVersion === '1.0.0' &&
      manifest.entry === 'index.html' &&
      typeof manifest.buildId === 'string' &&
      manifest.buildId.length > 0
    );
  } catch {
    return false;
  }
}

function installedOpenPlanrDashboardCandidates() {
  const candidates = [];
  const packageName = ['open', 'planr'].join('');
  const requireBases = [import.meta.url];
  try {
    requireBases.push(pathToFileURL(resolve(process.cwd(), 'package.json')).href);
  } catch {
    // process.cwd() may not contain a package.json in some hosted contexts.
  }
  for (const base of requireBases) {
    try {
      const require = createRequire(base);
      const packageJson = require.resolve(`${packageName}/package.json`);
      candidates.push(resolve(dirname(packageJson), 'dist', 'dashboard'));
    } catch {
      // Consumer package is not installed in this node_modules graph.
    }
  }
  return [...new Set(candidates)];
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolvePackagedDashboardRoot(env = process.env) {
  const candidates = [];
  if (typeof env.OPENPLANR_DASHBOARD_ROOT === 'string' && env.OPENPLANR_DASHBOARD_ROOT.length > 0) {
    candidates.push(resolve(env.OPENPLANR_DASHBOARD_ROOT));
  }
  candidates.push(...installedOpenPlanrDashboardCandidates());

  for (const candidate of candidates) {
    if (isUnifiedDashboardRoot(candidate)) return candidate;
  }

  throw new Error(
    'Unified dashboard assets are missing. Install OpenPlanr with its packaged dashboard ' +
      'or set OPENPLANR_DASHBOARD_ROOT to an absolute dist/dashboard directory.',
  );
}

/**
 * @param {string} staticRoot
 * @returns {{ buildId: string }}
 */
export function readPackagedDashboardManifest(staticRoot) {
  const manifest = JSON.parse(readFileSync(join(staticRoot, 'dashboard-manifest.json'), 'utf8'));
  if (!isUnifiedDashboardRoot(staticRoot)) {
    throw new Error('dashboard staticRoot does not contain a unified dashboard manifest');
  }
  return { buildId: manifest.buildId };
}
