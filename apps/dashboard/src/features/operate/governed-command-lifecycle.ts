import { assertOperateExperiencePreviewV1 } from '@openplanr/protocol/schemas/v1.2.0/operate-experience-display-surface.mjs';
import { parseDashboardRoute } from '../../app/router.js';
import {
  createDashboardQueryIdentity,
  type DashboardEventHead,
  type DashboardQueryIdentity,
  isCurrentDashboardQuery,
} from '../../lib/binding/query-identity.js';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]{16,256}$/u;
const CAPABILITY = /^[A-Za-z0-9_-]{43,256}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAX_RESPONSE_BYTES = 256 * 1024;

export type GovernedCommandLocator = Readonly<{
  subjectId: string;
  actionDigest: string;
}>;

export type GovernedCommandConfirmation =
  | Readonly<{
      ok: true;
      eventHead: DashboardEventHead;
    }>
  | Readonly<{
      ok: false;
      reasonCode: 'OPERATION_UNCERTAIN';
    }>;

export type GovernedCommandPreview<
  ConfirmationInput = void,
  Confirmation = GovernedCommandConfirmation,
> = Readonly<{
  preview: ReturnType<typeof assertOperateExperiencePreviewV1>;
  confirm(input?: ConfirmationInput): Promise<Confirmation>;
  cancel(): void;
}>;

export type GovernedCommandLifecycle<
  ConfirmationInput = void,
  Confirmation = GovernedCommandConfirmation,
> = Readonly<{
  bind(identity: DashboardQueryIdentity): void;
  preview(
    locator: GovernedCommandLocator,
  ): Promise<GovernedCommandPreview<ConfirmationInput, Confirmation>>;
  reconcile(identity: DashboardQueryIdentity): void;
  cancel(): void;
  dispose(): void;
}>;

export type GovernedCommandConfirmationContext<Input> = Readonly<{
  value: unknown;
  preview: ReturnType<typeof assertOperateExperiencePreviewV1>;
  identity: DashboardQueryIdentity;
  previousHead: DashboardEventHead;
  input: Input | undefined;
}>;

export type GovernedCommandLifecycleOptions<
  Input = void,
  Confirmation = GovernedCommandConfirmation,
> = Readonly<{
  origin: string;
  fetcher?: typeof fetch;
  routeKinds: readonly string[];
  routeErrorCode: string;
  includeOriginHeader?: boolean;
  confirmation?: Readonly<{
    additionalBody(
      preview: ReturnType<typeof assertOperateExperiencePreviewV1>,
      input: Input | undefined,
    ): JsonRecord;
    parse(context: GovernedCommandConfirmationContext<Input>): Confirmation;
  }>;
}>;

export type GovernedRequestFlight = Readonly<{
  controller: AbortController;
  epoch: number;
  release(): void;
}>;

export type GovernedAdapterRunContext<Locator, Session> = Readonly<{
  identity: DashboardQueryIdentity;
  locator: Locator;
  session: Session;
  signal: AbortSignal;
  assertCurrent(): void;
  waitForCurrent<Value>(pending: Promise<Value>): Promise<Value>;
}>;

export type GovernedAdapterLifecycle<Locator, Session> = Readonly<{
  bind(identity: DashboardQueryIdentity, locator: Locator): void;
  run<Result>(
    operation: (context: GovernedAdapterRunContext<Locator, Session>) => Promise<Result>,
    options?: Readonly<{ uncertainOnFailure?: boolean }>,
  ): Promise<Result>;
  retainPreviewProof<Proof>(proof: Proof): void;
  requirePreviewProof<Proof>(validate: (proof: unknown) => proof is Proof): Proof;
  clearPreviewProof(): void;
  cancel(): void;
  reconcile(identity: DashboardQueryIdentity, locator?: Locator): void;
  dispose(): void;
}>;

/**
 * Shared request custody for every governed dashboard transport. Binding
 * changes abort all in-flight work, and every post-await continuation must
 * prove the exact launch epoch before it may consume returned bytes.
 */
