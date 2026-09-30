import type { DiagramAuthoringBundle } from './diagram-authoring-contracts.mjs';
export interface DiagramReviewItem {
  id: string;
  label: string;
  kind: string;
  x: number;
  y: number;
}
export interface DiagramReviewRelation {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: string;
}
export interface DiagramReviewBundle {
  kind: 'openplanr-diagram-review-bundle';
  schemaVersion: '1.0.0';
  diagramId: string;
  title: string;
  source: { kind: 'manifest' | 'authoring'; digest: string };
  rendering: { id: string; version: string; fontFamily: 'Inter' };
  summary?: string;
  grammar?: string;
  colorScheme?: 'light' | 'dark';
  scene: {
    svg: string;
    width: number;
    height: number;
    items: DiagramReviewItem[];
    relations: DiagramReviewRelation[];
  };
  authored?: DiagramAuthoringBundle;
}
export interface DiagramReviewTarget {
  elementId?: string;
  x?: number;
  y?: number;
}
interface FeedbackBase {
  author: string;
  reviewOf: string;
  createdAt: string;
  commentId: string;
}
export type DiagramReviewFeedback = FeedbackBase &
  (
    | { kind: 'comment'; body: string; target: DiagramReviewTarget }
    | { kind: 'reply'; body: string; parentId: string }
    | { kind: 'resolve'; resolved: boolean }
  );
export declare const DIAGRAM_REVIEW_VERSION: '1.0.0';
export declare const DIAGRAM_WORKSPACE_VERSION: '1.0.0';
export declare const DIAGRAM_WORKSPACE_API: '/api/v1/diagram-workspaces';
export declare const DIAGRAM_WORKSPACE_MAX_BYTES: number;
export declare const DIAGRAM_WORKSPACE_MAX_EVENT_BYTES: number;
export declare const DIAGRAM_WORKSPACE_ID_PATTERN: string;
export declare const DIAGRAM_REVIEW_BUNDLE_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DIAGRAM_REVIEW_FEEDBACK_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DIAGRAM_WORKSPACE_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DIAGRAM_WORKSPACE_CREATE_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DIAGRAM_WORKSPACE_REVISION_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DIAGRAM_WORKSPACE_EVENT_SCHEMA: Readonly<Record<string, unknown>>;
export declare const DIAGRAM_REVIEW_SCHEMAS: Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>;
export declare function assertDiagramReviewBundle(value: unknown): DiagramReviewBundle;
export declare function assertDiagramReviewFeedback(value: unknown): DiagramReviewFeedback;
export declare function diagramReviewBundleDigest(value: unknown): string;
export declare function assertDiagramWorkspaceContract<T>(
  value: T,
  schema: string | Readonly<Record<string, unknown>>,
): T;
