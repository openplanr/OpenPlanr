import type { Page } from '@playwright/test';

export type ParityRow = Readonly<{
  id: string;
  selector: string;
  property: string;
  expected: string;
  viewport: 'D' | 'T' | 'M';
  theme: 'both';
  setup?: 'select' | 'lanes' | null;
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
export function assertParityRow(page: Page, row: ParityRow, theme: string): Promise<ParitySample[]>;
