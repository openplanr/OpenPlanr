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
export declare function resolveConfiguredLinearTeam(linear: LinearConfig, selector?: string): ConfiguredLinearTeam;
/** Return a copy of config targeting one configured team for this command. */
export declare function withLinearTeam(config: OpenPlanrConfig, selector?: string): OpenPlanrConfig;
//# sourceMappingURL=linear-team-service.d.ts.map