import type { Page } from '@playwright/test';
import type {} from '../../bench/main';

export async function waitForBench(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.benchError !== undefined || Boolean(window.bench),
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(async () => {
    if (window.benchError !== undefined)
      throw new Error(`Canvas bench failed: ${window.benchError}`);
    await window.bench.ready;
    if (window.benchError !== undefined)
      throw new Error(`Canvas bench failed: ${window.benchError}`);
  });
}
