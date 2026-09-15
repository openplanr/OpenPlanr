import type { OperatingRuntimeStateV2 } from '@openplanr/protocol';
import type {
  OperatingExecutiveBoardCompatibilityV2,
  OperatingExecutiveBoardV2,
} from './executive-board-materialization-v2.mjs';

export function readOperatingExecutiveBoardV2(
  state: OperatingRuntimeStateV2,
  options: {
    cycleId: string;
    reviewId?: string;
    accessLevel?: 'public' | 'internal' | 'confidential' | 'restricted';
    eventHead?: Readonly<{ sequence: number; hash: string | null }>;
  },
): OperatingExecutiveBoardV2;

export function buildExistingOperatingExecutiveBoardCompatibilityV2(
  state: OperatingRuntimeStateV2,
  options: Parameters<typeof readOperatingExecutiveBoardV2>[1],
): OperatingExecutiveBoardCompatibilityV2;
