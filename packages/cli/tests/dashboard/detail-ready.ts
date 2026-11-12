import { waitFor } from '@testing-library/react';

/** Resolves once the detail inside `scope` has verified its source read and shows its columns. */
export function findDetailReady(scope: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const columns = scope.querySelector<HTMLElement>(
      '[data-detail-state="ready"] .pc-detail__columns',
    );
    if (!columns) throw new Error('The detail has not verified its source read yet.');
    return columns;
  });
}