export function createGovernedRequestCustody() {
  let epoch = 0;
  let disposed = false;
  let uncertain = false;
  const controllers = new Set<AbortController>();

  const invalidate = (): void => {
    epoch += 1;
    for (const controller of controllers) controller.abort();
    controllers.clear();
  };

  return Object.freeze({
    isDisposed: () => disposed,
    isUncertain: () => uncertain,
    invalidate,
    markUncertain(): void {
      uncertain = true;
      invalidate();
    },
    reconcile(): void {
      uncertain = false;
      invalidate();
    },
    start(): GovernedRequestFlight {
      if (disposed) throw new DOMException('Cancelled', 'AbortError');
      if (uncertain) fail('OPERATION_UNCERTAIN');
      if (controllers.size > 0) fail('OPERATE_COMMAND_IN_FLIGHT');
      const controller = new AbortController();
      controllers.add(controller);
      let retained = true;
      return Object.freeze({
        controller,
        epoch,
        release(): void {
          if (!retained) return;
          retained = false;
          controllers.delete(controller);
        },
      });
    },
    assert(expectedEpoch: number, signal: AbortSignal, current: boolean): void {
      if (disposed || signal.aborted || expectedEpoch !== epoch || !current) {
        throw new DOMException('Cancelled', 'AbortError');
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      invalidate();
    },
  });
}

/**
 * Shared binding/session/flight primitive for contract-specific governed adapters.
 * It owns single-flight, cancellation, uncertainty, and exact-refetch reconciliation;
 * adapters provide only locator and wire-contract parsing.
 */
export function createGovernedAdapterLifecycle<Locator, Session>(options: {
  routeKinds: readonly string[];
  routeErrorCode: string;
  parseLocator(value: Locator): Locator;
  sameLocator(left: Locator, right: Locator): boolean;
  issueSession(
    context: Readonly<{
      identity: DashboardQueryIdentity;
      locator: Locator;
      signal: AbortSignal;
      assertCurrent(): void;
      waitForCurrent<Value>(pending: Promise<Value>): Promise<Value>;
    }>,
  ): Promise<Session>;
}): GovernedAdapterLifecycle<Locator, Session> {
  const routeKinds = new Set(options.routeKinds);
  const custody = createGovernedRequestCustody();
  let current: DashboardQueryIdentity | null = null;
  let locator: Locator | null = null;
  let session: Session | null = null;
  let previewProof: unknown = null;

  const currentMatches = (identity: DashboardQueryIdentity, bound: Locator): boolean =>
    current !== null &&
    locator !== null &&
    isCurrentDashboardQuery(identity, current) &&
    options.sameLocator(bound, locator);

  const sameReconciliationScope = (
    left: DashboardQueryIdentity,
    right: DashboardQueryIdentity,
  ): boolean =>
    left.productArea === right.productArea &&
    left.route === right.route &&
    left.actorId === right.actorId &&
    left.projectId === right.projectId &&
    left.scopeId === right.scopeId &&
    left.domainId === right.domainId &&
    left.domainVersion === right.domainVersion &&
    left.cycleId === right.cycleId &&
    left.subjectId === right.subjectId &&
    left.generation === right.generation;

  return Object.freeze({
    bind(value, locatorValue): void {
      if (custody.isDisposed()) fail('OPERATE_ADAPTER_DISPOSED');
      const next = createDashboardQueryIdentity(value);
      if (next.productArea !== 'operate' || !routeKinds.has(parseDashboardRoute(next.route).kind)) {
        fail(options.routeErrorCode);
      }
      const nextLocator = options.parseLocator(locatorValue);
      if (currentMatches(next, nextLocator)) return;
      session = null;
      previewProof = null;
      custody.invalidate();
      current = next;
      locator = nextLocator;
    },
    async run<Result>(
      operation: (context: GovernedAdapterRunContext<Locator, Session>) => Promise<Result>,
      runOptions: Readonly<{ uncertainOnFailure?: boolean }> = {},
    ): Promise<Result> {
      if (custody.isDisposed()) fail('OPERATE_ADAPTER_DISPOSED');
      if (current === null || locator === null) fail('OPERATE_BINDING_REQUIRED');
      const identity = current;
      const bound = locator;
      const flight = custody.start();
      const assertCurrent = (): void => {
        custody.assert(flight.epoch, flight.controller.signal, currentMatches(identity, bound));
      };
      const waitForCurrent = async <Value>(pending: Promise<Value>): Promise<Value> => {
        try {
          const value = await pending;
          assertCurrent();
          return value;
        } catch (error) {
          assertCurrent();
          throw error;
        }
      };
      try {
        const activeSession =
          session ??
          (await waitForCurrent(
            options.issueSession({
              identity,
              locator: bound,
              signal: flight.controller.signal,
              assertCurrent,
              waitForCurrent,
            }),
          ));
        session = activeSession;
        const result = await waitForCurrent(
          operation({
            identity,
            locator: bound,
            session: activeSession,
            signal: flight.controller.signal,
            assertCurrent,
            waitForCurrent,
          }),
        );
        return result;
      } catch (error) {
        if (
          runOptions.uncertainOnFailure &&
          error instanceof Error &&
          error.name === 'OPERATION_UNCERTAIN'
        ) {
          session = null;
          custody.markUncertain();
        }
        throw error;
      } finally {
        flight.release();
      }
    },
    retainPreviewProof<Proof>(proof: Proof): void {
      if (custody.isDisposed() || custody.isUncertain()) fail('OPERATION_UNCERTAIN');
      previewProof = structuredClone(proof);
    },
    requirePreviewProof<Proof>(validate: (proof: unknown) => proof is Proof): Proof {
      if (custody.isDisposed()) fail('OPERATE_ADAPTER_DISPOSED');
      if (!validate(previewProof)) fail('OPERATE_BINDING_MISMATCH');
      return structuredClone(previewProof) as Proof;
    },
    clearPreviewProof(): void {
      previewProof = null;
    },
    cancel(): void {
      session = null;
      previewProof = null;
      custody.invalidate();
    },
    reconcile(identityValue, locatorValue): void {
      session = null;
      previewProof = null;
      if (custody.isDisposed()) fail('OPERATE_ADAPTER_DISPOSED');
      if (current === null || locator === null) fail('OPERATE_BINDING_REQUIRED');
      const next = createDashboardQueryIdentity(identityValue);
      if (
        next.productArea !== 'operate' ||
        !routeKinds.has(parseDashboardRoute(next.route).kind) ||
        !sameReconciliationScope(current, next)
      ) {
        fail('OPERATE_BINDING_MISMATCH');
      }
      const nextLocator = locatorValue === undefined ? locator : options.parseLocator(locatorValue);
      if (!options.sameLocator(locator, nextLocator)) fail('OPERATE_BINDING_MISMATCH');
      current = next;
      locator = nextLocator;
      custody.reconcile();
    },
    dispose(): void {
      if (custody.isDisposed()) return;
      session = null;
      previewProof = null;
      current = null;
      locator = null;
      custody.dispose();
    },
  });
}

class GovernedCommandError extends Error {
  constructor(readonly code: string) {
    super('The governed command was refused without effect.');
    this.name = code;
  }
}

type JsonRecord = Record<string, unknown>;

function fail(code = 'OPERATE_COMMAND_INVALID'): never {
  throw new GovernedCommandError(code);
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail();
  }
}

