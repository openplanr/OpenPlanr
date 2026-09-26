import type {
  OperatingEventHeadV2,
  OperatingEventV2,
  OperatingExecutiveBoardCompatibilityV2,
  OperatingExecutiveBoardMaterializedV2,
  OperatingExecutiveBoardV2,
  OperatingReviewV2,
  OperatingRuntimeStateV2,
} from '@openplanr/protocol';

export type {
  OperatingExecutiveBoardCompatibilityV2,
  OperatingExecutiveBoardMaterializedV2,
  OperatingExecutiveBoardSeatBindingV2,
  OperatingExecutiveBoardV2,
} from '@openplanr/protocol';

type OperatingExecutiveBoardRecordOptionsV2 = {
  cycleId: string;
  planId: string;
  ledgerId: string;
  reviewId: string;
  reviewHash: string;
  createdAt: string;
  eventHead?: OperatingEventHeadV2;
  accessLevel?: 'public' | 'internal' | 'confidential' | 'restricted';
} & (
  | { projectionMode: 'materialized'; materializedEventId: string }
  | { projectionMode: 'compatibility'; materializedEventId: null }
);

export function buildOperatingExecutiveBoardRecordV2(
  state: OperatingRuntimeStateV2,
  options: OperatingExecutiveBoardRecordOptionsV2 & {
    projectionMode: 'materialized';
    materializedEventId: string;
  },
): OperatingExecutiveBoardMaterializedV2;
export function buildOperatingExecutiveBoardRecordV2(
  state: OperatingRuntimeStateV2,
  options: OperatingExecutiveBoardRecordOptionsV2 & {
    projectionMode: 'compatibility';
    materializedEventId: null;
  },
): OperatingExecutiveBoardCompatibilityV2;

export function assertOperatingExecutiveBoardV2(
  value: unknown,
  options: { materializedOnly: true },
): OperatingExecutiveBoardMaterializedV2;
export function assertOperatingExecutiveBoardV2(
  value: unknown,
  options?: { materializedOnly?: false },
): OperatingExecutiveBoardV2;

export type OperatingPendingCycleReviewV2 = OperatingReviewV2 &
  Readonly<{
    state: 'pending';
    disposition: null;
    workDispositions: readonly [];
  }>;

export function createOperatingExecutiveBoardMaterializationV2(
  request: {
    cycleId: string;
    planId: string;
    ledgerId: string;
    review: OperatingPendingCycleReviewV2;
  },
  draft: { eventId: string; timestamp: string; correlationId: string },
  options: { initialState: OperatingRuntimeStateV2 },
): Readonly<{
  board: OperatingExecutiveBoardMaterializedV2;
  event: OperatingEventV2<'executive-board.materialized'>;
}>;
