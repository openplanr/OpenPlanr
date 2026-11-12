import type { Page } from '@playwright/test';

export type ParityRow = Readonly<{
  id: string;
  selector: string;
  property: string;
  expected: string;
  viewport: 'D' | 'T' | 'M';
  theme: 'both';
  setup?:
    | 'select'
    | 'lanes'
    | 'list-select'
    | 'list-labels'
    | 'list-compact'
    | 'list-menu'
    | 'list-empty'
    | 'list-coarse'
    | 'list-T'
    | 'list-M'
    | 'list-sheet'
    | 'detail-task'
    | 'detail-spec'
    | 'detail-missing'
    | 'detail-M'
    | 'sprints-active'
    | 'sprints-bare'
    | 'sprints-none'
    | 'sprints-M'
    | 'activity'
    | null;
  items?: string;
}>;
export type ParitySample = Readonly<{
  id: string;
  theme: string;
  viewport: string;
  property: string;
  actual: unknown;
  expected: unknown;
}>;

export function resolveParityToken(value: string, theme: string): string;
export const redesignParityRows: readonly ParityRow[];
export const boardParityRows: readonly ParityRow[];
export const homeParityRows: readonly ParityRow[];
export const listParityRows: readonly ParityRow[];
export const detailParityRows: readonly ParityRow[];
export const sprintsParityRows: readonly ParityRow[];
export const activityParityRows: readonly ParityRow[];
export function assertParityRow(page: Page, row: ParityRow, theme: string): Promise<ParitySample[]>;