function exactString(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) fail();
  return value;
}

function exactHead(value: unknown): DashboardEventHead {
  const candidate = record(value);
  exactKeys(candidate, ['sequence', 'hash']);
  if (!Number.isSafeInteger(candidate.sequence) || (candidate.sequence as number) < 0) fail();
  const hash = candidate.hash === null ? null : exactString(candidate.hash, SHA256);
  if (((candidate.sequence as number) === 0) !== (hash === null)) fail();
  return Object.freeze({ sequence: candidate.sequence as number, hash });
}

function sameHead(left: DashboardEventHead, right: DashboardEventHead): boolean {
  return left.sequence === right.sequence && left.hash === right.hash;
}

function exactLocator(value: unknown): GovernedCommandLocator {
  const candidate = record(value);
  exactKeys(candidate, ['subjectId', 'actionDigest']);
  return Object.freeze({
    subjectId: exactString(candidate.subjectId, ID),
    actionDigest: exactString(candidate.actionDigest, SHA256),
  });
}

function exactOrigin(value: string): string {
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    fail('OPERATE_ORIGIN_INVALID');
  }
  if (
    candidate.origin !== value ||
    candidate.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname)
  ) {
    fail('OPERATE_ORIGIN_INVALID');
  }
  return candidate.origin;
}

