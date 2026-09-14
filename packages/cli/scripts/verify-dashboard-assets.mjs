#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_BUNDLE_BUDGETS,
  verifyDashboardAssets,
} from '../lib/dashboard-verifier.mjs';

export { DASHBOARD_BUNDLE_BUDGETS, verifyDashboardAssets };

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const report = verifyDashboardAssets(process.argv[2] ? resolve(process.argv[2]) : undefined);
  if (report.ok) {
    process.stdout.write(
      `dashboard assets verified: buildId=${report.buildId} totalBytes=${report.sizes.total}\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`${report.violations.join('\n')}\n`);
  process.exit(1);
}
