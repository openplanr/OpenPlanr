import { loadOperatingProtocol } from './protocol.js';
/** Canonical projection is owned by planr-pipeline/protocol, never duplicated here. */
export async function reduceOperatingEvents(events, options = {}) {
    return (await loadOperatingProtocol()).reduceOperatingEvents(events, {
        checkpoint: options.checkpoint ?? null,
    });
}
export async function verifyOperatingEvents(events) {
    return (await loadOperatingProtocol()).verifyOperatingEventChain(events);
}
//# sourceMappingURL=reducer.js.map