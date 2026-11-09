import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYNC_TRACKER_CONTRACT } from '../../src/services/sync-tracker-service.js';

describe('sync tracker contract', () => {
  it('is the newest contract the runtime skills record, with its first CLI version', () => {
    const { commands } = JSON.parse(
      readFileSync(resolve('../../scripts/skills/skill-cli-contracts.json'), 'utf8'),
    ) as { commands: Record<string, { contracts: Record<string, string> }> };
    const recorded = Object.keys(commands['sync tracker']?.contracts ?? {}).map(Number);
    expect(Math.max(...recorded)).toBe(SYNC_TRACKER_CONTRACT);
  });
});
