import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPENPLANR_VERSION, readOpenPlanrVersion } from '../../src/utils/package-version.js';

describe('OpenPlanr package version provenance', () => {
  it('uses package.json as the single CLI version source', () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      version: string;
    };

    expect(readOpenPlanrVersion()).toBe(manifest.version);
    expect(OPENPLANR_VERSION).toBe(manifest.version);
  });
});
