import { logger as defaultLogger } from '../utils/logger.js';
export const HARNESS_FLOW_DEPRECATION_NOTICE = 'Deprecated: CLI-managed AI planning and structured Operating Board providers remain available in this release, but agentic work now belongs in the native runtime harness through Protocol v1.3 mandates. See https://openplanr.dev/docs/operate/agent-harness. Scheduled for removal in OpenPlanr 2.0.0.';
export function printDeprecationNotice(_surface, sink = defaultLogger) {
    sink.warn(HARNESS_FLOW_DEPRECATION_NOTICE);
}
//# sourceMappingURL=deprecation-notices.js.map