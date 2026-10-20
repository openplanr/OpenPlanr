import type { Page } from '@playwright/test';

export const brandGalleryStates: readonly string[];
export function colorChannels(css: string): number[];
export function brandGalleryDocument(options?: {
  theme?: string;
  state?: string;
  code?: string;
}): Promise<string>;
export function recordBrandGalleryEvidence(
  page: Page,
  options: { theme: string; state: string },
): Promise<unknown>;
export function assertBrandGalleryEvidence(evidence: unknown): void;
