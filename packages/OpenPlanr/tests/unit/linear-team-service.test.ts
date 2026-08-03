import { describe, expect, it } from 'vitest';
import type { OpenPlanrConfig } from '../../src/models/types.js';
import {
  resolveConfiguredLinearTeam,
  withLinearTeam,
} from '../../src/services/linear-team-service.js';

const config = {
  projectName: 'linear-teams',
  targets: ['codex'],
  outputPaths: {
    agile: '.planr',
    cursorRules: '.cursor/rules',
    claudeConfig: '.',
    codexConfig: '.',
  },
  idPrefix: {
    epic: 'EPIC',
    feature: 'FEAT',
    story: 'US',
    task: 'TASK',
    quick: 'QT',
    backlog: 'BL',
    sprint: 'SPRINT',
    adr: 'ADR',
  },
  createdAt: '2026-07-22T00:00:00.000Z',
  linear: {
    teamId: 'team-muv',
    teamKey: 'MUV',
    teams: [
      { id: 'team-muv', key: 'MUV', name: 'MUVi' },
      { id: 'team-mod', key: 'MOD', name: 'Modul University Vienna GmbH' },
    ],
  },
} satisfies OpenPlanrConfig;

describe('Linear configured team resolution', () => {
  it('uses the configured default when no override is supplied', () => {
    expect(resolveConfiguredLinearTeam(config.linear)).toMatchObject({
      id: 'team-muv',
      key: 'MUV',
    });
  });

  it('resolves a selected team by key without mutating the stored default', () => {
    const targeted = withLinearTeam(config, 'mod');
    expect(targeted.linear).toMatchObject({ teamId: 'team-mod', teamKey: 'MOD' });
    expect(config.linear.teamId).toBe('team-muv');
  });

  it('supports legacy single-team configuration', () => {
    expect(resolveConfiguredLinearTeam({ teamId: 'legacy', teamKey: 'LEG' }, 'leg')).toEqual({
      id: 'legacy',
      key: 'LEG',
    });
  });

  it('rejects teams that were not selected during init', () => {
    expect(() => resolveConfiguredLinearTeam(config.linear, 'OTHER')).toThrow(
      /not configured.*MUVi \(MUV\).*Modul University Vienna GmbH \(MOD\)/,
    );
  });
});
