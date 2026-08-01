import { logger as defaultLogger } from '../utils/logger.js';

export type DeprecatedSurface = 'operate-structured-provider' | 'ai-planning';

export const HARNESS_FLOW_DEPRECATION_NOTICE =
  'Deprecated: CLI-managed AI planning and structured Operating Board providers remain available in this release, but agentic work now belongs in the native runtime harness through Protocol v1.3 mandates. See https://openplanr.dev/docs/operate/agent-harness. Scheduled for removal in OpenPlanr 2.0.0.';

export function printDeprecationNotice(
  _surface: DeprecatedSurface,
  sink: Pick<typeof defaultLogger, 'warn'> = defaultLogger,
): void {
  sink.warn(HARNESS_FLOW_DEPRECATION_NOTICE);
}
