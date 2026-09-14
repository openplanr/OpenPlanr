import { sha256Jcs } from 'planr-pipeline/protocol';

type RecordValue = Record<string, unknown>;

type ReviewWorkspaceContext = Readonly<{
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string;
  reviewId: string;
  choiceId: string;
}>;

const DEFAULT_HASH = `sha256:${'a'.repeat(64)}`;
const DEFAULT_CONTEXT: ReviewWorkspaceContext = Object.freeze({
  actorId: 'owner-acme',
  scopeId: 'scope-acme',
  domainId: 'business',
  domainVersion: '1.0.0',
  cycleId: 'cyc_1234567890abcdef',
  reviewId: 'rev_1234567890abcdef',
  choiceId: 'rch_1234567890abcdef',
});

export function reviewWorkspace(input: {
  receipt?: RecordValue;
  currentActions?: RecordValue[];
  sourceView?: RecordValue;
  context?: Partial<ReviewWorkspaceContext>;
}): RecordValue {
  const context = { ...DEFAULT_CONTEXT, ...input.context };
  const sourceHead = (input.sourceView?.eventHead as RecordValue | undefined) ?? {
    sequence: 2,
    hash: `sha256:${'b'.repeat(64)}`,
  };
  const sourceViewHash = String(input.sourceView?.viewHash ?? DEFAULT_HASH);
  if (input.receipt) {
    const review = input.receipt.review as RecordValue;
    return {
      kind: 'operate-review-display-workspace',
      payload: {
        status: 'terminal',
        mutationEnabled: false,
        sourceArtifactKind: 'operating-review-receipt',
        sourceArtifactHash: sha256Jcs(input.receipt as never),
        sourceReadEventHead: input.receipt.readEventHead,
        sourceEventHead: input.receipt.eventHead,
        sourceViewHash,
        actorId: context.actorId,
        scopeId: context.scopeId,
        domainId: context.domainId,
        domainVersion: context.domainVersion,
        cycleId: input.receipt.cycleId,
        reviewId: review.reviewId,
        data: {
          terminalDisposition: {
            receiptId: input.receipt.receiptId,
            appliedChoiceId: input.receipt.appliedChoiceId,
            appliedChoiceHash: input.receipt.appliedChoiceHash,
          },
          capability: { available: false, actions: [], reason: { code: 'REVIEW_TERMINAL' } },
        },
      },
    };
  }
  return {
    kind: 'operate-review-display-workspace',
    payload: {
      status: 'ready',
      mutationEnabled: true,
      sourceArtifactKind: 'operating-review-read',
      sourceArtifactHash: DEFAULT_HASH,
      sourceReadEventHead: structuredClone(sourceHead),
      sourceEventHead: structuredClone(sourceHead),
      sourceViewHash,
      actorId: String(input.sourceView?.actorId ?? context.actorId),
      scopeId: String(input.sourceView?.scopeId ?? context.scopeId),
      domainId: String(input.sourceView?.domainId ?? context.domainId),
      domainVersion: String(input.sourceView?.domainVersion ?? context.domainVersion),
      cycleId: context.cycleId,
      reviewId: context.reviewId,
      data: {
        terminalDisposition: null,
        choices: (input.currentActions ?? []).map((action) => ({
          choiceId: context.choiceId,
          choiceHash: sha256Jcs(action.arguments as never),
          submitArguments: structuredClone(action.arguments),
        })),
        capability: {
          available: true,
          actions: (input.currentActions ?? []).map((action) => ({
            subjectId: context.reviewId,
            action,
          })),
          reason: null,
        },
      },
    },
  };
}
