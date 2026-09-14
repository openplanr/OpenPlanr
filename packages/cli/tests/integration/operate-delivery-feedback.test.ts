import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Operate Planning delivery feedback boundary', () => {
  it('is implemented through the public runtime transaction without Outcome inference', async () => {
    const source = await readFile(
      new URL('../../src/services/operate/delivery-evidence.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain('ingestPlanningDelivery');
    expect(source).toContain('buildOperatingDeliveryEvidenceV1');
    expect(source).not.toContain('recordOperatingOutcome');
  });
});
