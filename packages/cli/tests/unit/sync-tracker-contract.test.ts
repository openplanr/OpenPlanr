import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SYNC_TRACKER_CONTRACT } from '../../src/services/sync-tracker-service.js';

describe('sync tracker contract', () => {
  it('matches the contract the runtime skills pin', () => {
    const { commands } = JSON.parse(
      readFileSync(resolve('../../scripts/skills/skill-cli-contracts.json'), 'utf8'),
    ) as { commands: Record<string, { contract: number; since: string }> };
    expect(commands['sync tracker']?.contract).toBe(SYNC_TRACKER_CONTRACT);
  });
});
