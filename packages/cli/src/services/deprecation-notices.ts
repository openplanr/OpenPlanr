import { logger as defaultLogger } from '../utils/logger.js';

export type DeprecatedSurface = 'ai-planning';

export const AI_PLANNING_DEPRECATION_NOTICE =
  'Deprecated: CLI-managed AI planning remains available in this release.';

export function printDeprecationNotice(
  _surface: DeprecatedSurface,
  sink: Pick<typeof defaultLogger, 'warn'> = defaultLogger,
): void {
  sink.warn(AI_PLANNING_DEPRECATION_NOTICE);
}