function commandUrl(origin: string, path: string, identity: DashboardQueryIdentity): string {
  const url = new URL(path, origin);
  url.searchParams.set('scopeId', identity.scopeId);
  url.searchParams.set('domainId', identity.domainId);
  url.searchParams.set('domainVersion', identity.domainVersion);
  return url.toString();
}

function responseCode(value: unknown): string | null {
  try {
    const envelope = record(value);
    exactKeys(envelope, ['ok', 'error']);
    const error = record(envelope.error);
    exactKeys(error, ['reasonCode', 'message', 'retryable']);
    const candidate = error.reasonCode;
    return envelope.ok === false &&
      typeof candidate === 'string' &&
      /^[A-Z][A-Z0-9_]{0,127}$/u.test(candidate) &&
      typeof error.message === 'string' &&
      error.retryable === false
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function exactUncertainConfirmation(value: JsonRecord, expectedOperation: string): void {
  exactKeys(value, ['ok', 'operation', 'error', 'allowedActions']);
  const error = record(value.error);
  exactKeys(error, ['code', 'message', 'retryable', 'context']);
  const context = record(error.context);
  exactKeys(context, []);
  if (
    value.ok !== false ||
    value.operation !== expectedOperation ||
    error.code !== 'OPERATION_UNCERTAIN' ||
    typeof error.message !== 'string' ||
    error.retryable !== false ||
    !Array.isArray(value.allowedActions) ||
    value.allowedActions.length !== 0
  ) {
    fail('OPERATE_COMMAND_REFUSED');
  }
}

function exactSuccessfulConfirmation(
  value: JsonRecord,
  expectedOperation: string,
  identity: DashboardQueryIdentity,
  previousHead: DashboardEventHead,
): DashboardEventHead {
  exactKeys(value, ['ok', 'operation', 'data', 'allowedActions', 'eventHead']);
  if (
    value.ok !== true ||
    value.operation !== expectedOperation ||
    !Array.isArray(value.allowedActions) ||
    value.allowedActions.length !== 0
  ) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  const advanced = exactHead(value.eventHead);
  const data = record(value.data);
  const dataHead = exactHead(data.eventHead);
  if (
    data.kind !== 'operate-experience-view' ||
    data.schemaVersion !== '1.0.0' ||
    data.protocolVersion !== '2.0.0' ||
    data.actorId !== identity.actorId ||
    data.scopeId !== identity.scopeId ||
    data.domainId !== identity.domainId ||
    data.domainVersion !== identity.domainVersion ||
    !sameHead(dataHead, advanced) ||
    advanced.sequence <= previousHead.sequence ||
    advanced.hash === null
  ) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  return advanced;
}

type GovernedTransportGuard = Pick<
  GovernedAdapterRunContext<unknown, unknown>,
  'assertCurrent' | 'waitForCurrent'
>;

async function responseJson(response: Response, guard?: GovernedTransportGuard): Promise<unknown> {
  const contentType = response.headers.get('content-type');
  if (!contentType || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(contentType)) {
    fail('OPERATE_RESPONSE_INVALID');
  }
  const pendingSource = response.text();
  const source = guard ? await guard.waitForCurrent(pendingSource) : await pendingSource;
  guard?.assertCurrent();
  if (source.length > MAX_RESPONSE_BYTES) fail('OPERATE_RESPONSE_INVALID');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    fail('OPERATE_RESPONSE_INVALID');
  }
  if (!response.ok) {
    const code = responseCode(value);
    if (code === null) fail('OPERATE_RESPONSE_INVALID');
    fail(code);
  }
  return value;
}

export type GovernedSessionCustody = Readonly<{
  sessionId: string;
  capability: string;
  actionReference: string | null;
}>;

export function exactGovernedSession<Locator>(
  value: unknown,
  identity: DashboardQueryIdentity,
  locator: Locator,
  options: Readonly<{
    parseLocator(value: unknown): Locator;
    sameLocator(left: Locator, right: Locator): boolean;
    allowedActions:
      | Readonly<{ kind: 'none' }>
      | Readonly<{
          kind: 'single-reference';
          parseLocator(value: JsonRecord): Locator;
        }>;
  }>,
): GovernedSessionCustody {
  const session = record(value);
  exactKeys(session, [
    'kind',
    'schemaVersion',
    'protocolVersion',
    'sessionId',
    'sessionCapability',
    'issuedAt',
    'expiresAt',
    'binding',
    'allowedActions',
    'readOnly',
  ]);
  if (
    session.kind !== 'operate-command-session' ||
    session.schemaVersion !== '1.0.0' ||
    session.protocolVersion !== '2.0.0' ||
    session.readOnly !== false ||
    typeof session.issuedAt !== 'string' ||
    typeof session.expiresAt !== 'string'
  ) {
    fail('OPERATE_SESSION_INVALID');
  }
  const binding = record(session.binding);
  exactKeys(binding, [
    'actorId',
    'scopeId',
    'domainId',
    'domainVersion',
    'cycleId',
    'eventHead',
    'sourceViewHash',
    'actionLocator',
  ]);
  const boundLocator = options.parseLocator(binding.actionLocator);
  const boundHead = exactHead(binding.eventHead);
  if (
    binding.actorId !== identity.actorId ||
    binding.scopeId !== identity.scopeId ||
    binding.domainId !== identity.domainId ||
    binding.domainVersion !== identity.domainVersion ||
    binding.cycleId !== identity.cycleId ||
    identity.eventHead === null ||
    !sameHead(boundHead, identity.eventHead) ||
    binding.sourceViewHash !== identity.viewHash ||
    !options.sameLocator(boundLocator, locator)
  ) {
    fail('OPERATE_BINDING_MISMATCH');
  }
  if (!Array.isArray(session.allowedActions)) {
    fail('OPERATE_ACTION_REFERENCE_INVALID');
  }
  let actionReference: string | null = null;
  if (options.allowedActions.kind === 'none') {
    if (session.allowedActions.length !== 0) fail('OPERATE_ACTION_REFERENCE_INVALID');
  } else {
    if (session.allowedActions.length !== 1) fail('OPERATE_ACTION_REFERENCE_INVALID');
    const action = record(session.allowedActions[0]);
    const allowedLocator = options.allowedActions.parseLocator(action);
    if (!options.sameLocator(allowedLocator, locator)) fail('OPERATE_BINDING_MISMATCH');
    actionReference = exactString(action.actionReference, OPAQUE_ID);
  }
  return Object.freeze({
    sessionId: exactString(session.sessionId, OPAQUE_ID),
    capability: exactString(session.sessionCapability, CAPABILITY),
    actionReference,
  });
}

function requestHeaders(
  identity: DashboardQueryIdentity,
  origin: string,
  includeOriginHeader: boolean,
  capability?: string,
): HeadersInit {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-openplanr-actor': identity.actorId,
  };
  if (includeOriginHeader) headers.origin = origin;
  if (capability !== undefined) headers.authorization = `Bearer ${capability}`;
  return headers;
}

