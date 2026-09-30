import type {
  DiagramReviewBundle,
  DiagramReviewFeedback,
} from '@openplanr/protocol/diagram-review-contracts';
import type { WorkspaceEvent, WorkspacePublicKey } from '../encrypted-workspace-client.mjs';
export interface DiagramWorkspaceReply {
  commentId: string;
  author: string;
  signerId: string;
  body: string;
  createdAt: string;
}
export interface DiagramWorkspaceComment extends DiagramWorkspaceReply {
  target: { elementId?: string; x?: number; y?: number };
  resolved: boolean;
  updatedAt?: string;
  replies: DiagramWorkspaceReply[];
}
export function workspaceReviewerId(publicKey: WorkspacePublicKey): string;
export function assertDiagramFeedbackTarget(
  payload: DiagramReviewFeedback,
  scene: Pick<DiagramReviewBundle['scene'], 'items' | 'relations'>,
): void;
export function mergeDiagramWorkspaceFeedback(
  events: (WorkspaceEvent & { sequence: number; payload: DiagramReviewFeedback })[],
  options: {
    revisionId: string;
    reviewOf: string;
    ownerPublicKey?: WorkspacePublicKey;
    scene?: Pick<DiagramReviewBundle['scene'], 'items' | 'relations'>;
  },
): {
  comments: DiagramWorkspaceComment[];
  issues: { id: string | null; sequence: number | null; reason: string }[];
  acceptedEventIds: string[];
};
