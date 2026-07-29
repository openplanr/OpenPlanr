import path from 'node:path';
import { resolveGuidedInteractionValidators } from '../../pipeline-package-service.js';
import { containsSecret } from '../redaction.js';
import {
  type GuidedConfirmation,
  OperateError,
  type OperatingActionEffect,
  type StructuredOperatingAction,
} from '../types.js';
import {
  createOperatingConfirmation,
  type OperatingConfirmationMaterial,
} from './confirmation-service.js';

function assertSafeCommand(command: string): void {
  if (
    !/^planr [^\r\n]{1,1024}$/.test(command) ||
    command.includes('\0') ||
    /\s--yes(?:\s|$)/.test(command) ||
    /(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/.test(command) ||
    containsSecret(command)
  ) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Structured Operating Board actions must use a safe public planr command without authority flags or sensitive machine data.',
    );
  }
}

async function validateStructuredAction(action: StructuredOperatingAction): Promise<void> {
  const validators = await resolveGuidedInteractionValidators();
  if (validators.validateStructuredAction(action).length > 0) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Structured action ${action.id} failed Protocol v1.2 validation.`,
    );
  }
}

export async function createOperatingAction(input: {
  id: string;
  label: string;
  description?: string;
  command: string;
  effect: OperatingActionEffect;
  providerUse?: boolean;
  recommended?: boolean;
  confirmation?: Omit<
    OperatingConfirmationMaterial,
    'actionId' | 'command' | 'effect' | 'providerUse'
  >;
}): Promise<{ action: StructuredOperatingAction; confirmation: GuidedConfirmation | null }> {
  assertSafeCommand(input.command);
  const providerUse = input.effect === 'provider-call';
  if (Boolean(input.providerUse) !== providerUse && input.providerUse !== undefined) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      'Provider use must match the structured action effect.',
    );
  }
  if (input.effect === 'read-only') {
    if (input.confirmation) {
      throw new OperateError(
        'E_OPERATE_CONFIG_INVALID',
        'Read-only actions cannot carry confirmation authority.',
      );
    }
    const action: StructuredOperatingAction = {
      kind: 'structured-action',
      schemaVersion: '1.0.0',
      protocolVersion: '1.2.0',
      id: input.id,
      label: input.label,
      ...(input.description ? { description: input.description } : {}),
      command: input.command,
      effect: input.effect,
      providerUse: false,
      requiresConfirmation: false,
      confirmationScope: null,
      confirmationDigest: null,
      recommended: input.recommended ?? false,
    };
    await validateStructuredAction(action);
    return { action, confirmation: null };
  }
  if (!input.confirmation) {
    throw new OperateError(
      'E_OPERATE_CONFIG_INVALID',
      `Action ${input.id} requires digest-bound confirmation material.`,
    );
  }
  const confirmation = createOperatingConfirmation({
    ...input.confirmation,
    actionId: input.id,
    command: input.command,
    effect: input.effect,
    providerUse,
  });
  const action: StructuredOperatingAction = {
    kind: 'structured-action',
    schemaVersion: '1.0.0',
    protocolVersion: '1.2.0',
    id: input.id,
    label: input.label,
    ...(input.description ? { description: input.description } : {}),
    command: input.command,
    effect: input.effect,
    providerUse,
    requiresConfirmation: true,
    confirmationScope: input.confirmation.confirmationScope,
    confirmationDigest: confirmation.confirmationDigest,
    recommended: input.recommended ?? false,
  };
  await validateStructuredAction(action);
  return { action, confirmation };
}

export function sanitizeActionDestination(projectRoot: string, target: string): string {
  const relative = path.relative(path.resolve(projectRoot), path.resolve(projectRoot, target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new OperateError(
      'E_OPERATE_PATH_ESCAPE',
      'Structured action destinations must stay inside the project.',
    );
  }
  return relative.split(path.sep).join('/') || '.';
}
