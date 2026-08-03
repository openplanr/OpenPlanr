import { canonicalDigest } from '../canonical.js';
import { OperateError, } from '../types.js';
function sorted(values = []) {
    return [...new Set(values)].sort();
}
export function operatingConfirmationDigest(material) {
    return canonicalDigest({
        actionId: material.actionId,
        sessionId: material.sessionId,
        command: material.command,
        effect: material.effect,
        providerUse: material.providerUse,
        confirmationScope: material.confirmationScope,
        projectIdentity: material.projectIdentity,
        projectHead: material.projectHead,
        configHead: material.configHead,
        eventHead: material.eventHead ?? null,
        evidenceHead: material.evidenceHead ?? null,
        providerPolicy: material.providerPolicy ?? null,
        arguments: [...(material.arguments ?? [])],
        destinations: sorted(material.destinations),
        writes: sorted(material.writes),
    });
}
export function createOperatingConfirmation(material) {
    const createdAt = material.createdAt ?? new Date().toISOString();
    const expiresAt = material.expiresAt ?? new Date(Date.parse(createdAt) + 30 * 60 * 1_000).toISOString();
    const confirmationDigest = operatingConfirmationDigest(material);
    return {
        kind: 'guided-confirmation',
        schemaVersion: '1.0.0',
        protocolVersion: '1.2.0',
        confirmationId: `GIC-${confirmationDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`,
        state: 'preview',
        actionId: material.actionId,
        sessionId: material.sessionId,
        command: material.command,
        effect: material.effect,
        providerUse: material.providerUse,
        confirmationScope: material.confirmationScope,
        confirmationDigest,
        projectIdentity: material.projectIdentity,
        projectHead: material.projectHead,
        configHead: material.configHead,
        eventHead: material.eventHead ?? null,
        arguments: [...(material.arguments ?? [])],
        destinations: sorted(material.destinations),
        writes: sorted(material.writes),
        createdAt,
        expiresAt,
    };
}
export function assertOperatingConfirmation(input) {
    const now = input.now ?? new Date();
    if (!input.confirmed ||
        input.actionId !== input.expected.actionId ||
        input.confirmationDigest !== input.expected.confirmationDigest) {
        throw new OperateError('E_OPERATE_ROUTE_CONFIRMATION_REQUIRED', `Action ${input.expected.actionId} requires its exact named confirmation digest.`, {
            actionId: input.expected.actionId,
            confirmationDigest: input.expected.confirmationDigest,
            previewCommand: input.expected.command.replace(/\s+--yes\b/g, ''),
        });
    }
    if (now.getTime() >= Date.parse(input.expected.expiresAt)) {
        throw new OperateError('E_OPERATE_ROUTE_DRIFT', `Confirmation for ${input.expected.actionId} expired; preview the action again.`, {
            actionId: input.expected.actionId,
            changedDimensions: ['expiry'],
            previewCommand: input.expected.command.replace(/\s+--yes\b/g, ''),
        });
    }
    return {
        ...input.expected,
        state: 'confirmed',
        confirmedAt: now.toISOString(),
        confirmedBy: 'explicit-cli-authority',
    };
}
//# sourceMappingURL=confirmation-service.js.map