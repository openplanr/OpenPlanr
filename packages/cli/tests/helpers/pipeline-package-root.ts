import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const testRequire = createRequire(import.meta.url);

export function resolvePipelinePackageRoot(): string {
  for (const candidate of [
    process.env.OPENPLANR_PIPELINE_PACKAGE_ROOT,
    process.env.OPENPLANR_PIPELINE_ROOT,
  ]) {
    if (candidate?.trim()) return resolve(candidate);
  }
  return dirname(testRequire.resolve('planr-pipeline/package.json'));
}