async function post(
  fetcher: typeof fetch,
  origin: string,
  path: string,
  identity: DashboardQueryIdentity,
  body: JsonRecord,
  signal: AbortSignal,
  includeOriginHeader: boolean,
  capability?: string,
  guard?: GovernedTransportGuard,
): Promise<unknown> {
  const pendingResponse = fetcher(commandUrl(origin, path, identity), {
    method: 'POST',
    credentials: 'same-origin',
    headers: requestHeaders(identity, origin, includeOriginHeader, capability),
    body: JSON.stringify(body),
    signal,
  });
  const response = guard ? await guard.waitForCurrent(pendingResponse) : await pendingResponse;
  guard?.assertCurrent();
  return responseJson(response, guard);
}

export function createGovernedCommandLifecycle<
  ConfirmationInput = void,
  Confirmation = GovernedCommandConfirmation,
>(
  options: GovernedCommandLifecycleOptions<ConfirmationInput, Confirmation>,
): GovernedCommandLifecycle<ConfirmationInput, Confirmation> {
  const origin = exactOrigin(options.origin);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const routeKinds = new Set(options.routeKinds);
  const includeOriginHeader = options.includeOriginHeader ?? false;
  let current: DashboardQueryIdentity | null = null;
  const lifecycle = createGovernedAdapterLifecycle<GovernedCommandLocator, GovernedSessionCustody>({
    routeKinds: options.routeKinds,
    routeErrorCode: options.routeErrorCode,
    parseLocator: exactLocator,
    sameLocator: (left, right) =>
      left.subjectId === right.subjectId && left.actionDigest === right.actionDigest,
    async issueSession({ identity, locator, signal, assertCurrent, waitForCurrent }) {
      if (identity.cycleId === null || identity.eventHead === null || identity.viewHash === null) {
        fail('OPERATE_BINDING_REQUIRED');
      }
      const value = await post(
        fetcher,
        origin,
        '/api/operate/session',
        identity,
        {
          cycleId: identity.cycleId,
          eventHead: identity.eventHead,
          sourceViewHash: identity.viewHash,
          actionLocator: locator,
        },
        signal,
        includeOriginHeader,
        undefined,
        { assertCurrent, waitForCurrent },
      );
      assertCurrent();
      return exactGovernedSession(value, identity, locator, {
        parseLocator: exactLocator,
        sameLocator: (left, right) =>
          left.subjectId === right.subjectId && left.actionDigest === right.actionDigest,
        allowedActions: {
          kind: 'single-reference',
          parseLocator(action) {
            exactKeys(action, ['actionReference', 'subjectId', 'actionDigest']);
            return exactLocator({
              subjectId: action.subjectId,
              actionDigest: action.actionDigest,
            });
          },
        },
      });
    },
  });

  const bind = (value: DashboardQueryIdentity): void => {
    const next = createDashboardQueryIdentity(value);
    const route = parseDashboardRoute(next.route);
    if (next.productArea !== 'operate' || !routeKinds.has(route.kind)) {
      fail(options.routeErrorCode);
    }
    if (current !== null && isCurrentDashboardQuery(current, next)) return;
    lifecycle.cancel();
    current = next;
  };

  const preview = async (
    value: GovernedCommandLocator,
  ): Promise<GovernedCommandPreview<ConfirmationInput, Confirmation>> => {
    if (
      current === null ||
      current.productArea !== 'operate' ||
      current.cycleId === null ||
      current.eventHead === null ||
      current.viewHash === null
    ) {
      fail('OPERATE_BINDING_REQUIRED');
    }
    const locator = exactLocator(value);
    const identity = current;
    const eventHead = current.eventHead;
    const sourceViewHash = current.viewHash;
    lifecycle.bind(identity, locator);
    const issuedPreview = await lifecycle.run(
      async ({ session, signal, assertCurrent, waitForCurrent }) => {
        if (session.actionReference === null) fail('OPERATE_ACTION_REFERENCE_INVALID');
        let previewValue: unknown;
        try {
          previewValue = await post(
            fetcher,
            origin,
            '/api/operate/commands/preview',
            identity,
            { sessionId: session.sessionId, actionReference: session.actionReference },
            signal,
            includeOriginHeader,
            session.capability,
            { assertCurrent, waitForCurrent },
          );
          assertCurrent();
        } catch (cause) {
          if (signal.aborted && cause instanceof DOMException && cause.name === 'AbortError') {
            throw cause;
          }
          if (
            cause instanceof GovernedCommandError &&
            cause.code !== 'OPERATE_RESPONSE_INVALID' &&
            cause.code !== 'OPERATION_UNCERTAIN'
          ) {
            throw cause;
          }
          fail('OPERATION_UNCERTAIN');
        }
        try {
          const parsed = assertOperateExperiencePreviewV1(previewValue, {
            actorId: identity.actorId,
            scopeId: identity.scopeId,
            domainId: identity.domainId,
            domainVersion: identity.domainVersion,
            eventHead,
            sourceViewHash,
            subjectId: locator.subjectId,
            actionDigest: locator.actionDigest,
          });
          lifecycle.retainPreviewProof(parsed);
          return parsed;
        } catch {
          fail('OPERATION_UNCERTAIN');
        }
      },
      { uncertainOnFailure: true },
    );
    let active = true;
    let terminal: Promise<Confirmation> | null = null;
    const cancel = (): void => {
      if (!active) return;
      active = false;
      lifecycle.cancel();
    };
    const confirm = (input?: ConfirmationInput): Promise<Confirmation> => {
      if (terminal !== null) return terminal;
      terminal = (async () => {
        if (!active) throw new DOMException('Cancelled', 'AbortError');
        try {
          const confirmed = await lifecycle.run(
            async ({ session, signal, assertCurrent, waitForCurrent }) => {
              const proof = lifecycle.requirePreviewProof(
                (value): value is typeof issuedPreview =>
                  record(value).previewId === issuedPreview.previewId &&
                  record(value).previewHash === issuedPreview.previewHash,
              );
              let responseValue: unknown;
              try {
                responseValue = await post(
                  fetcher,
                  origin,
                  '/api/operate/commands/confirm',
                  identity,
                  {
                    sessionId: session.sessionId,
                    previewId: proof.previewId,
                    previewHash: proof.previewHash,
                    ...(options.confirmation?.additionalBody(proof, input) ?? {}),
                  },
                  signal,
                  includeOriginHeader,
                  session.capability,
                  { assertCurrent, waitForCurrent },
                );
                assertCurrent();
              } catch (cause) {
                if (
                  signal.aborted &&
                  cause instanceof DOMException &&
                  cause.name === 'AbortError'
                ) {
                  throw cause;
                }
                if (
                  cause instanceof GovernedCommandError &&
                  cause.code !== 'OPERATION_UNCERTAIN' &&
                  cause.code !== 'OPERATE_RESPONSE_INVALID'
                ) {
                  throw cause;
                }
                fail('OPERATION_UNCERTAIN');
              }
              try {
                if (options.confirmation) {
                  return options.confirmation.parse({
                    value: responseValue,
                    preview: proof,
                    identity,
                    previousHead: eventHead,
                    input,
                  });
                }
                const result = record(responseValue);
                if (result.ok !== true) {
                  exactUncertainConfirmation(result, proof.allowedAction.tool);
                  fail('OPERATION_UNCERTAIN');
                }
                return exactSuccessfulConfirmation(
                  result,
                  proof.allowedAction.tool,
                  identity,
                  eventHead,
                ) as Confirmation;
              } catch (cause) {
                if (cause instanceof GovernedCommandError && cause.code === 'OPERATION_UNCERTAIN') {
                  throw cause;
                }
                fail('OPERATION_UNCERTAIN');
              }
            },
            { uncertainOnFailure: true },
          );
          lifecycle.clearPreviewProof();
          return options.confirmation
            ? confirmed
            : (Object.freeze({ ok: true as const, eventHead: confirmed }) as Confirmation);
        } catch (cause) {
          if (cause instanceof GovernedCommandError && cause.code === 'OPERATION_UNCERTAIN') {
            return Object.freeze({
              ok: false as const,
              reasonCode: 'OPERATION_UNCERTAIN' as const,
            }) as Confirmation;
          }
          throw cause;
        } finally {
          active = false;
        }
      })();
      return terminal;
    };
    return Object.freeze({ preview: issuedPreview, confirm, cancel });
  };

  return Object.freeze({
    bind,
    preview,
    reconcile(identity): void {
      if (current === null) fail('OPERATE_BINDING_REQUIRED');
      const next = createDashboardQueryIdentity(identity);
      lifecycle.reconcile(next);
      current = next;
    },
    cancel: lifecycle.cancel,
    dispose(): void {
      lifecycle.dispose();
      current = null;
    },
  });
}
