import type { ArtifactFrontmatter, OpenPlanrConfig } from '../models/types.js';
export type GraphNodeType = 'epic' | 'feature' | 'story' | 'task' | 'spec' | 'backlog' | 'quick' | 'sprint' | 'adr';
export type GraphStatus = 'done' | 'in-progress' | 'blocked' | 'outstanding' | 'addressed';
export type GraphEdgeKind = 'contains' | 'depends_on';
export interface GraphNode {
    id: string;
    type: GraphNodeType;
    title: string;
    status: GraphStatus;
    frontmatter: ArtifactFrontmatter;
    githubIssue?: string | number;
    linearIssueIdentifier?: string;
    body?: string;
}
export interface GraphEdge {
    from: string;
    to: string;
    kind: GraphEdgeKind;
}
export interface ProjectGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
}
export interface ReadGraphOptions {
    includeBody?: boolean;
}
export declare function classifyGraphStatus(rawStatus: unknown): GraphStatus;
export declare function readGraph(planrDir: string, opts?: ReadGraphOptions): ProjectGraph;
export declare function readProjectGraph(projectDir: string, config: OpenPlanrConfig, opts?: ReadGraphOptions): ProjectGraph;
//# sourceMappingURL=graph-service.d.ts.map