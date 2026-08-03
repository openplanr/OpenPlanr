import { describe, expect, it } from 'vitest';
import { createOperatingAction } from '../../src/services/operate/interaction/action-service.js';
import {
  assertOperatingConfirmation,
  createOperatingConfirmation,
  operatingConfirmationDigest,
} from '../../src/services/operate/interaction/confirmation-service.js';

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;

const material = {
  actionId: 'operate.init.apply',
  sessionId: 'GIS-test-session-12345678',
  command: 'planr operate init',
  effect: 'project-write' as const,
  providerUse: false,
  confirmationScope: 'operate.init.apply',
  projectIdentity: digest('1'),
  projectHead: digest('2'),
  configHead: digest('3'),
  eventHead: { sequence: 4, hash: digest('4') },
  evidenceHead: digest('5'),
  providerPolicy: digest('6'),
  arguments: ['profile=saas'],
  destinations: ['.planr/operate/config.json'],
  writes: ['.planr/operate/config.json:sha256:abc'],
  createdAt: '2026-07-29T10:00:00.000Z',
  expiresAt: '2026-07-29T10:30:00.000Z',
};

describe('Operating Board structured actions', () => {
  it('validates read-only actions without granting confirmation authority', async () => {
    const value = await createOperatingAction({
      id: 'operate.status',
      label: 'Show operating status',
      command: 'planr operate status --json',
      effect: 'read-only',
      recommended: true,
    });
    expect(value).toMatchObject({
      confirmation: null,
      action: {
        effect: 'read-only',
        providerUse: false,
        requiresConfirmation: false,
        confirmationDigest: null,
      },
    });
  });

  it('binds every mutating dimension into a distinct confirmation digest', () => {
    const baseline = operatingConfirmationDigest(material);
    for (const changed of [
      { ...material, projectHead: digest('7') },
      { ...material, configHead: digest('7') },
      { ...material, evidenceHead: digest('7') },
      { ...material, providerPolicy: digest('7') },
      { ...material, arguments: ['profile=product'] },
      { ...material, destinations: ['.planr/operate/charter.md'] },
      { ...material, writes: ['.planr/operate/charter.md:sha256:def'] },
    ]) {
      expect(operatingConfirmationDigest(changed)).not.toBe(baseline);
    }
  });

  it('rejects confirmation reuse for another action, digest, or expired preview', () => {
    const confirmation = createOperatingConfirmation(material);
    expect(() =>
      assertOperatingConfirmation({
        expected: confirmation,
        actionId: 'operate.run.start',
        confirmationDigest: confirmation.confirmationDigest,
        confirmed: true,
        now: new Date('2026-07-29T10:01:00.000Z'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED' }));
    expect(() =>
      assertOperatingConfirmation({
        expected: confirmation,
        actionId: confirmation.actionId,
        confirmationDigest: digest('9'),
        confirmed: true,
        now: new Date('2026-07-29T10:01:00.000Z'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'E_OPERATE_ROUTE_CONFIRMATION_REQUIRED' }));
    expect(() =>
      assertOperatingConfirmation({
        expected: confirmation,
        actionId: confirmation.actionId,
        confirmationDigest: confirmation.confirmationDigest,
        confirmed: true,
        now: new Date('2026-07-29T11:00:00.000Z'),
      }),
    ).toThrowError(expect.objectContaining({ code: 'E_OPERATE_ROUTE_DRIFT' }));
  });

  it('rejects implicit authority flags and machine-local paths in action commands', async () => {
    await expect(
      createOperatingAction({
        id: 'operate.unsafe',
        label: 'Unsafe',
        command: 'planr operate run --yes',
        effect: 'provider-call',
        confirmation: material,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_CONFIG_INVALID' });
    await expect(
      createOperatingAction({
        id: 'operate.path',
        label: 'Unsafe path',
        command: 'planr operate init --profile-file /Users/example/profile.json',
        effect: 'project-write',
        confirmation: material,
      }),
    ).rejects.toMatchObject({ code: 'E_OPERATE_CONFIG_INVALID' });
  });
});
