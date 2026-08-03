import type { LinearConfig, OpenPlanrConfig } from '../models/types.js';

export interface ConfiguredLinearTeam {
  id: string;
  key?: string;
  name?: string;
}

/**
 * Resolve a configured Linear team by id or key. Legacy single-team configs
 * remain valid. Commands without an override use `linear.teamId`.
 */
export function resolveConfiguredLinearTeam(
  linear: LinearConfig,
  selector?: string,
): ConfiguredLinearTeam {
  const selectedTeams = linear.teams;
  const teams: ConfiguredLinearTeam[] =
    selectedTeams && selectedTeams.length > 0
      ? selectedTeams
      : [{ id: linear.teamId, key: linear.teamKey }];

  if (!selector?.trim()) {
    const configuredDefault = teams.find((team) => team.id === linear.teamId);
    return configuredDefault ?? { id: linear.teamId, key: linear.teamKey };
  }

  const normalized = selector.trim().toLowerCase();
  const match = teams.find(
    (team) => team.id.toLowerCase() === normalized || team.key?.toLowerCase() === normalized,
  );
  if (match) return match;

  const available = teams
    .map((team) => (team.key ? `${team.name ?? team.key} (${team.key})` : (team.name ?? team.id)))
    .join(', ');
  throw new Error(
    `Linear team "${selector}" is not configured for this project. Available teams: ${available}. Run \`planr linear init\` to change team access.`,
  );
}

/** Return a copy of config targeting one configured team for this command. */
export function withLinearTeam(config: OpenPlanrConfig, selector?: string): OpenPlanrConfig {
  if (!config.linear) return config;
  const team = resolveConfiguredLinearTeam(config.linear, selector);
  return {
    ...config,
    linear: {
      ...config.linear,
      teamId: team.id,
      teamKey: team.key,
    },
  };
}
