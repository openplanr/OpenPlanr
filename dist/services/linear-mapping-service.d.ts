/**
 * Local-only Linear ↔ OpenPlanr mapping table for `planr linear status`.
 */
import type { LinearMappingTableRow, OpenPlanrConfig } from '../models/types.js';
/**
 * Collect mapping rows from local frontmatter only (no Linear API).
 * With `scopeEpicId`, only that epic and descendants (features, stories, tasks in cascade + tasks with `featureId` in scope).
 */
export declare function collectLinearMappingTable(projectDir: string, config: OpenPlanrConfig, scopeEpicId?: string): Promise<LinearMappingTableRow[]>;
export declare function formatLinearMappingTable(rows: LinearMappingTableRow[]): string;
//# sourceMappingURL=linear-mapping-service.d.ts.map