import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_SESSIONS = 256;

export type OperateSessionBindingV2 = {
  actorId: string;
  scopeId: string;
  domainId: string;
  domainVersion: string;
  cycleId: string;
  eventHead: { sequence: number; hash: string | null };
  sourceViewHash: string;
  actionLocator: { subjectId: string; actionDigest: string };
};

export type OperateSessionCapabilityV2 = {
  capability: string;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
  binding: OperateSessionBindingV2;
};

type SessionRecord = Omit<OperateSessionCapabilityV2, 'capability'> & {
  capabilityHash: Buffer;
  origin: string;
};

export class OperateSessionCapabilityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = code;
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function exactBinding(left: OperateSessionBindingV2, right: OperateSessionBindingV2): boolean {
  return (
    left.actorId === right.actorId &&
    left.scopeId === right.scopeId &&
    left.domainId === right.domainId &&
    left.domainVersion === right.domainVersion &&
    left.cycleId === right.cycleId &&
    left.eventHead.sequence === right.eventHead.sequence &&
    left.eventHead.hash === right.eventHead.hash &&
    left.sourceViewHash === right.sourceViewHash &&
    left.actionLocator.subjectId === right.actionLocator.subjectId &&
    left.actionLocator.actionDigest === right.actionLocator.actionDigest
  );
}

function validOrigin(value: string): boolean {
  try {
    const origin = new URL(value);
    return (
      origin.origin === value &&
      origin.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Process-local bearer capabilities for the loopback browser. Only the digest
 * is retained. Restart intentionally revokes every browser session while the
 * project-local Operate state remains durable and replayable.
 */
export class OperateSessionCapabilityIssuerV2 {
  private readonly records = new Map<string, SessionRecord>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      now?: () => number;
      entropy?: () => Buffer;
    } = {},
  ) {}

  issue(binding: OperateSessionBindingV2, origin: string): OperateSessionCapabilityV2 {
    if (!validOrigin(origin)) {
      throw new OperateSessionCapabilityError(
        'OPERATE_ORIGIN_INVALID',
        'The local command session requires an exact loopback origin.',
      );
    }
    const now = this.options.now?.() ?? Date.now();
    for (const [sessionId, record] of this.records) {
      if (now >= Date.parse(record.expiresAt)) this.records.delete(sessionId);
    }
    if (this.records.size >= MAX_ACTIVE_SESSIONS) {
      throw new OperateSessionCapabilityError(
        'OPERATE_SESSION_LIMIT',
        'The bounded local command-session capacity is exhausted.',
      );
    }
    const ttlMs = this.options.ttlMs ?? DEFAULT_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 60 * 60 * 1000) {
      throw new OperateSessionCapabilityError(
        'OPERATE_SESSION_INVALID',
        'The local command session expiry is outside its bounded policy.',
      );
    }
    const capability = (this.options.entropy?.() ?? randomBytes(32)).toString('base64url');
    if (capability.length < 43) {
      throw new OperateSessionCapabilityError(
        'OPERATE_SESSION_INVALID',
        'The local command session capability has insufficient entropy.',
      );
    }
    const sessionId = `opsess_${randomBytes(16).toString('hex')}`;
    const issuedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const record: SessionRecord = {
      sessionId,
      capabilityHash: digest(capability),
      issuedAt,
      expiresAt,
      binding: structuredClone(binding),
      origin,
    };
    this.records.set(sessionId, record);
    return Object.freeze({
      capability,
      sessionId,
      issuedAt,
      expiresAt,
      binding: structuredClone(binding),
    });
  }

  authorize(input: {
    sessionId: string;
    capability: string;
    origin: string;
    binding: OperateSessionBindingV2;
  }): Readonly<SessionRecord> {
    const record = this.assert({
      sessionId: input.sessionId,
      capability: input.capability,
      origin: input.origin,
    });
    if (!exactBinding(record.binding, input.binding)) {
      throw new OperateSessionCapabilityError(
        'OPERATE_SESSION_STALE',
        'The local command session no longer matches the current actor, scope, or Event head.',
      );
    }
    return record;
  }

  assert(input: {
    sessionId: string;
    capability: string;
    origin: string;
  }): Readonly<SessionRecord> {
    const record = this.records.get(input.sessionId);
    const supplied = digest(input.capability ?? '');
    const expected = record?.capabilityHash ?? digest('unavailable-session-capability');
    const validCapability = timingSafeEqual(supplied, expected) && record !== undefined;
    if (!record || !validCapability) {
      throw new OperateSessionCapabilityError(
        'OPERATE_SESSION_DENIED',
        'The local command session is unavailable or invalid.',
      );
    }
    if (record.origin !== input.origin) {
      throw new OperateSessionCapabilityError(
        'OPERATE_ORIGIN_INVALID',
        'The local command session belongs to a different origin.',
      );
    }
    const now = this.options.now?.() ?? Date.now();
    if (now >= Date.parse(record.expiresAt)) {
      throw new OperateSessionCapabilityError(
        'OPERATE_SESSION_EXPIRED',
        'The local command session expired. Refresh the validated projection.',
      );
    }
    return Object.freeze(structuredClone(record));
  }

  revoke(sessionId: string): void {
    this.records.delete(sessionId);
  }
}

export function createOperateSessionCapabilityIssuerV2(
  options: ConstructorParameters<typeof OperateSessionCapabilityIssuerV2>[0] = {},
): OperateSessionCapabilityIssuerV2 {
  return new OperateSessionCapabilityIssuerV2(options);
}
