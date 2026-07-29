import { describe, expect, it } from 'vitest';
import {
  decodeOperatingInitializationReplay,
  encodeOperatingInitializationReplay,
} from '../../src/services/operate/interaction/initialization-replay.js';

const answers = {
  profile: 'saas' as const,
  decisionOwner: "Founder O'Neil",
  planningEngine: 'openplanr' as const,
  runtime: 'codex' as const,
  cadence: 'weekly' as const,
  timezone: 'Europe/Istanbul',
  sensitivityCeiling: 'internal' as const,
  sources: ['repository', 'planr', 'git'],
  componentRoots: ['packages/product app'],
  charter: {
    purpose: 'Make cited operating decisions.',
    stage: 'growth',
    businessModel: 'subscription SaaS',
    idealCustomer: 'technical founders',
    goals: ['Produce one reviewable brief.'],
    constraints: [],
    successMetrics: ['Time to first brief'],
    guardrails: ['Humans approve all mutations.'],
    knownUnknowns: ['Current activation baseline'],
  },
};

describe('Operating Board initialization replay', () => {
  it('round-trips normalized answers through a deterministic shell-safe token', () => {
    const token = encodeOperatingInitializationReplay(answers);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeOperatingInitializationReplay(answers)).toBe(token);
    expect(decodeOperatingInitializationReplay(token)).toEqual(answers);
  });

  it('fails closed for malformed, corrupted, and oversized replay tokens', () => {
    expect(() => decodeOperatingInitializationReplay('not+base64')).toThrow('malformed or exceeds');
    const token = encodeOperatingInitializationReplay(answers);
    expect(() => decodeOperatingInitializationReplay(`${token}a`)).toThrow('invalid or corrupted');
    expect(() => decodeOperatingInitializationReplay('a'.repeat(24 * 1024 + 1))).toThrow(
      'malformed or exceeds',
    );
  });
});
